import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createRendererApp } from "./app";
import { parseRendererEnv, selfCheck } from "./env";
import { PlaywrightThumbnailRenderer } from "./playwright-thumbnail-renderer";

// S37 (AH29) — the isolated thumbnail renderer: the app's `ARTEFACTOR_ROLE=renderer`
// container, running untrusted artefact HTML in sandboxed Chromium and nothing
// else. It has no database, no storage, no auth and no secrets — the self-check
// below refuses to start a production renderer that can see any of them.
const env = parseRendererEnv(process.env);

const refusal = selfCheck(env, process.env, {
  uid: process.getuid?.() ?? 1000,
  exists: existsSync,
});
if (refusal) {
  console.error(`[renderer] refusing to start: ${refusal}`);
  process.exit(1);
}

const { app, ready } = createRendererApp({
  engine: new PlaywrightThumbnailRenderer(),
  exitAfterJob: env.ARTEFACTOR_RENDERER_EXIT_AFTER_JOB,
  minUptimeMs: env.ARTEFACTOR_RENDERER_MIN_UPTIME_MS,
  uptimeMs: () => process.uptime() * 1000,
  // Let the answered response drain before the process goes; a job can never be
  // in flight here (the role refuses work once draining).
  exit: (code) => {
    server.close(() => process.exit(code));
    // Drop the app's keep-alive connection so `close` doesn't wait it out.
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    setTimeout(() => process.exit(code), 5_000).unref();
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `[renderer] listening on http://localhost:${info.port} (${env.NODE_ENV}, ` +
      `exit after job: ${env.ARTEFACTOR_RENDERER_EXIT_AFTER_JOB})`,
  );
});

void ready;
