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

  it("reports magicLinkSignIn: false by default, leaving the other fields unchanged", async () => {
    expect(await config(app)).toEqual({
      allowedEmailDomains: ["example.com", "example.org"],
      emailPasswordEnabled: true,
      googleEnabled: false,
      signupAllowed: true,
      capabilities: { magicLinkSignIn: false },
    });
  });

  it("reports the injected capabilities unchanged", async () => {
    const withMagicLink = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { magicLinkSignIn: true },
    );
    expect((await config(withMagicLink)).capabilities).toEqual({ magicLinkSignIn: true });
  });

  it("mounts no magic-link endpoint under the OSS auth", async () => {
    const res = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", callbackURL: "/" }),
    });
    expect(res.status).toBe(404);
  });
});
