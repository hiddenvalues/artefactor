import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_HOLD_MAX_MS,
  MINT_WAIT_MAX_MS,
  SAVE_DELAY_MS,
  renderHostShell,
  shellFrameJs,
  type HostShellContext,
  type ShellFrameConfig,
} from "./shell";
import { FRAME_SANDBOX_FLAGS } from "./sandbox";
import { SHELL_TOKENS } from "./shell-theme";
import { KIND_PRESENTATION } from "../../shared/kind-presentation";
import { THEME_BOOT_JS } from "../../shared/theme-boot";

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
  // r[verify hosting.frame.sandboxed]
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

// S45 — App dark mode with a UI toggle: the chrome follows the viewer's theme.
describe("host shell — theme (S45)", () => {
  const html = renderHostShell(ctx);
  const head = html.slice(0, html.indexOf("</head>"));
  const withoutScripts = html.replace(/<script>[\s\S]*?<\/script>/g, "");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const rule = (selector: string) => head.match(new RegExp(`${esc(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  // r[verify platform.theme.shell-markup]
  it("inlines the theme boot script in its head, before the style", () => {
    const at = head.indexOf(THEME_BOOT_JS);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(head.indexOf("<style>"));
  });

  // r[verify platform.theme.shell-markup]
  it("carries no hex or rgb colour literal in its markup and CSS", () => {
    expect(withoutScripts).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("declares the Ruby tokens in :root and in .dark", () => {
    expect(SHELL_TOKENS.light.background).toBe("oklch(1 0 0)");
    expect(SHELL_TOKENS.dark.background).toBe("oklch(0.17 0.004 340)");
    expect(rule(":root")).toContain(`--background: ${SHELL_TOKENS.light.background};`);
    expect(rule(".dark")).toContain(`--background: ${SHELL_TOKENS.dark.background};`);
  });

  // r[verify platform.theme.shell-markup]
  it("strokes the kind icon with var(--kind) and emits the kind colour for both modes", () => {
    const form = KIND_PRESENTATION.form;
    expect(html).toMatch(/<svg[^>]*stroke="var\(--kind\)"/);
    expect(html).not.toContain(`stroke="${form.color}"`);
    expect(rule(":root")).toContain(`--kind: ${form.color};`);
    expect(rule(":root")).toContain(`--kind-tint: ${form.tint};`);
    expect(rule(".dark")).toContain(`--kind: ${form.darkColor};`);
    expect(rule(".dark")).toContain(`--kind-tint: ${form.darkTint};`);
  });

  // r[verify platform.theme.frame-unthemed]
  it("puts nothing theme-related on the frame", () => {
    const iframe = html.match(/<iframe[^>]*>/)![0];
    expect(iframe).not.toMatch(/theme|dark|color-scheme/i);
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
  // The frame's own listeners, and which were attached when its src was first set.
  const frameListeners: Record<string, Array<() => void>> = {};
  let listenedAtFirstSrc: string[] | null = null;
  // Pending timers when its src was first set (meaningful under fake timers).
  let timersAtFirstSrc: number | null = null;
  const attrs: Record<string, string> = { "aria-busy": "true" };
  let src = "";
  const frame = {
    contentWindow,
    get src() { return src; },
    set src(v: string) {
      if (listenedAtFirstSrc === null) {
        listenedAtFirstSrc = Object.keys(frameListeners);
        timersAtFirstSrc = vi.isFakeTimers() ? vi.getTimerCount() : null;
      }
      src = v;
    },
    addEventListener: (ev: string, cb: () => void, opts?: { once?: boolean }) => {
      const list = (frameListeners[ev] ??= []);
      const wrapped = opts?.once
        ? () => { list.splice(list.indexOf(wrapped), 1); cb(); }
        : cb;
      list.push(wrapped);
    },
    getAttribute: (name: string) => attrs[name] ?? null,
    removeAttribute: (name: string) => { delete attrs[name]; },
  };
  const rootClasses = new Set(["ae-hold"]);
  const documentElement = {
    classList: {
      add: (c: string) => rootClasses.add(c),
      remove: (c: string) => rootClasses.delete(c),
      contains: (c: string) => rootClasses.has(c),
    },
  };
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
    removeEventListener: (ev: string, cb: (e?: unknown) => void) => {
      if (listeners[ev] === cb) delete listeners[ev];
    },
  };
  const document = {
    documentElement,
    getElementById: (id: string) => elements[id] ?? null,
    addEventListener: (ev: string, cb: (e?: unknown) => void) => (listeners["doc:" + ev] = cb),
    visibilityState: "visible",
  };
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
  const hide = () => {
    document.visibilityState = "hidden";
    listeners["doc:visibilitychange"]!();
  };
  return {
    api, fetch, frame, conflict, listeners, contentWindow, fromFrame, changed, puts, mints, hide,
    clickReload: () => reloadListeners["click"]!(),
    frameLoaded: () => [...(frameListeners["load"] ?? [])].forEach((cb) => cb()),
    held: () => rootClasses.has("ae-hold"),
    busy: () => attrs["aria-busy"] === "true",
    listenedAtFirstSrc: () => listenedAtFirstSrc,
    timersAtFirstSrc: () => timersAtFirstSrc,
    raiseHold: () => { rootClasses.add("ae-hold"); attrs["aria-busy"] = "true"; },
  };
}

const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("host shell — persistence through the shell (S36)", () => {
  // S81 — the shell debounces its saves: run on fake timers, and let each
  // settle pass the save delay.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = () => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);

  it("loads the frame URL it was rendered with", () => {
    expect(runShell(frameCfg).frame.src).toBe(frameCfg.frameUrl);
    expect(runShell({ ...frameCfg, viewerId: null }).frame.src).toBe(frameCfg.frameUrl);
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.saves-only-own-frame]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shim.writes-through-shell+2]
  // r[verify data.shell.writes-pinned+2]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.writes-pinned+2]
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
  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.channel-binds-document]
  it("ignores a change that carries no channel, or another document's", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: '{"a":"1"}' });
    s.changed({ a: "1" }, "chan-someone-else");
    s.changed({ a: "1" }, null);
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.channel-binds-document]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.saves-only-own-frame]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("ignores a data-changed message whose blob isn't a string", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: { a: 1 } });
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.writes-pinned+2]
  it("pins the next write to the updatedAt its own save returned", async () => {
    const s = runShell(frameCfg, () => saved("2026-09-12T10:05:00.000Z"));
    s.changed({ a: "1" });
    await settle();
    s.changed({ a: "2" });
    await settle();
    expect(s.puts()).toHaveLength(2);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T10:05:00.000Z"');
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.writes-pinned+2]
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

  // r[verify data.shim.writes-through-shell+2]
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

  // r[verify data.shell.writes-pinned+2]
  it("a pagehide with nothing unsent sends nothing", async () => {
    const s = runShell(frameCfg);
    s.listeners["pagehide"]!();
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.writes-pinned+2]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  // r[verify data.shell.saves-only-own-frame]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
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

  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("frame-token-expired from its frame → one mint for the current context, and the frame reloads with it", async () => {
    const s = runShell(frameCfg, () => minted("/a/slug1/frame?t=fresh", "2026-09-12T09:00:00.000Z"));
    s.fromFrame({ type: "artefactor:frame-token-expired" });
    await settle();
    await settle();
    expect(s.mints()).toHaveLength(1);
    expect(s.mints()[0]![1].method).toBe("POST");
    expect(s.frame.src).toBe("/a/slug1/frame?t=fresh");
  });

  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("ignores frame-token-expired from any other source", async () => {
    const s = runShell(frameCfg, () => minted("/a/slug1/frame?t=fresh", null));
    s.listeners["message"]!({ source: {}, origin: "null", data: { type: "artefactor:frame-token-expired" } });
    await settle();
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.frame.src).toBe(frameCfg.frameUrl);
  });

  // r[verify data.shell.saves-only-own-frame]
  it("the shell never posts anything to the frame", () => {
    expect(shellFrameJs(frameCfg)).not.toContain("postMessage");
  });
});

// S81 — A change made just before a reload is saved: the shell debounces, the
// frame posts at once. The frame hands over each change as it happens, so the
// latest one is always on the side that survives the unload.
describe("host shell — debounces and flushes (S81)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // r[verify data.shell.debounces-and-flushes]
  // r[verify data.shim.writes-through-shell+2]
  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("sends one PUT the save delay after a change, not before", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(s.puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].body).toBe('{"a":"1"}');
    expect(s.puts()[0]![1].keepalive).toBe(false);
  });

  // r[verify data.shell.debounces-and-flushes]
  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("a burst of changes is one PUT, the save delay after the last, carrying the last blob", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(200);
    s.changed({ a: "2" });
    await vi.advanceTimersByTimeAsync(200);
    s.changed({ a: "3" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(s.puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].body).toBe('{"a":"3"}');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("on its own pagehide, flushes a held change at once with keepalive, and not again when the delay ends", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(100);
    s.listeners["pagehide"]!();
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("when it goes hidden, flushes a held change at once with keepalive", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    s.hide();
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBe('"2026-09-12T09:00:00.000Z"');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  // r[verify data.shell.writes-pinned+2]
  it("an idle tab hidden or closed sends nothing", async () => {
    const s = runShell(frameCfg);
    s.hide();
    s.listeners["pagehide"]!();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  // Going hidden (or a beforeunload) doesn't mean the page is gone: a save in
  // flight still settles, so the held change waits for it rather than racing it
  // under the same pin into a spurious 412. Only pagehide forces an overlap.
  // r[verify data.shell.debounces-and-flushes]
  // r[verify data.shell.writes-pinned+2]
  it.each(["hidden", "beforeunload"])("%s during a save in flight doesn't overlap it: the held change goes after, with the new pin", async (ev) => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (_u, _i, n) =>
      n === 1 ? new Promise<FakeResponse>((res) => (release = res)) : saved("2026-09-12T10:09:00.000Z"),
    );
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(s.puts()).toHaveLength(1);
    s.changed({ a: "2" });
    if (ev === "hidden") s.hide();
    else s.listeners["beforeunload"]!();
    expect(s.puts()).toHaveLength(1);

    release(saved("2026-09-12T10:08:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.puts()).toHaveLength(2);
    const [, second] = s.puts()[1]!;
    expect(second.body).toBe('{"a":"2"}');
    expect(headersOf(second)["If-Match"]).toBe('"2026-09-12T10:08:00.000Z"');
    // The page may be going: the change that waited still leaves with keepalive.
    expect(second.keepalive).toBe(true);
    expect(s.conflict.hidden).toBe(true);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("an expired frame token re-mints only once the held change has saved, so the re-seeded frame sees it", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=fresh", "2026-09-12T12:00:00.000Z")
        : new Promise<FakeResponse>((res) => (release = res)),
    );
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(100);
    s.fromFrame({ type: "artefactor:frame-token-expired" });
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].body).toBe('{"a":"1"}');
    expect(s.mints()).toHaveLength(0);

    release(saved("2026-09-12T12:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [frameCfg.dataEndpoint, "PUT"],
      [frameCfg.mintEndpoint, "POST"],
    ]);
    expect(s.frame.src).toBe("/a/slug1/frame?t=fresh");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("a context switch during a save in flight sends the held change after it, then mints, and drops nothing", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (url, _i, n) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=author", null)
        : n === 1
          ? new Promise<FakeResponse>((res) => (release = res))
          : saved("2026-09-12T10:09:00.000Z"),
    );
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    s.changed({ a: "2" });
    s.api.select("author-2");
    expect(s.puts()).toHaveLength(1);
    expect(s.mints()).toHaveLength(0);

    release(saved("2026-09-12T10:08:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [frameCfg.dataEndpoint, "PUT"],
      [frameCfg.dataEndpoint, "PUT"],
      [frameCfg.mintEndpoint, "POST"],
    ]);
    expect(s.puts()[1]![1].body).toBe('{"a":"2"}');
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T10:08:00.000Z"');
  });

  // A change posted while the page is hidden isn't held for the delay: a
  // hidden page may be frozen or discarded at any time.
  // r[verify data.shell.debounces-and-flushes]
  it("a change arriving while hidden goes out at once", async () => {
    const s = runShell(frameCfg);
    s.hide();
    s.changed({ a: "1" });
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
  });

  // Browsers cap the keepalive bytes in flight across requests.
  // r[verify data.shell.debounces-and-flushes]
  it("keeps the keepalive bytes in flight under the cap: an overlapping flush that would pass it goes plain", async () => {
    const s = runShell(frameCfg, () => new Promise<FakeResponse>(() => {}));
    const big = "x".repeat(40 * 1024);
    s.changed({ a: big });
    s.hide();
    expect(s.puts()[0]![1].keepalive).toBe(true);
    s.changed({ a: big + "y" });
    s.listeners["pagehide"]!();
    expect(s.puts()).toHaveLength(2);
    expect(s.puts()[1]![1].keepalive).toBe(false);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("after a 412 it no longer listens for beforeunload, whatever the frame posts", async () => {
    const s = runShell(frameCfg, () => PRECONDITION_FAILED);
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(s.conflict.hidden).toBe(false);
    expect(s.listeners["beforeunload"]).toBeUndefined();
    s.changed({ a: "2" });
    s.hide();
    expect(s.listeners["beforeunload"]).toBeUndefined();
    expect(s.puts()).toHaveLength(1);
  });

  // An artefact that writes faster than a save round trip can't starve a
  // switch: the mint waits for the saves outstanding when it was asked for.
  // r[verify data.shell.debounces-and-flushes]
  it("a context switch waits for the saves outstanding then, not for later ones", async () => {
    const releases: Array<(r: FakeResponse) => void> = [];
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=author", null)
        : new Promise<FakeResponse>((res) => releases.push(res)),
    );
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS); // PUT 1 in flight
    s.changed({ a: "2" }); // held behind it
    s.api.select("author-2");
    s.changed({ a: "3" }); // the own frame is still live until the mint lands
    releases[0]!(saved("2026-09-12T10:01:00.000Z"));
    await vi.advanceTimersByTimeAsync(0); // PUT 2 ({"a":"3"}, the latest) goes
    expect(s.mints()).toHaveLength(0);
    releases[1]!(saved("2026-09-12T10:02:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.mints()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("a stalled save holds a context switch back at most MINT_WAIT_MAX_MS", async () => {
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint ? minted("/a/slug1/frame?t=author", null) : new Promise<FakeResponse>(() => {}),
    );
    s.changed({ a: "1" });
    s.api.select("author-2");
    expect(s.puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MINT_WAIT_MAX_MS - 1);
    expect(s.mints()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.mints()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.frame.src).toBe("/a/slug1/frame?t=author");
  });

  // r[verify data.shell.debounces-and-flushes]
  it("an expired frame token while a switch waits keeps the switch's target", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=author", null)
        : new Promise<FakeResponse>((res) => (release = res)),
    );
    s.changed({ a: "1" });
    s.api.select("author-2");
    s.fromFrame({ type: "artefactor:frame-token-expired" });
    release(saved("2026-09-12T10:01:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.mints()).toHaveLength(1);
    expect(s.mints()[0]![1].body).toBe(JSON.stringify({ author: "author-2" }));
  });

  // r[verify data.shell.debounces-and-flushes]
  it("back to the viewer's own data before a switch took effect cancels it and keeps the live frame", async () => {
    let release!: (r: FakeResponse) => void;
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint
        ? minted("/a/slug1/frame?t=author", null)
        : new Promise<FakeResponse>((res) => (release = res)),
    );
    s.changed({ a: "1" });
    s.api.select("author-2");
    s.api.select("");
    release(saved("2026-09-12T10:01:00.000Z"));
    await vi.advanceTimersByTimeAsync(MINT_WAIT_MAX_MS);
    expect(s.mints()).toHaveLength(0);
    expect(s.frame.src).toBe(frameCfg.frameUrl);
    s.changed({ a: "2" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(s.puts()).toHaveLength(2);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T10:01:00.000Z"');
  });

  // r[verify data.shell.debounces-and-flushes]
  it("releases the keepalive budget once a keepalive save settles", async () => {
    const s = runShell(frameCfg);
    const big = "x".repeat(40 * 1024);
    s.changed({ a: big });
    s.hide();
    expect(s.puts()[0]![1].keepalive).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    s.changed({ a: big + "y" });
    expect(s.puts()).toHaveLength(2);
    expect(s.puts()[1]![1].keepalive).toBe(true);
  });

  // An unconditional beforeunload listener costs the page Firefox's
  // back/forward cache: it is attached only while a change is held or in flight.
  // r[verify data.shell.debounces-and-flushes]
  it("listens for beforeunload only while it holds a change or a save is in flight", async () => {
    const s = runShell(frameCfg);
    expect(s.listeners["beforeunload"]).toBeUndefined();
    s.changed({ a: "1" });
    expect(s.listeners["beforeunload"]).toBeDefined();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(s.puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.listeners["beforeunload"]).toBeUndefined();
  });

  // r[verify data.shell.debounces-and-flushes]
  it("a context switch saves a held change, under the viewer's pin, before it mints", async () => {
    const s = runShell(frameCfg, (url) =>
      url === frameCfg.mintEndpoint ? minted("/a/slug1/frame?t=author", null) : saved("x"),
    );
    s.changed({ a: "1" });
    await vi.advanceTimersByTimeAsync(100);
    s.api.select("author-2");
    expect(s.mints()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [frameCfg.dataEndpoint, "PUT"],
      [frameCfg.mintEndpoint, "POST"],
    ]);
    expect(s.puts()[0]![1].body).toBe('{"a":"1"}');
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBe('"2026-09-12T09:00:00.000Z"');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // r[verify data.shell.debounces-and-flushes]
  it("on beforeunload, flushes a held change at once with keepalive, before the reload's own request", async () => {
    const s = runShell(frameCfg);
    s.changed({ a: "1" });
    s.listeners["beforeunload"]!();
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(s.puts()).toHaveLength(1);
  });

  // A reload's shell can render its pin before the previous page's flush
  // lands, and its frame be seeded after: the frame's seed is what its blob
  // was built on.
  // r[verify data.shell.writes-pinned+2]
  // r[verify hosting.frame.shell-saves-for-frame+2]
  it("pins to the seed its frame document reports, then advances it by its own saves", async () => {
    const s = runShell({ ...frameCfg, seedUpdatedAt: null });
    const seeded = (blob: string, seed: string | null) =>
      s.fromFrame({ type: "artefactor:data-changed", blob, channel: frameCfg.channel, seed });
    seeded('{"a":"1"}', "2026-09-12T10:00:00.000Z");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBe('"2026-09-12T10:00:00.000Z"');
    expect(headersOf(s.puts()[0]![1])["If-None-Match"]).toBeUndefined();

    // The same document keeps reporting its seed: its own save's pin wins.
    seeded('{"a":"2"}', "2026-09-12T10:00:00.000Z");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(headersOf(s.puts()[1]![1])["If-Match"]).toBe('"2026-09-12T12:00:00.000Z"');

    // The frame reloaded itself and was seeded anew.
    seeded('{"a":"3"}', "2026-09-12T13:00:00.000Z");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(headersOf(s.puts()[2]![1])["If-Match"]).toBe('"2026-09-12T13:00:00.000Z"');
  });

  // r[verify data.shell.writes-pinned+2]
  it("a frame seeded with no entry pins 'none exists', whatever was rendered", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: "{}", channel: frameCfg.channel, seed: null });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(headersOf(s.puts()[0]![1])["If-None-Match"]).toBe("*");
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBeUndefined();
  });

  // r[verify data.shell.writes-pinned+2]
  it("a seed that isn't a string or null is ignored: the rendered pin stays", async () => {
    const s = runShell(frameCfg);
    s.fromFrame({ type: "artefactor:data-changed", blob: "{}", channel: frameCfg.channel, seed: 42 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(headersOf(s.puts()[0]![1])["If-Match"]).toBe('"2026-09-12T09:00:00.000Z"');
  });

  // r[verify data.shell.debounces-and-flushes]
  it("a change arriving after its own pagehide goes out at once", async () => {
    const s = runShell(frameCfg);
    s.listeners["pagehide"]!();
    s.changed({ a: "late" });
    expect(s.puts()).toHaveLength(1);
    expect(s.puts()[0]![1].keepalive).toBe(true);
  });
});

// Runs `fn` under fake timers, so the frame controller's cap is driven by hand.
function withFakeTimers<T>(fn: () => T): T {
  vi.useFakeTimers();
  try {
    return fn();
  } finally {
    vi.useRealTimers();
  }
}

// S66 — Artefact opens without flicker: the shell holds until the frame has loaded.
describe("host shell — hold until the frame has loaded (S66)", () => {
  const variants: Array<[string, HostShellContext]> = [
    ["signed-in /a/:slug", ctx],
    ["anonymous /a/:slug", { ...ctx, viewerId: null }],
    [
      "owner preview (raw)",
      { ...ctx, frameUrl: "/api/artefacts/a1/raw/frame?t=tok0", mintEndpoint: "/api/artefacts/a1/frame-token" },
    ],
  ];

  // r[verify hosting.shell.hold-until-frame]
  it.each(variants)("renders held: html carries ae-hold, the frame is aria-busy (%s)", (_, c) => {
    const html = renderHostShell(c);
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(html).toMatch(/<html[^>]*class="ae-hold"/);
    expect(style).toMatch(/html\.ae-hold body > \*\s*\{\s*visibility: hidden;\s*\}/);
    // The canvas keeps painting the chrome's theme: the body background is outside the hold.
    expect(style).toMatch(/\n\s*body \{[^}]*background: var\(--background\)/);
    expect(style).not.toMatch(/html\.ae-hold[^{]*\{[^}]*background/);
    expect(style).not.toMatch(/transition/);
    const iframe = html.match(/<iframe[^>]*>/)![0];
    expect(iframe).toContain('aria-busy="true"');
    expect(iframe).not.toMatch(/\sstyle=|\ssrc=/);
  });

  // r[verify hosting.shell.hold-until-frame]
  it("wires the load listener and the cap before it assigns the frame URL", () =>
    withFakeTimers(() => {
      const s = runShell(frameCfg);
      expect(s.frame.src).toBe(frameCfg.frameUrl);
      expect(s.listenedAtFirstSrc()).toEqual(["load"]);
      expect(s.timersAtFirstSrc()).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
    }));

  // r[verify hosting.shell.hold-until-frame]
  it("the frame's load releases the hold", () =>
    withFakeTimers(() => {
      const s = runShell(frameCfg);
      expect(s.held()).toBe(true);
      expect(s.busy()).toBe(true);
      s.frameLoaded();
      expect(s.held()).toBe(false);
      expect(s.busy()).toBe(false);
    }));

  // r[verify hosting.shell.hold-until-frame]
  it("with no load, the cap releases the hold at FRAME_HOLD_MAX_MS, not before", () =>
    withFakeTimers(() => {
      expect(FRAME_HOLD_MAX_MS).toBe(3000);
      const s = runShell(frameCfg);
      vi.advanceTimersByTime(FRAME_HOLD_MAX_MS - 1);
      expect(s.held()).toBe(true);
      expect(s.busy()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(s.held()).toBe(false);
      expect(s.busy()).toBe(false);
    }));

  // r[verify hosting.shell.hold-until-frame]
  it("an anonymous viewer gets the same release", () =>
    withFakeTimers(() => {
      const s = runShell({ ...frameCfg, viewerId: null, channel: null });
      expect(s.listenedAtFirstSrc()).toEqual(["load"]);
      expect(s.timersAtFirstSrc()).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      s.frameLoaded();
      expect(s.held()).toBe(false);
      expect(s.busy()).toBe(false);
    }));

  // r[verify hosting.shell.hold-until-frame]
  it("is never raised again: an author switch, a second load and the late cap are no-ops", async () => {
    vi.useFakeTimers();
    try {
      const s = runShell(frameCfg, () => minted("/a/slug1/frame?t=author", null));
      s.frameLoaded();
      s.api.select("u2");
      await vi.advanceTimersByTimeAsync(0);
      expect(s.frame.src).toBe("/a/slug1/frame?t=author");
      expect(s.held()).toBe(false);
      // Raised by hand, so a second release would show: nothing releases it again.
      s.raiseHold();
      s.frameLoaded();
      vi.advanceTimersByTime(FRAME_HOLD_MAX_MS);
      expect(s.held()).toBe(true);
      expect(s.busy()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Evaluates the shell's inline boot script against a stub DOM, where every element
// is a plain object, and answers the viewers endpoint with `viewers` and the authors
// endpoint with `authors`.
function runBoot(
  viewers: () => Promise<FakeResponse>,
  { authors = [], usesStorage = true }: { authors?: Array<{ authorId: string }>; usesStorage?: boolean } = {},
) {
  const html = renderHostShell({ ...ctx, usesStorage });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  const boot = scripts[scripts.length - 1]!;
  const el = () => {
    const classes = new Set<string>();
    return {
      hidden: false,
      textContent: "",
      value: "",
      src: "",
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
        contains: (c: string) => classes.has(c),
      },
      addEventListener: () => {},
      appendChild: () => {},
      contains: () => false,
      setAttribute: () => {},
      removeAttribute: () => {},
    };
  };
  const elements = new Map<string, ReturnType<typeof el>>();
  const document = {
    documentElement: el(),
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, el());
      return elements.get(id)!;
    },
    createElement: () => el(),
    addEventListener: () => {},
  };
  const window = { addEventListener: () => {} };
  const fetch = vi.fn((url: string) =>
    url === ctx.viewersEndpoint
      ? viewers()
      : Promise.resolve({ status: 200, ok: true, json: async () => ({ authors }) }),
  );
  new Function("window", "document", "fetch", "TextEncoder", boot)(window, document, fetch, TextEncoder);
  return {
    count: document.getElementById("ae-viewers-count"),
    picker: document.getElementById("ae-switch"),
    fetched: (url: string) => fetch.mock.calls.some(([u]) => u === url),
  };
}

const noViewers = async () => ({ status: 200, ok: true, json: async () => ({ viewers: [] }) });
const author = (id: string) => ({ authorId: id, name: id, email: null, updatedAt: "2026-09-12T10:00:00.000Z" });

describe("host shell — data-context picker (S20)", () => {
  // r[verify data.switcher.needs-another-author]
  it("stays hidden when only the viewer holds data", async () => {
    const { picker } = runBoot(noViewers, { authors: [author(ctx.viewerId!)] });
    await settle();
    await settle();
    expect(picker.classList.contains("show")).toBe(false);
  });

  // r[verify data.switcher.needs-another-author]
  it("appears once another author holds data", async () => {
    const { picker } = runBoot(noViewers, { authors: [author(ctx.viewerId!), author("u2")] });
    await settle();
    await settle();
    expect(picker.classList.contains("show")).toBe(true);
  });

  // r[verify data.switcher.needs-another-author]
  it("is omitted for an artefact that doesn't use storage: no authors fetch", async () => {
    const { picker, fetched } = runBoot(noViewers, { authors: [author("u2")], usesStorage: false });
    await settle();
    await settle();
    expect(fetched(ctx.authorsEndpoint)).toBe(false);
    expect(picker.classList.contains("show")).toBe(false);
  });
});

const viewer = (id: string) => ({ viewerId: id, name: id, email: null, viewedAt: "2026-09-12T10:00:00.000Z" });

describe("host shell — Viewers count (S66)", () => {
  const html = renderHostShell(ctx);
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

  // r[verify hosting.shell.viewers-count-reserved]
  it("renders the count reserving its slot invisibly, never as an empty pill", () => {
    const tag = html.match(/<span[^>]*id="ae-viewers-count"[^>]*>/)![0];
    expect(tag).not.toMatch(/\shidden/);
    expect(style).toMatch(/\.ae-viewers-count \{[^}]*visibility: hidden;/);
    // Revealed by inheriting: a descendant's `visibility: visible` would show through the hold.
    expect(style).toMatch(/\.ae-viewers-count\.show \{\s*visibility: inherit;\s*\}/);
    expect(style).not.toMatch(/visibility: visible/);
    expect(style).toMatch(/\.ae-viewers-count\[hidden\] \{\s*display: none;\s*\}/);
  });

  // r[verify hosting.shell.viewers-count-reserved]
  it("the viewers fetch fills the count and reveals it", async () => {
    const { count } = runBoot(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ viewers: [viewer("a"), viewer("b")] }),
    }));
    await settle();
    await settle();
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("show")).toBe(true);
    expect(count.hidden).toBe(false);
  });

  // r[verify hosting.shell.viewers-count-reserved]
  it.each([
    ["zero viewers", async () => ({ status: 200, ok: true, json: async () => ({ viewers: [] }) })],
    ["a non-OK response", async () => ({ status: 500, ok: false, json: async () => ({}) })],
    ["a failed fetch", () => Promise.reject(new Error("offline"))],
  ] as Array<[string, () => Promise<FakeResponse>]>)("%s collapses the count", async (_, respond) => {
    const { count } = runBoot(respond);
    await settle();
    await settle();
    expect(count.hidden).toBe(true);
    expect(count.classList.contains("show")).toBe(false);
  });

  // r[verify hosting.shell.viewers-count-reserved]
  it("a render that fails after revealing the count collapses it again", async () => {
    // A viewer with nothing to name them by throws mid-render, after the reveal;
    // the catch then renders no viewers over it.
    const { count } = runBoot(async () => ({ status: 200, ok: true, json: async () => ({ viewers: [{}] }) }));
    await settle();
    await settle();
    expect(count.hidden).toBe(true);
    expect(count.classList.contains("show")).toBe(false);
  });
});

// S72 — Host shell chrome loads nothing from another origin.
describe("host shell — no third-party chrome (S72)", () => {
  const variants: Array<[string, HostShellContext]> = [
    ["signed-in", ctx],
    ["anonymous", { ...ctx, viewerId: null }],
    ["content origin", { ...ctx, frameUrl: "https://content.example/a/slug1/frame?t=tok0" }],
  ];
  // An absolute http(s) URL or a protocol-relative one.
  const external = String.raw`(?:https?:)?//`;

  // r[verify hosting.shell.no-third-party-chrome]
  it.each(variants)("references no stylesheet, font, script or image on another origin (%s)", (_, c) => {
    const html = renderHostShell(c);
    expect(html).not.toMatch(new RegExp(`<link\\b[^>]*\\bhref=["']?${external}`, "i"));
    // Any element's resource attribute: script, img, source, video, object, svg image.
    expect(html).not.toMatch(new RegExp(`<[a-z][^>]*\\s(?:src|srcset|poster|data|xlink:href)=["']?${external}`, "i"));
    expect(html).not.toMatch(new RegExp(`<image\\b[^>]*\\bhref=["']?${external}`, "i"));
    // Every stylesheet and inline style attribute.
    expect(html).not.toMatch(new RegExp(`url\\(\\s*["']?${external}`, "i"));
    expect(html).not.toMatch(/@import/i);
    // The frame URL is the only absolute URL anywhere in the page, scripts included.
    const absolute = html.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^"'\s<>)]*/gi) ?? [];
    expect(absolute.filter((u) => u !== c.frameUrl)).toEqual([]);
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  // r[verify hosting.shell.no-third-party-chrome]
  it("sets its text in the app's sans stack (Tailwind's default unless app.css sets its own)", () => {
    const fontSansOf = (file: string) => /--font-sans:\s*([^;]+);/.exec(readFileSync(resolve(file), "utf8"))?.[1];
    const normalise = (stack: string) =>
      stack.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/"/g, "'").trim();
    const fontSans = fontSansOf("src/client/app.css") ?? fontSansOf("node_modules/tailwindcss/theme.css");
    expect(fontSans).toBeDefined();
    const style = /<style>([\s\S]*?)<\/style>/.exec(renderHostShell(ctx))?.[1] ?? "";
    const bodyFont = /\bbody \{[^}]*\bfont: 14px\/1\.4 ([^;]+);/.exec(style)?.[1];
    expect(normalise(bodyFont ?? "")).toBe(normalise(fontSans ?? ""));
  });
});
