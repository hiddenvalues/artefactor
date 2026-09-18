import { Hono } from "hono";
import { MAX_RENDER_INPUT_BYTES } from "../domain/artefact/artefact";
import { ThumbnailRendererUnavailable } from "../domain/artefact/errors";

// What the role renders with: `PlaywrightThumbnailRenderer` in production.
export interface RenderEngine {
  // Launch the sandboxed browser once at startup; rejects when this host can't.
  probe(): Promise<void>;
  render(html: Uint8Array): Promise<Uint8Array>;
}

export interface RendererAppOptions {
  engine: RenderEngine;
  // Answer one render, then refuse work and exit once `minUptimeMs` is reached.
  exitAfterJob: boolean;
  minUptimeMs: number;
  uptimeMs: () => number;
  exit: (code: number) => void;
  log?: (message: string) => void;
}

type State =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "busy" }
  | { kind: "draining"; exitAt: number }
  | { kind: "unavailable"; reason: string };

// Seconds a caller should wait before retrying, per state.
const RETRY_BUSY_S = 1;
const RETRY_UNAVAILABLE_S = 30;

// S37 (AH29) — the isolated renderer's HTTP surface. Concurrency 1: a job is
// accepted only while idle; the rest get 503 + Retry-After and the app retries.
// Nothing about the caller is read or kept — the request body is the payload,
// the response body the image.
export function createRendererApp(options: RendererAppOptions) {
  const { engine, exitAfterJob, minUptimeMs, uptimeMs, exit } = options;
  const log = options.log ?? ((m: string) => console.log(`[renderer] ${m}`));
  let state: State = { kind: "starting" };

  const ready = engine.probe().then(
    () => {
      state = { kind: "ready" };
      log("sandboxed Chromium launched — ready");
    },
    (err: unknown) => {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
      const reason = cause instanceof Error ? cause.message.split("\n")[0]! : String(cause);
      state = { kind: "unavailable", reason };
      log(`unavailable: ${reason}`);
    },
  );

  // After an answered job: refuse further work, and exit at the minimum uptime.
  const drain = () => {
    if (!exitAfterJob) {
      state = { kind: "ready" };
      return;
    }
    const exitAt = Math.max(uptimeMs(), minUptimeMs);
    state = { kind: "draining", exitAt };
    setTimeout(() => exit(0), exitAt - uptimeMs());
  };

  const refuse = (retryAfterS: number) =>
    new Response(null, { status: 503, headers: { "retry-after": String(retryAfterS) } });

  const app = new Hono();

  app.get("/health", (c) => {
    if (state.kind === "starting") return c.json({ status: "unavailable", reason: "starting" }, 503);
    if (state.kind === "unavailable") return c.json({ status: "unavailable", reason: state.reason }, 503);
    return c.json({ status: "ready" });
  });

  app.post("/render", async (c) => {
    const length = c.req.header("content-length");
    if (length === undefined || !/^\d+$/.test(length)) return c.body(null, 411);
    if (Number(length) > MAX_RENDER_INPUT_BYTES) return c.body(null, 413);

    switch (state.kind) {
      case "ready":
        break;
      case "draining":
        return refuse(Math.max(1, Math.ceil((state.exitAt - uptimeMs()) / 1000)) + 1);
      case "unavailable":
        return refuse(RETRY_UNAVAILABLE_S);
      default:
        return refuse(RETRY_BUSY_S);
    }
    state = { kind: "busy" };

    try {
      const html = new Uint8Array(await c.req.arrayBuffer());
      if (html.byteLength > MAX_RENDER_INPUT_BYTES) {
        state = { kind: "ready" };
        return c.body(null, 413);
      }
      try {
        const image = await engine.render(html);
        return c.body(image as Uint8Array<ArrayBuffer>, 200, { "content-type": "image/webp" });
      } catch (err) {
        const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
        if (err instanceof ThumbnailRendererUnavailable) {
          log(`render unavailable: ${message}`);
          return refuse(RETRY_BUSY_S);
        }
        log(`render failed: ${message}`);
        return c.body(null, 422);
      } finally {
        drain();
      }
    } catch (err) {
      // The request body could not be read; nothing was rendered.
      if (state.kind === "busy") state = { kind: "ready" };
      throw err;
    }
  });

  return { app, ready };
}
