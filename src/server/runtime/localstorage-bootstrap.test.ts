import { describe, expect, it, vi } from "vitest";
import {
  bootstrapInnerJs,
  injectBootstrap,
  renderArtefactHtml,
  type BootstrapContext,
} from "./localstorage-bootstrap";

const baseCtx: BootstrapContext = {
  seedBlob: '{"greeting":"hi"}',
  seedUpdatedAt: "2026-09-12T09:00:00.000Z",
  writable: true,
  endpoint: "/api/artefacts/ref1/data/me",
  maxBytes: 5 * 1024 * 1024,
};

describe("injectBootstrap", () => {
  it("inserts the script right after <head>, before existing scripts", () => {
    const html = "<html><head><title>t</title><script>app()</script></head><body></body></html>";
    const out = injectBootstrap(html, "<script>SHIM</script>");
    expect(out.indexOf("SHIM")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("SHIM")).toBeLessThan(out.indexOf("app()"));
  });

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

interface FakeResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

// A successful `PUT …/data/me` response carrying the new `updatedAt`.
function saved(updatedAt: string): FakeResponse {
  return { status: 200, ok: true, json: async () => ({ blob: "{}", updatedAt }) };
}
const PRECONDITION_FAILED: FakeResponse = {
  status: 412,
  ok: false,
  json: async () => ({ error: "conflict" }),
};

// Evaluate the shim IIFE with mocked browser globals to prove its behaviour.
// `respond` decides each PUT's response (default: a save at a fixed time).
function runShim(
  ctx: BootstrapContext,
  respond: (n: number) => FakeResponse | Promise<FakeResponse> = () =>
    saved("2026-09-12T12:00:00.000Z"),
) {
  const listeners: Record<string, (e?: unknown) => void> = {};
  const parent = { postMessage: vi.fn() };
  const window: Record<string, unknown> = {
    addEventListener: (ev: string, cb: () => void) => (listeners[ev] = cb),
    parent,
    location: { origin: "https://artefactor.test" },
  };
  const document = {
    addEventListener: (ev: string, cb: () => void) => (listeners["doc:" + ev] = cb),
    visibilityState: "visible",
  };
  let n = 0;
  const fetch = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(respond(++n)),
  );
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
  return { ls: window.localStorage as Storage, fetch, listeners, window, parent, document };
}

const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>;

describe("localStorage shim (S13)", () => {
  it("serves seeded reads synchronously", () => {
    const { ls } = runShim(baseCtx);
    expect(ls.getItem("greeting")).toBe("hi");
    expect(ls.getItem("missing")).toBeNull();
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe("greeting");
  });

  it("writes update the map and schedule a PUT flush", () => {
    vi.useFakeTimers();
    const { ls, fetch } = runShim(baseCtx);
    ls.setItem("greeting", "bye");
    ls.setItem("n", "2");
    expect(ls.getItem("greeting")).toBe("bye");
    expect(ls.length).toBe(2);
    // Debounced — one flush after the window elapses.
    vi.runAllTimers();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(baseCtx.endpoint);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ greeting: "bye", n: "2" });
    vi.useRealTimers();
  });

  it("throws QuotaExceededError over the cap and reverts the write", () => {
    const { ls } = runShim({ ...baseCtx, maxBytes: 40 });
    expect(() => ls.setItem("big", "x".repeat(100))).toThrowError(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    // Reverted: the failed key is not present.
    expect(ls.getItem("big")).toBeNull();
    expect(ls.getItem("greeting")).toBe("hi");
  });

  it("read-only context throws on write but still serves reads", () => {
    const { ls, fetch } = runShim({ ...baseCtx, writable: false });
    expect(ls.getItem("greeting")).toBe("hi");
    expect(() => ls.setItem("x", "1")).toThrowError(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flushes on pagehide", () => {
    const { ls, fetch, listeners } = runShim(baseCtx);
    ls.setItem("greeting", "bye");
    listeners["pagehide"]!();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// S31 — an open tab must neither block nor silently revert an agent's write.
describe("localStorage shim — only dirty, pinned writes (S31)", () => {
  const SEEDED_AT = "2026-09-12T10:00:00.000Z";
  const pinned: BootstrapContext = { ...baseCtx, seedUpdatedAt: SEEDED_AT };

  it("an idle tab never writes: hiding or closing it without a change sends nothing", () => {
    const { fetch, listeners, document } = runShim(pinned);
    document.visibilityState = "hidden";
    listeners["doc:visibilitychange"]!();
    listeners["pagehide"]!();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not re-send on hide once the debounced save already went out", async () => {
    vi.useFakeTimers();
    const { ls, fetch, listeners } = runShim(pinned);
    ls.setItem("greeting", "bye");
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    listeners["pagehide"]!();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("pins each write to the updatedAt it was seeded with (If-Match)", () => {
    const { ls, fetch, listeners } = runShim(pinned);
    ls.setItem("greeting", "bye");
    listeners["pagehide"]!();
    expect(headersOf(fetch.mock.calls[0]![1])["If-Match"]).toBe(`"${SEEDED_AT}"`);
  });

  it("with no seeded entry, pins the write to 'none exists' (If-None-Match: *)", () => {
    const { ls, fetch, listeners } = runShim({ ...baseCtx, seedBlob: "{}", seedUpdatedAt: null });
    ls.setItem("greeting", "bye");
    listeners["pagehide"]!();
    const h = headersOf(fetch.mock.calls[0]![1]);
    expect(h["If-None-Match"]).toBe("*");
    expect(h["If-Match"]).toBeUndefined();
  });

  it("adopts the updatedAt of its own successful save as the next pin", async () => {
    vi.useFakeTimers();
    const { ls, fetch } = runShim(pinned, () => saved("2026-09-12T10:05:00.000Z"));
    ls.setItem("greeting", "one");
    await vi.runAllTimersAsync();
    ls.setItem("greeting", "two");
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(headersOf(fetch.mock.calls[1]![1])["If-Match"]).toBe('"2026-09-12T10:05:00.000Z"');
    vi.useRealTimers();
  });

  it("never overlaps saves: an edit made while one is in flight goes out after it, with the new pin", async () => {
    vi.useFakeTimers();
    let release!: (r: FakeResponse) => void;
    const { ls, fetch } = runShim(pinned, (n) =>
      n === 1
        ? new Promise<FakeResponse>((res) => (release = res))
        : saved("2026-09-12T10:09:00.000Z"),
    );
    ls.setItem("greeting", "one");
    await vi.runAllTimersAsync(); // first save in flight
    ls.setItem("greeting", "two");
    await vi.runAllTimersAsync(); // debounce elapses while still in flight
    expect(fetch).toHaveBeenCalledTimes(1);

    release(saved("2026-09-12T10:08:00.000Z"));
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, second] = fetch.mock.calls[1]!;
    expect(JSON.parse(second.body as string)).toEqual({ greeting: "two" });
    expect(headersOf(second)["If-Match"]).toBe('"2026-09-12T10:08:00.000Z"');
    vi.useRealTimers();
  });

  it("on 412 stops writing, keeps working in memory, and tells the host shell", async () => {
    vi.useFakeTimers();
    const { ls, fetch, parent, listeners } = runShim(pinned, () => PRECONDITION_FAILED);
    ls.setItem("greeting", "stale-tab");
    await vi.runAllTimersAsync();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "artefactor:data-conflict" },
      "https://artefactor.test",
    );

    // The artefact keeps running on its in-memory copy, but nothing more is sent
    // — the tab can no longer overwrite the newer saved data.
    ls.setItem("greeting", "more");
    expect(ls.getItem("greeting")).toBe("more");
    await vi.runAllTimersAsync();
    listeners["pagehide"]!();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
