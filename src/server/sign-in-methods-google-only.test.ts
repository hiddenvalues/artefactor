import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

// S38 (`identity.config.methods-from-auth-config`) — the other method set from
// identity.test.ts: email+password off, Google configured. The flags are read
// at boot, so this needs its own file: Vitest isolates modules per file, which
// is the only way to drive a second env.
process.env.AUTH_EMAIL_PASSWORD = "false";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

describe("sign-in methods: Google only (S38)", () => {
  let app: Hono;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // Each advertised flag is checked against what the server actually does, not
  // against the config it was read from.
  // r[verify identity.config.methods-from-auth-config]
  it("advertises exactly the sign-in methods the server enforces", async () => {
    const config = (await (await app.request("/api/config")).json()) as {
      emailPasswordEnabled: boolean;
      googleEnabled: boolean;
    };

    const signIn = await post("/api/auth/sign-in/email", {
      email: "nobody@example.com",
      password: "not-the-password",
    });
    expect(config.emailPasswordEnabled).toBe(signIn.status === 401);

    const google = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: "/" });
    expect(config.googleEnabled).toBe(google.ok);

    // Both states seen across the two files: here the opposite of identity.test.ts.
    expect(config).toMatchObject({ emailPasswordEnabled: false, googleEnabled: true });
  });
});
