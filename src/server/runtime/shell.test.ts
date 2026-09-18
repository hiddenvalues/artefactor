import { describe, expect, it, vi } from "vitest";
import {
  renderHostShell,
  shellFrameJs,
  type HostShellContext,
  type ShellFrameConfig,
} from "./shell";
import { FRAME_SANDBOX_FLAGS } from "./sandbox";

const ctx: HostShellContext = {
  title: "Tracker",
  kind: "form",
  updatedAt: "2026-09-12T10:00:00.000Z",
  frameUrl: "/a/slug1/frame?t=tok0",
  channel: "chan-0",
  mintEndpoint: "/api/artefacts/slug1/frame-token",
  dataEndpoint: "/api/artefacts/slug1/data/me",
  seedUpdatedAt: "2026-09-12T09:00:00.000Z",
  authorsEndpoint: "/api/artefacts/slug1/data/authors",
  viewersEndpoint: "/api/artefacts/slug1/viewers",
  viewerId: "u1",
  ownerId: "u1",
  usesStorage: true,
};

describe("host shell — sandboxed frame (S36)", () => {
  it("frames the artefact with exactly the sandbox flags, never same-origin", () => {
    const html = renderHostShell(ctx);
    const iframe = html.match(/<iframe[^>]*>/)![0];
    expect(iframe).toContain(`sandbox="${FRAME_SANDBOX_FLAGS}"`);
    expect(iframe).toContain('allow="clipboard-write; fullscreen"');
    expect(iframe).not.toMatch(/allow-same-origin|allow-top-navigation/);
  });

  it("renders a hidden conflict banner with a reload action for a signed-in viewer (S31)", () => {
    const html = renderHostShell(ctx);
    expect(html).toMatch(/<div[^>]*id="ae-conflict"[^>]*hidden/);
    expect(html).toContain('id="ae-conflict-reload"');
    expect(html).toMatch(/changed elsewhere/i);
  });

  it("omits the banner for anonymous viewers, whose context is never writable", () => {
    expect(renderHostShell({ ...ctx, viewerId: null })).not.toContain('id="ae-conflict"');
  });

  it("no longer listens for a frame-sent conflict message: the shell detects 412 itself", () => {
    expect(renderHostShell(ctx)).not.toContain("artefactor:data-conflict");
  });
});

interface FakeResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
const saved = (updatedAt: string): FakeResponse => ({
  status: 200,
  ok: true,
  json: async () => ({ blob: "{}", updatedAt }),
});
const minted = (
  frameUrl: string,
  seedUpdatedAt: string | null,
  channel = "chan-minted",
): FakeResponse => ({
  status: 200,
  ok: true,
  json: async () => ({ frameUrl, seedUpdatedAt, channel }),
});
const PRECONDITION_FAILED: FakeResponse = {
  status: 412,
  ok: false,
  json: async () => ({ error: "conflict" }),
};

const frameCfg: ShellFrameConfig = {
  frameUrl: ctx.frameUrl,
  viewerId: "u1",
  mintEndpoint: ctx.mintEndpoint,
  dataEndpoint: ctx.dataEndpoint,
  seedUpdatedAt: "2026-09-12T09:00:00.000Z",
  channel: "chan-0",
};

// Evaluate the shell's frame controller with injected globals, as the shim tests
// do. `respond` answers each request in order (default: a save at a fixed time).
function runShell(
  cfg: ShellFrameConfig,
  respond: (url: string, init: RequestInit, n: number) => FakeResponse | Promise<FakeResponse> = () =>
    saved("2026-09-12T12:00:00.000Z"),
) {
  const listeners: Record<string, (e?: unknown) => void> = {};
  const contentWindow = { name: "frame" };
  const frame = { src: "", contentWindow };
  const conflict = { hidden: true };
  const reloadListeners: Record<string, () => void> = {};
  const reload = { addEventListener: (ev: string, cb: () => void) => (reloadListeners[ev] = cb) };
  const elements: Record<string, unknown> = {
    "ae-frame": frame,
    "ae-conflict": conflict,
    "ae-conflict-reload": reload,
  };
  const window = {
    addEventListener: (ev: string, cb: (e?: unknown) => void) => (listeners[ev] = cb),
  };
  const document = { getElementById: (id: string) => elements[id] ?? null };
  let n = 0;
  const fetch = vi.fn((url: string, init: RequestInit) => Promise.resolve(respond(url, init, ++n)));
  const api = new Function(
    "window",
    "document",
    "fetch",
    "TextEncoder",
    `return ${shellFrameJs(cfg)};`,
  )(window, document, fetch, TextEncoder) as { select: (authorId: string) => void };

  const fromFrame = (data: unknown) => listeners["message"]!({ source: contentWindow, origin: "null", data });
  const changed = (blob: Record<string, string>, channel = cfg.channel) =>
    fromFrame({ type: "artefactor:data-changed", blob: JSON.stringify(blob), channel });
  const puts = () => fetch.mock.calls.filter(([, init]) => init.method === "PUT");
  const mints = () => fetch.mock.calls.filter(([url]) => url === cfg.mintEndpoint);
  return {
    api, fetch, frame, conflict, listeners, contentWindow, fromFrame, changed, puts, mints,
    clickReload: () => reloadListeners["click"]!(),
  };
}

