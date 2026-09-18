import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright-core";
import { MAX_RENDER_INPUT_BYTES } from "../domain/artefact/artefact";
import { createRendererApp, type RenderEngine } from "./app";
import { PlaywrightThumbnailRenderer } from "./playwright-thumbnail-renderer";

// S37 (AH29) — the renderer role's HTTP surface: one job at a time, a hard
// input cap, and (by default) one job per process.

function post(app: { request: (req: Request) => Response | Promise<Response> }, body: string | Uint8Array) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return app.request(
    new Request("http://renderer/render", {
      method: "POST",
      headers: { "content-type": "text/html", "content-length": String(bytes.byteLength) },
      body: bytes as Uint8Array<ArrayBuffer>,
    }),
  );
}

// A render engine whose renders can be held open.
function fakeEngine() {
  let release: (() => void) | null = null;
  const engine = {
    probes: 0,
    renders: 0,
    hold: false,
    failWith: null as Error | null,
    async probe() {
      engine.probes++;
    },
    async render(): Promise<Uint8Array> {
      engine.renders++;
      if (engine.hold) await new Promise<void>((r) => (release = r));
      if (engine.failWith) throw engine.failWith;
      return new Uint8Array([82, 73, 70, 70]);
    },
    let() {
      release?.();
    },
  };
  return engine satisfies RenderEngine;
}

