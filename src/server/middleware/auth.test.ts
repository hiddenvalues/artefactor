import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ownerId, requireAuth, type AuthEnv, type AuthUser } from "./auth";

// Build a tiny app whose session is seeded directly, isolating the guard from
// BetterAuth so the decision (authenticated ↔ allowed) is tested in itself.
function appWithUser(user: AuthUser | null) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("session", null);
    await next();
  });
  app.get("/protected", requireAuth, (c) => c.json({ ownerId: ownerId(c) }));
  return app;
}

const fakeUser = { id: "user_123", email: "a@b.c", name: "A" } as AuthUser;

// r[verify identity.session.authenticated-principal]
describe("requireAuth", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await appWithUser(null).request("/protected");
    expect(res.status).toBe(401);
  });

  it("lets an authenticated request through and exposes its ownerId", async () => {
    const res = await appWithUser(fakeUser).request("/protected");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ownerId: "user_123" });
  });
});
