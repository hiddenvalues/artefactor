import { describe, expect, it, vi } from "vitest";
import {
  bootstrapInnerJs,
  injectBootstrap,
  renderArtefactHtml,
  type BootstrapContext,
} from "./localstorage-bootstrap";

const baseCtx: BootstrapContext = {
  seedBlob: '{"greeting":"hi"}',
  writable: true,
  targetOrigin: "https://artefactor.test",
  channel: "chan-abc",
  seedUpdatedAt: "2026-09-12T09:00:00.000Z",
  maxBytes: 5 * 1024 * 1024,
};

describe("injectBootstrap", () => {
  // r[verify data.shim.injected-first]
  it("inserts the script right after <head>, before existing scripts", () => {
    const html = "<html><head><title>t</title><script>app()</script></head><body></body></html>";
    const out = injectBootstrap(html, "<script>SHIM</script>");
    expect(out.indexOf("SHIM")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("SHIM")).toBeLessThan(out.indexOf("app()"));
  });

  // r[verify data.shim.injected-first]
  it("falls back to <html>, then to prepending", () => {
    expect(injectBootstrap("<html><body>x</body></html>", "S")).toContain("<html>S");
    expect(injectBootstrap("<body>x</body>", "S")).toBe("S<body>x</body>");
  });

  it("escapes </script> in the seed so it cannot break out of the tag", () => {
    const script = renderArtefactHtml("<head></head>", {
      ...baseCtx,
      seedBlob: '{"x":"</script><script>evil()</script>"}',
    });
    expect(script).not.toContain("</script><script>evil()");
    expect(script).toContain("\\u003c/script>");
  });
});

// Evaluate the shim IIFE with mocked browser globals to prove its behaviour. The
// frame has no session (`hosting.frame.no-cookies`), so `fetch` is injected only
// to prove it is never called; `setTimeout` likewise, to prove the shim keeps no
// timer (S81 — the shell debounces).
function runShim(ctx: BootstrapContext) {
  const listeners: Record<string, (e?: unknown) => void> = {};
  const parent = { postMessage: vi.fn() };
  const window: Record<string, unknown> = {
    addEventListener: (ev: string, cb: () => void) => (listeners[ev] = cb),
    parent,
  };
  const document = {
    addEventListener: (ev: string, cb: () => void) => (listeners["doc:" + ev] = cb),
    visibilityState: "visible",
  };
  const fetch = vi.fn();
  const setTimeout = vi.fn();
  const fn = new Function(
    "window",
    "document",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "TextEncoder",
    bootstrapInnerJs(ctx),
  );
  fn(window, document, fetch, setTimeout, clearTimeout, TextEncoder);
  return { ls: window.localStorage as Storage, fetch, setTimeout, listeners, window, parent, document };
}

// Lets the current task end: the shim posts from a microtask.
const endOfTask = () => Promise.resolve();

const changed = (blob: Record<string, string>) => [
  {
    type: "artefactor:data-changed",
    blob: JSON.stringify(blob),
    channel: "chan-abc",
    seed: "2026-09-12T09:00:00.000Z",
  },
  "https://artefactor.test",
];

