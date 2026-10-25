import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DOMAIN_NOT_ALLOWED_MESSAGE } from "../domain/identity/email-domain";

// End-to-end S1: drive the real Hono app (with the BetterAuth handler mounted)
// against a throwaway SQLite db. Proves the two S1 acceptance criteria — a
// session exposes a stable ownerId to the BFF, and protected endpoints reject
// unauthenticated requests.
describe("identity (S1)", () => {
  let app: Hono;

  beforeAll(async () => {
    // Imports are dynamic so the test setup's env (temp DB path) is read first.
    const { migrate } = await import(
      "drizzle-orm/better-sqlite3/migrator"
    );
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  it("rejects /api/me without a session", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  // The routes that answer without a session, as the requirement names them.
  // Everything else the router registers under `/api` must answer 401.
  const ANONYMOUS = new Set([
    "GET /api/ping",
    "GET /api/config",
    "GET /api/artefacts/:id/raw/frame",
    "GET /api/artefacts/:ref/download",
    "GET /api/artefacts/:ref/thumbnail",
    "GET /api/artefacts/:ref/data/authors",
    "GET /api/artefacts/:ref/data/:authorId",
    "GET /api/public/collections/:slug",
  ]);

  // Every concrete route the router registers under `/api`, apart from
  // BetterAuth's `/api/auth/*` and the middleware (`ALL`) entries.
  const apiRoutes = () => [
    ...new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/") && !r.path.startsWith("/api/auth/"))
        .map((r) => `${r.method} ${r.path}`),
    ),
  ];

  // r[verify identity.session.protected-rejects-anonymous+2]
  it("answers every other /api route without a session with 401 unauthorized", async () => {
    const routes = apiRoutes();
    for (const route of ANONYMOUS) expect(routes).toContain(route);

    const guarded = routes.filter((route) => !ANONYMOUS.has(route));
    expect(guarded.length).toBeGreaterThan(40);
    for (const route of guarded) {
      const [method, pattern] = route.split(" ") as [string, string];
      const res = await app.request(pattern.replace(/:\w+/g, "x"), { method });
      // Read as text, so a route that answers with something else shows up in the
      // failure itself instead of as a JSON parse error.
      expect({ route, status: res.status, body: await res.text() }).toEqual({
        route,
        status: 401,
        body: JSON.stringify({ error: "unauthorized" }),
      });
    }
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  it.each(["/api/ping", "/api/config"])("answers GET %s without a session", async (path) => {
    expect((await app.request(path)).status).toBe(200);
  });

  // r[verify identity.config.advertises-methods+3]
  it("never names the allowed email domains in public /api/config", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).not.toHaveProperty("allowedEmailDomains");
    // Set by the test setup (AUTH_ALLOWED_EMAIL_DOMAINS).
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("example.org");
  });

  // S38 — the sign-in screen renders what the server will accept. The test
  // env is email+password on, no Google credentials, gate open.
  // r[verify identity.config.advertises-methods+3]
  it("advertises the enabled sign-in methods via /api/config (S38)", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      emailPasswordEnabled: boolean;
      googleEnabled: boolean;
      signupAllowed: boolean;
    };
    expect(body).toMatchObject({
      emailPasswordEnabled: true,
      googleEnabled: false,
      signupAllowed: true,
    });
  });

  // Each advertised flag is checked against what the server actually does, not
  // against the config it was read from.
  // r[verify identity.config.methods-from-auth-config]
  it("advertises exactly the sign-in methods and sign-up the server enforces", async () => {
    const config = (await (await app.request("/api/config")).json()) as {
      emailPasswordEnabled: boolean;
      googleEnabled: boolean;
      signupAllowed: boolean;
    };
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    // A disabled credential provider answers 400; an enabled one weighs the password.
    const signIn = await post("/api/auth/sign-in/email", {
      email: "nobody@example.com",
      password: "not-the-password",
    });
    expect(config.emailPasswordEnabled).toBe(signIn.status === 401);

    const google = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: "/" });
    expect(config.googleEnabled).toBe(google.ok);

    const signUp = await post("/api/auth/sign-up/email", {
      email: "advertised@example.com",
      password: "correct-horse-battery",
      name: "Advertised",
    });
    expect(config.signupAllowed).toBe(signUp.ok);
  });

  // r[verify identity.session.owner-id]
  it("signs a user up and exposes their ownerId via /api/me", async () => {
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "correct-horse-battery",
        name: "Alice",
      }),
    });
    expect(signUp.status).toBe(200);

    const setCookie = signUp.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(";")[0]!;

    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      id: string;
      email: string;
      name: string;
    };
    expect(body).toMatchObject({ email: "alice@example.com", name: "Alice" });
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
  });

  // r[verify identity.signup.domain-allowlist+2]
  it("rejects sign-up from a disallowed email domain", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mallory@not-allowed.test",
        password: "correct-horse-battery",
        name: "Mallory",
      }),
    });
    expect(res.status).toBe(403);

    // ...and no account leaks through: she cannot then sign in.
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mallory@not-allowed.test",
        password: "correct-horse-battery",
      }),
    });
    expect(signIn.status).not.toBe(200);
  });

  // r[verify identity.signup.refusal-names-no-domain]
  it("refuses a disallowed domain with the fixed message, naming no allowed domain", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "x@other.com",
        password: "correct-horse-battery",
        name: "X",
      }),
    });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect((JSON.parse(text) as { message: string }).message).toBe(DOMAIN_NOT_ALLOWED_MESSAGE);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("example.org");
  });

  // r[verify identity.signup.domain-allowlist+2]
  it.each([
    ["Casey@Example.COM", 200],
    ["casey@sub.example.com", 403],
  ])("matches the allowlist exactly and case-insensitively: sign-up from %s → %i", async (email, status) => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: "Casey" }),
    });
    expect(res.status).toBe(status);
  });
});
