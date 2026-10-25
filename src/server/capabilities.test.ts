import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { PublicConfigResponse } from "../shared/contracts";

// S33a — Capabilities seam + magic-link sign-in affordance. `createApp` takes the
// superset's capabilities as an injected value; OSS injects none, so the sign-in
// screen is told magic link is off and the core auth mounts no endpoint for it.
describe("capabilities seam (S33a)", () => {
  let createApp: typeof import("./app").createApp;
  let app: Hono;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    ({ createApp } = await import("./app"));
    app = createApp();
  });

  async function config(a: Hono): Promise<PublicConfigResponse> {
    const res = await a.request("/api/config");
    expect(res.status).toBe(200);
    return (await res.json()) as PublicConfigResponse;
  }

  // r[verify identity.capabilities.oss-default-off+2]
  // r[verify identity.capabilities.superset-only]
  // r[verify identity.config.advertises-methods+3]
  it("reports magicLinkSignIn: false by default, leaving the other fields unchanged", async () => {
    expect(await config(app)).toEqual({
      emailPasswordEnabled: true,
      googleEnabled: false,
      signupAllowed: true,
      capabilities: { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false },
      legal: { termsUrl: null, privacyUrl: null },
    });
  });

  // r[verify identity.capabilities.oss-default-off+2]
  it("reports the injected capabilities unchanged", async () => {
    const withMagicLink = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { magicLinkSignIn: true, verifiedSignUp: true, passwordReset: true },
    );
    expect((await config(withMagicLink)).capabilities).toEqual({
      magicLinkSignIn: true,
      verifiedSignUp: true,
      passwordReset: true,
    });
  });

  // r[verify hosting.magic-link.no-oss-endpoint]
  it("mounts no magic-link endpoint under the OSS auth", async () => {
    const res = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", callbackURL: "/" }),
    });
    expect(res.status).toBe(404);
  });

  // S48 — Verified sign-up and password reset affordances. The endpoints the
  // screen calls exist only where a superset (EI4) registers them.
  async function post(path: string, body: unknown): Promise<Response> {
    return app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // r[verify identity.capabilities.oss-default-off+2]
  // r[verify identity.capabilities.superset-only]
  it("mounts no set-password endpoint under the OSS auth (S48)", async () => {
    expect((await post("/api/auth/set-password", { newPassword: "correct-horse-battery" })).status).toBe(404);
  });

  // r[verify identity.capabilities.oss-default-off+2]
  // r[verify identity.capabilities.superset-only]
  it("refuses a password-reset request under the OSS auth, which sends no mail (S48)", async () => {
    const res = await post("/api/auth/request-password-reset", { email: "a@example.com", redirectTo: "/?reset-password=1" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("RESET_PASSWORD_DISABLED");
  });

  it("lands a spent reset link on the redirectTo it was given, keeping its query (S48)", async () => {
    const res = await app.request(`/api/auth/reset-password/not-a-token?callbackURL=${encodeURIComponent("/?reset-password=1")}`);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/");
    expect(Object.fromEntries(to.searchParams)).toEqual({ "reset-password": "1", error: "INVALID_TOKEN" });
  });
});
