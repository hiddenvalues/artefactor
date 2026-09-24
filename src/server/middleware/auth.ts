import { createMiddleware } from "hono/factory";
import { auth } from "../auth";
import type { PassLookup } from "../link-gate/passes";

// S24 (auth seam) — the BetterAuth instance type. The composition injects the
// instance (OSS default = the SQLite-backed `auth` singleton; a superset passes a
// Postgres-backed one), so no module hardcodes which database auth lives in.
//
// This is the concrete OSS `auth` type, which carries the `mcp` plugin's api
// methods the OAuth-discovery helpers (`oAuthDiscoveryMetadata`, …) require — so
// it is deliberately *not* loosened to the generic betterAuth return type.
// BetterAuth's `Auth<O>` is **invariant** in its options `O`: a superset whose
// auth adds further plugins is a superset at runtime but not structurally
// provable as assignable, so such a superset casts its instance to this type at
// its single composition boundary (the cast is sound — the app only calls
// methods present on both).
export type AuthInstance = typeof auth;

// The authenticated identity, as surfaced by BetterAuth's session lookup. The
// domain only cares about `user.id` — that is the stable `ownerId` (IA spec).
export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;

// Hono context bindings added by `attachSession`. `user` is null when the
// request carries no valid session.
export type AuthEnv = {
  Variables: {
    user: AuthUser | null;
    session: AuthSession | null;
    // S32a — the request's verified link passes, by holder (`attachLinkPasses`).
    linkPasses?: PassLookup;
  };
};

// Resolve the BetterAuth session for the request and expose it to downstream
// handlers. Runs on every BFF route except the BetterAuth handler itself. A
// factory over the injected auth instance (S24 auth seam) so the same middleware
// works against whichever database auth is backed by.
export function createAttachSession(authInstance: AuthInstance) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const data = await authInstance.api.getSession({
      headers: c.req.raw.headers,
    });
    c.set("user", data?.user ?? null);
    c.set("session", data?.session ?? null);
    await next();
  });
}

// Guard for protected endpoints: rejects unauthenticated requests with 401.
// Encodes IA invariant 1 — non-public access requires an authenticated session.
// Must run after `attachSession`.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

// The owning user id for the current request. Call only behind `requireAuth`.
export function ownerId(c: { get: (k: "user") => AuthUser | null }): string {
  const user = c.get("user");
  if (!user) {
    throw new Error("ownerId() called without an authenticated session");
  }
  return user.id;
}
