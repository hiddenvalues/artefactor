import { createMiddleware } from "hono/factory";

// S36 (IA6) — cookie-authenticated state changes come only from the app origin.
//
// Mounted on `/api/*`. A `POST`/`PUT`/`PATCH`/`DELETE` is refused with 403 when
// its `Origin` is present and not a trusted app origin (`Origin: null` — a
// sandboxed artefact frame — never is), or when its `Sec-Fetch-Site` is present
// and not `same-origin`. A request with neither header (a non-browser client)
// passes. Reads are never checked, and `/api/auth/*` is left to BetterAuth's own
// `trustedOrigins` check. `/mcp` is not under `/api` and is bearer-only.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createOriginGuard(trustedOrigins: readonly string[]) {
  const trusted = new Set(trustedOrigins);
  return createMiddleware(async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method) || /^\/api\/auth(\/|$)/.test(c.req.path)) {
      return next();
    }
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    if ((origin !== undefined && !trusted.has(origin)) || (site !== undefined && site !== "same-origin")) {
      return c.json({ error: "cross-origin request refused" }, 403);
    }
    return next();
  });
}