function launchSpy(result: () => Promise<Browser>) {
  const calls: LaunchOptions[] = [];
  const launch = (options: LaunchOptions) => {
    calls.push(options);
    return result();
  };
  return { calls, launch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("renderer role (S37, AH29)", () => {
  describe("sandboxed launch", () => {
    it("probes Chromium with its sandbox on and reports ready", async () => {
      const spy = launchSpy(async () => ({ close: async () => {} }) as unknown as Browser);
      const renderer = createRendererApp({
        engine: new PlaywrightThumbnailRenderer({ launch: spy.launch }),
        exitAfterJob: false,
        minUptimeMs: 0,
        uptimeMs: () => 0,
        exit: () => {},
        log: () => {},
      });
      await renderer.ready;

      const health = await renderer.app.request("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ready" });
      expect(spy.calls).toEqual([expect.objectContaining({ chromiumSandbox: true })]);
    });

    it("when the sandboxed launch fails: unavailable, and never a launch with the sandbox off", async () => {
      const spy = launchSpy(() => Promise.reject(new Error("No usable sandbox!")));
      const renderer = createRendererApp({
        engine: new PlaywrightThumbnailRenderer({ launch: spy.launch }),
        exitAfterJob: true,
        minUptimeMs: 0,
        uptimeMs: () => 60_000,
        exit: () => {},
        log: () => {},
      });
      await renderer.ready;

      const health = await renderer.app.request("/health");
      expect(health.status).toBe(503);
      const body = (await health.json()) as { status: string; reason: string };
      expect(body.status).toBe("unavailable");
      expect(body.reason).toMatch(/No usable sandbox/);

      const render = await post(renderer.app, "<h1>x</h1>");
      expect(render.status).toBe(503);
      expect(render.headers.get("retry-after")).toBeTruthy();

      expect(spy.calls).toHaveLength(1);
      expect(spy.calls.filter((c) => c.chromiumSandbox !== true)).toEqual([]);
    });
  });

  describe("POST /render", () => {
    function make(
      engine: RenderEngine = fakeEngine(),
      overrides: Partial<Parameters<typeof createRendererApp>[0]> = {},
    ) {
      return createRendererApp({
        engine,
        exitAfterJob: false,
        minUptimeMs: 0,
        uptimeMs: () => 0,
        exit: () => {},
        log: () => {},
        ...overrides,
      });
    }

    it("answers 200 image/webp with the engine's bytes", async () => {
      const r = make();
      await r.ready;
      const res = await post(r.app, "<h1>x</h1>");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    });

    it("answers 413 above MAX_RENDER_INPUT_BYTES without a launch", async () => {
      const spy = launchSpy(async () => ({ close: async () => {} }) as unknown as Browser);
      const r = make(new PlaywrightThumbnailRenderer({ launch: spy.launch }));
      await r.ready;
      expect(spy.calls).toHaveLength(1); // the startup probe

      const res = await post(r.app, new Uint8Array(MAX_RENDER_INPUT_BYTES + 1));

      expect(res.status).toBe(413);
      expect(spy.calls).toHaveLength(1);
    });

    it("answers 411 without a Content-Length", async () => {
      const r = make();
      await r.ready;
      const res = await r.app.request(
        new Request("http://renderer/render", {
          method: "POST",
          body: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("<p>"));
              c.close();
            },
          }),
          duplex: "half",
        } as RequestInit),
      );
      expect(res.status).toBe(411);
    });

    it("answers 422 when the render fails", async () => {
      const engine = fakeEngine();
      engine.failWith = new Error("thumbnail render timed out after 15000 ms");
      const r = make(engine);
      await r.ready;
      expect((await post(r.app, "<p>")).status).toBe(422);
    });

    it("answers 503 with Retry-After while another job is in flight", async () => {
      const engine = fakeEngine();
      engine.hold = true;
      const r = make(engine);
      await r.ready;

      const first = post(r.app, "<p>one</p>");
      await vi.waitFor(() => expect(engine.renders).toBe(1));
      const second = await post(r.app, "<p>two</p>");

      expect(second.status).toBe(503);
      expect(second.headers.get("retry-after")).toBe("1");
      engine.let();
      expect((await first).status).toBe(200);
      expect(engine.renders).toBe(1);
    });

    it("answers 503 while the startup probe is still running", async () => {
      let finish: () => void = () => {};
      const engine = { ...fakeEngine(), probe: () => new Promise<void>((r) => (finish = r)) };
      const r = make(engine as RenderEngine);
      expect((await post(r.app, "<p>")).status).toBe(503);
      expect((await r.app.request("/health")).status).toBe(503);
      finish();
      await r.ready;
      expect((await r.app.request("/health")).status).toBe(200);
    });
  });

  describe("one job per process", () => {
    function clocked(exitAfterJob: boolean, engine: ReturnType<typeof fakeEngine> = fakeEngine()) {
      vi.useFakeTimers();
      const start = Date.now();
      const exit = vi.fn();
      const r = createRendererApp({
        engine,
        exitAfterJob,
        minUptimeMs: 10_000,
        uptimeMs: () => Date.now() - start,
        exit,
        log: () => {},
      });
      return { ...r, exit, engine };
    }

    it("after one 200 at uptime 2 s: refuses further work, and exits 0 at uptime 10 s, not before", async () => {
      const r = clocked(true);
      await r.ready;
      await vi.advanceTimersByTimeAsync(2_000);

      expect((await post(r.app, "<p>one</p>")).status).toBe(200);
      const next = await post(r.app, "<p>two</p>");
      expect(next.status).toBe(503);
      expect(Number(next.headers.get("retry-after"))).toBeGreaterThanOrEqual(8);
      expect((await r.app.request("/health")).status).toBe(200);

      await vi.advanceTimersByTimeAsync(7_999);
      expect(r.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(r.exit).toHaveBeenCalledExactlyOnceWith(0);
      expect(r.engine.renders).toBe(1);
    });

    it("drains after a failed render too", async () => {
      const engine = fakeEngine();
      engine.failWith = new Error("page crashed");
      const r = clocked(true, engine);
      await r.ready;
      await vi.advanceTimersByTimeAsync(12_000);

      expect((await post(r.app, "<p>")).status).toBe(422);
      expect((await post(r.app, "<p>")).status).toBe(503);
      await vi.advanceTimersByTimeAsync(0);
      expect(r.exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("a 413 doesn't drain", async () => {
      const r = clocked(true);
      await r.ready;

      expect((await post(r.app, new Uint8Array(MAX_RENDER_INPUT_BYTES + 1))).status).toBe(413);
      expect((await post(r.app, "<p>ok</p>")).status).toBe(200);
      await vi.advanceTimersByTimeAsync(0);
      expect(r.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.exit).toHaveBeenCalledOnce();
    });

    it("with exit-after-job off: keeps serving and never exits", async () => {
      const r = clocked(false);
      await r.ready;

      expect((await post(r.app, "<p>one</p>")).status).toBe(200);
      expect((await post(r.app, "<p>two</p>")).status).toBe(200);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(r.exit).not.toHaveBeenCalled();
      expect(r.engine.renders).toBe(2);
    });
  });
});