const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("host shell — persistence through the shell (S36, AD10)", () => {
  it("loads the frame URL it was rendered with", () => {
    expect(runShell(frameCfg).frame.src).toBe(frameCfg.frameUrl);
    expect(runShell({ ...frameCfg, viewerId: null }).frame.src).toBe(frameCfg.frameUrl);
  });

  it("ignores a data-changed message that doesn't come from its frame's window", async () => {
    const s = runShell(frameCfg);
    s.listeners["message"]!({
      source: { name: "someone else" },
      origin: "https://evil.example",
      data: { type: "artefactor:data-changed", blob: "{}" },
    });
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("doesn't listen to the frame at all when the viewer is anonymous", () => {
    const s = runShell({ ...frameCfg, viewerId: null });
    expect(s.listeners["message"]).toBeUndefined();
    expect(s.listeners["pagehide"]).toBeUndefined();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("from its frame in the viewer's own context: one PUT to the fixed endpoint, pinned with If-Match", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    await settle();
    expect(s.puts()).toHaveLength(1);
    const [url, init] = s.puts()[0]!;
    expect(url).toBe(frameCfg.dataEndpoint);
    expect(init.body).toBe('{"a":"1"}');
    expect(init.credentials).toBe("same-origin");
    expect(headersOf(init)["If-Match"]).toBe('"2026-09-12T09:00:00.000Z"');
  });

  it("with no seeded entry, pins the write to 'none exists' (If-None-Match: *)", async () => {
    const s = runShell({ ...frameCfg, seedUpdatedAt: null });
    s.changed({ a: "1" });
    await settle();
    const h = headersOf(s.puts()[0]![1]);
    expect(h["If-None-Match"]).toBe("*");
    expect(h["If-Match"]).toBeUndefined();
  });

  // S36 — `event.source` names the browsing context, not the document: the
  // sandboxed frame may navigate itself, and what it navigates to keeps the same
  // window. Only the document the shell's own frame URL loaded knows the channel.
  it("ignores a change that carries no channel, or another document's", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: '{"a":"1"}' });
    s.changed({ a: "1" }, "chan-someone-else");
    s.changed({ a: "1" }, null);
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("after a re-mint, the previous document's channel no longer saves", async () => {
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=fresh", "2026-09-12T09:00:00.000Z", "chan-1")
        : saved("2026-09-12T12:00:00.000Z"),
    );
    s.fromFrame({ type: "artefactor:frame-token-expired" });
    await settle();
    await settle();
    expect(s.frame.src).toBe("/a/slug1/frame?t=fresh");

    s.changed({ a: "1" }, "chan-0");
    await settle();
    expect(s.puts()).toHaveLength(0);

    s.changed({ a: "1" }, "chan-1");
    await settle();
    expect(s.puts()).toHaveLength(1);
  });

  it("a message never chooses the URL: extra fields are ignored", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({
      type: "artefactor:data-changed",
      blob: "{}",
      channel: frameCfg.channel,
      endpoint: "/api/artefacts/other/visibility",
      author: "u2",
    });
    await settle();
    expect(s.fetch.mock.calls.map(([url]) => url)).toEqual([frameCfg.dataEndpoint]);
  });

  it("ignores a data-changed message whose blob isn't a string", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: { a: 1 } });
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("pins the next write to the updatedAt its own save returned", async () => {
    const s = runShell(frameCfg, () => saved("2026-09-12T10:05:00.000Z"));
    s.changed({ a: "1" });
    await settle();
    s.changed({ a: "2" });
    await settle();
    expect(s.puts()).toHaveLength(2);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T10:05:00.000Z"');
  });

  it("never overlaps saves: changes during a save go after it, with the new pin, carrying only the latest blob", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (_u, _i, n) =>
      n === 1 ? new Promise<FakeResponse>((res) => (release = res)) : saved("2026-09-12T10:09:00.000Z"),
    );
    s.changed({ a: "1" });
    await settle();
    s.changed({ a: "2" });
    s.changed({ a: "3" });
    await settle();
    expect(s.puts()).toHaveLength(1);

    release(saved("2026-09-12T10:08:00.000Z"));
    await settle();
    await settle();
    expect(s.puts()).toHaveLength(2);
    const [, second] = s.puts()[1]!;
    expect(second.body).toBe('{"a":"3"}');
    expect(headersOf(second)["If-Match"]).toBe('"2026-09-12T10:08:00.000Z"');
  });

  it("keeps a failed save for the next change, without a retry loop", async () => {
    const s = runShell(frameCfg, (_u, _i, n) =>
      n === 1 ? { status: 500, ok: false, json: async () => ({}) } : saved("2026-09-12T10:10:00.000Z"),
    );
    s.changed({ a: "1" });
    await settle();
    await settle();
    expect(s.puts()).toHaveLength(1);
    s.changed({ a: "2" });
    await settle();
    expect(s.puts()).toHaveLength(2);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T09:00:00.000Z"');
  });

  it("on its own pagehide, flushes an unsent change with keepalive", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (_u, _i, n) =>
      n === 1 ? new Promise<FakeResponse>((res) => (release = res)) : saved("2026-09-12T10:09:00.000Z"),
    );
    s.changed({ a: "1" });
    await settle();
    s.changed({ a: "2" }); // waits behind the in-flight save
    s.listeners["pagehide"]!();
    expect(s.puts()).toHaveLength(2);
    expect(s.puts()[1]![1].keepalive).toBe(true);
    release(saved("2026-09-12T10:08:00.000Z"));
  });

  it("a pagehide with nothing unsent sends nothing", async () => {
    const s = runShell(frameCfg);
    s.listeners["pagehide"]!();
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("412 → shows the conflict banner and sends no further PUTs; Reload re-mints and re-seeds", async () => {
    const s = runShell(frameCfg, (url, _i, n) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=tok1", "2026-09-12T11:00:00.000Z")
        : n === 1
          ? PRECONDITION_FAILED
          : saved("2026-09-12T11:30:00.000Z"),
    );
    s.changed({ a: "stale-tab" });
    await settle();
    await settle();
    expect(s.conflict.hidden).toBe(false);

    s.changed({ a: "more" });
    s.listeners["pagehide"]!();
    await settle();
    expect(s.puts()).toHaveLength(1);

    s.clickReload();
    await settle();
    await settle();
    expect(s.mints()).toHaveLength(1);
    expect(JSON.parse(s.mints()[0]![1].body as string)).toEqual({});
    expect(s.frame.src).toBe("/a/slug1/frame?t=tok1");
    expect(s.conflict.hidden).toBe(true);

    s.changed({ a: "after-reload" }, "chan-minted");
    await settle();
    expect(s.puts()).toHaveLength(2);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T11:00:00.000Z"');
  });

  it("selecting another author mints for that author, and then ignores the frame's changes", async () => {
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint ? minted("/a/slug1/frame?t=author", null) : saved("x"),
    );
    s.api.select("u2");
    await settle();
    await settle();
    expect(JSON.parse(s.mints()[0]![1].body as string)).toEqual({ author: "u2" });
    expect(s.frame.src).toBe("/a/slug1/frame?t=author");

    s.changed({ a: "1" });
    await settle();
    expect(s.puts()).toHaveLength(0);
  });

  it("switching back to the viewer's own data re-seeds the pin and saves again", async () => {
    const s = runShell(frameCfg, (url, init) =>
      url === frameCfg.mintEndpoint
        ? JSON.parse(init.body as string).author
          ? minted("/a/slug1/frame?t=author", null)
          : minted("/a/slug1/frame?t=own", "2026-09-12T13:00:00.000Z")
        : saved("x"),
    );
    s.api.select("u2");
    await settle();
    await settle();
    s.api.select("");
    await settle();
    await settle();
    expect(s.frame.src).toBe("/a/slug1/frame?t=own");
    s.changed({ a: "1" }, "chan-minted");
    await settle();
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBe('"2026-09-12T13:00:00.000Z"');
  });

  it("a failed author switch keeps the viewer's own context: the frame's changes still save", async () => {
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? { status: 500, ok: false, json: async () => ({}) }
        : saved("2026-09-12T10:05:00.000Z"),
    );
    s.api.select("u2");
    await settle();
    await settle();
    expect(s.frame.src).toBe(frameCfg.frameUrl);
    s.changed({ a: "still mine" });
    await settle();
    expect(s.puts()).toHaveLength(1);
  });

  it("a change arriving after its own pagehide is sent with keepalive", async () => {
    const s = runShell(frameCfg);
    s.listeners["pagehide"]!();
    s.changed({ a: "last edit" });
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
  });

  it("back from the bfcache (pageshow), saves stop forcing keepalive", async () => {
    const s = runShell(frameCfg);
    s.listeners["pagehide"]!();
    s.listeners["pageshow"]!();
    s.changed({ a: "1" });
    await settle();
    expect(s.puts()[0]![1].keepalive).toBe(false);
  });

  it("frame-token-expired from its frame → one mint for the current context, and the frame reloads with it", async () => {
    const s = runShell(frameCfg, () => minted("/a/slug1/frame?t=fresh", "2026-09-12T09:00:00.000Z"));
    s.fromFrame({ type: "artefactor:frame-token-expired" });
    await settle();
    await settle();
    expect(s.mints()).toHaveLength(1);
    expect(s.mints()[0]![1].method).toBe("POST");
    expect(s.frame.src).toBe("/a/slug1/frame?t=fresh");
  });

  it("ignores frame-token-expired from any other source", async () => {
    const s = runShell(frameCfg, () => minted("/a/slug1/frame?t=fresh", null));
    s.listeners["message"]!({ source: {}, origin: "null", data: { type: "artefactor:frame-token-expired" } });
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.frame.src).toBe(frameCfg.frameUrl);
  });

  it("the shell never posts anything to the frame", () => {
    expect(shellFrameJs(frameCfg)).not.toContain("postMessage");
  });
});
