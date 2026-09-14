import { createMiddleware } from "hono/factory";

// S36 (AH28) — with a content origin configured, the two hosts split cleanly:
// the content host answers only the frame routes and /health (no SPA, API, MCP,
// shell or OAuth discovery), and the app host answers no frame route. Same
// process, same container; the request's host (Host, as the Node adapter builds
// the URL from it) decides. Mounted first in `createApp`.
const FRAME_PATH = /^\/a\/[^/]+\/frame$|^\/api\/artefacts\/[^/]+\/raw\/frame$/;

export function createContentHostGate(contentOrigin: string) {
  const contentHost = new URL(contentOrigin).host.toLowerCase();
  return createMiddleware(async (c, next) => {
    const onContentHost = new URL(c.req.url).host.toLowerCase() === contentHost;
    const path = c.req.path;
    const isFrame = FRAME_PATH.test(path);
    if (onContentHost ? !(isFrame || path === "/health") : isFrame) {
      return c.notFound();
    }
    return next();
  });
}
