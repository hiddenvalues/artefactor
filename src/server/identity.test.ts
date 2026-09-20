import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

// End-to-end S1: drive the real Hono app (with the BetterAuth handler mounted)
// against a throwaway SQLite db. Proves the two S1 acceptance criteria — a
// session exposes a stable ownerId to the BFF, and protected endpoints reject
// unauthenticated requests (IA1).
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

  it("rejects /api/me without a session (IA1)", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("exposes the allowed email domains via public /api/config", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowedEmailDomains: string[] };
    // Set by the test setup (AUTH_ALLOWED_EMAIL_DOMAINS).
    expect(body.allowedEmailDomains).toEqual(["example.com", "example.org"]);
  });

  // S38 (IA7) — the sign-in screen renders what the server will accept. The test
  // env is email+password on, no Google credentials, gate open.
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

  it("rejects sign-up from a disallowed email domain (IA4)", async () => {
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
});