describe("localStorage shim (S13)", () => {
  // r[verify data.shim.full-sync-api]
  // r[verify data.shim.seeded-server-side]
  it("serves seeded reads synchronously", () => {
    const { ls } = runShim(baseCtx);
    expect(ls.getItem("greeting")).toBe("hi");
    expect(ls.getItem("missing")).toBeNull();
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe("greeting");
  });

  // r[verify data.shim.no-helper]
  it("adds nothing to window but localStorage: no ARTEFACTOR helper", () => {
    const { window } = runShim(baseCtx);
    expect(Object.getOwnPropertyNames(window).sort()).toEqual([
      "addEventListener",
      "localStorage",
      "parent",
    ]);
    expect(window.ARTEFACTOR).toBeUndefined();
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.quota-over-cap]
  it("throws QuotaExceededError over the cap and reverts the write", async () => {
    const { ls, parent } = runShim({ ...baseCtx, maxBytes: 40 });
    expect(() => ls.setItem("big", "x".repeat(100))).toThrowError(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    // Reverted: the failed key is not present, and nothing was posted.
    expect(ls.getItem("big")).toBeNull();
    expect(ls.getItem("greeting")).toBe("hi");
    await endOfTask();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});

// S36 — the sandboxed frame has no session: the shim hands each change to
// the host shell, which owns the S31 write discipline.
describe("localStorage shim — persists through the host shell (S36)", () => {
  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.posts-never-fetches+2]
  // r[verify data.shim.keyspace-is-blob]
  it("posts the whole blob to the parent, at the app origin, once per task that changed it", async () => {
    const { ls, parent, fetch, setTimeout } = runShim(baseCtx);
    ls.setItem("greeting", "bye");
    ls.setItem("n", "2");
    expect(ls.getItem("greeting")).toBe("bye");
    expect(parent.postMessage).not.toHaveBeenCalled();
    await endOfTask();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith(...changed({ greeting: "bye", n: "2" }));
    // A change in a later task is a second post.
    ls.setItem("n", "3");
    await endOfTask();
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    expect(parent.postMessage).toHaveBeenLastCalledWith(...changed({ greeting: "bye", n: "3" }));
    expect(setTimeout).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  it("posts removeItem and clear like any other change", async () => {
    const { ls, parent } = runShim(baseCtx);
    ls.removeItem("greeting");
    await endOfTask();
    expect(parent.postMessage).toHaveBeenLastCalledWith(...changed({}));
    ls.setItem("a", "1");
    ls.clear();
    await endOfTask();
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    expect(parent.postMessage).toHaveBeenLastCalledWith(...changed({}));
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.posts-never-fetches+2]
  it("an idle tab posts nothing, even when hidden or closed", async () => {
    const { parent, listeners, document, fetch } = runShim(baseCtx);
    document.visibilityState = "hidden";
    listeners["doc:visibilitychange"]!();
    listeners["pagehide"]!();
    await endOfTask();
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.writes-through-shell+2]
  it("posts an unposted change at once on pagehide, and not again after", async () => {
    const { ls, parent, listeners } = runShim(baseCtx);
    ls.setItem("greeting", "bye");
    listeners["pagehide"]!();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    await endOfTask();
    listeners["pagehide"]!();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  it("posts an unposted change when the page is hidden", () => {
    const { ls, parent, listeners, document } = runShim(baseCtx);
    ls.setItem("greeting", "bye");
    document.visibilityState = "hidden";
    listeners["doc:visibilitychange"]!();
    expect(parent.postMessage).toHaveBeenCalledWith(...changed({ greeting: "bye" }));
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.read-only-throws]
  it("read-only context throws on write, still serves reads, and posts nothing", async () => {
    const { ls, parent, listeners } = runShim({ ...baseCtx, writable: false });
    expect(ls.getItem("greeting")).toBe("hi");
    for (const write of [
      () => ls.setItem("x", "1"),
      () => ls.removeItem("greeting"),
      () => ls.clear(),
    ]) {
      expect(write).toThrowError(expect.objectContaining({ name: "QuotaExceededError" }));
    }
    await endOfTask();
    listeners["pagehide"]!();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  it("carries the channel of the token that seeded it, so a navigated-to page can't forge a change", async () => {
    const { ls, parent } = runShim({ ...baseCtx, channel: "chan-xyz" });
    ls.setItem("a", "1");
    await endOfTask();
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "chan-xyz" }),
      baseCtx.targetOrigin,
    );
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.posts-never-fetches+2]
  // r[verify data.shell.writes-pinned+2]
  it("reports the updatedAt it was seeded with, or null with no entry", async () => {
    const { ls, parent } = runShim({ ...baseCtx, seedUpdatedAt: null });
    ls.setItem("a", "1");
    await endOfTask();
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ seed: null }),
      baseCtx.targetOrigin,
    );
  });

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify data.shim.posts-never-fetches+2]
  it("names no endpoint and no pin: the shell decides where and how a change is saved", () => {
    expect(bootstrapInnerJs(baseCtx)).not.toMatch(/fetch\(|\/api\/|If-Match/);
  });
});
