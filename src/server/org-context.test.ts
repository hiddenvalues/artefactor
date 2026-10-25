import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { MeResponse, OrganizationContext } from "../shared/contracts";
import type { OrganizationContextProvider } from "./org-context";

// S53 — Account menu shows the active organization and your role: the
// organization-context seam. OSS has no context; a superset's provider lists
// the caller's memberships, and core alone decides which switch is allowed.
describe("organization context (S53)", () => {
  let createApp: typeof import("./app").createApp;
  let plain: Hono;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    ({ createApp } = await import("./app"));
    plain = createApp();
  });

  let seq = 0;
  async function signUp(app: Hono): Promise<string> {
    seq += 1;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `s53-${seq}-${Date.now()}@example.com`, password: "correct-horse-battery", name: "S53" }),
    });
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  const switchTo = (app: Hono, cookie: string | null, organizationId: string, headers: Record<string, string> = {}) =>
    app.request("/api/me/active-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify({ organizationId }),
    });

  // A provider over two orgs, A active; `activate` records its calls and moves
  // the active org, as a superset's would.
  function fakeProvider() {
    const context: OrganizationContext = {
      activeId: "org-a",
      memberships: [
        { id: "org-a", name: "Org A", role: "owner" },
        { id: "org-b", name: "Org B", role: "member" },
      ],
    };
    const activated: string[] = [];
    const provider: OrganizationContextProvider = {
      get: () => structuredClone(context),
      activate: (_c, id) => {
        activated.push(id);
        context.activeId = id;
      },
    };
    return { provider, activated };
  }

  const withProvider = (provider: OrganizationContextProvider) =>
    createApp(undefined, undefined, undefined, undefined, undefined, undefined, undefined, provider);

  // r[verify identity.org-context.oss-absent+2]
  // r[verify platform.org-context.me-organizations]
  it("answers /api/me with exactly id, email and name under the default provider", async () => {
    const cookie = await signUp(plain);
    const res = await plain.request("/api/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["email", "id", "name"]);
  });

  // r[verify identity.org-context.oss-absent+2]
  // r[verify platform.org-context.switch-route]
  it("answers the switch with 404 under the default provider", async () => {
    const cookie = await signUp(plain);
    expect((await switchTo(plain, cookie, "x")).status).toBe(404);
  });

  // r[verify platform.org-context.me-organizations]
  it("adds the provider's context to /api/me", async () => {
    const { provider } = fakeProvider();
    const app = withProvider(provider);
    const cookie = await signUp(app);
    const body = (await (await app.request("/api/me", { headers: { cookie } })).json()) as MeResponse;
    expect(body.organizations).toEqual({
      activeId: "org-a",
      memberships: [
        { id: "org-a", name: "Org A", role: "owner" },
        { id: "org-b", name: "Org B", role: "member" },
      ],
    });
  });

  // r[verify identity.org-context.switch-own-membership+2]
  // r[verify platform.org-context.switch-route]
  it("activates a listed membership and answers with a fresh /api/me", async () => {
    const { provider, activated } = fakeProvider();
    const app = withProvider(provider);
    const cookie = await signUp(app);
    const res = await switchTo(app, cookie, "org-b");
    expect(res.status).toBe(200);
    expect(activated).toEqual(["org-b"]);
    const body = (await res.json()) as MeResponse;
    expect(body.email).toMatch(/^s53-/);
    expect(body.organizations?.activeId).toBe("org-b");
  });

  // r[verify identity.org-context.switch-own-membership+2]
  // r[verify platform.org-context.switch-route]
  it("answers 404 for an org outside the caller's memberships, never calling activate", async () => {
    const { provider, activated } = fakeProvider();
    const app = withProvider(provider);
    const cookie = await signUp(app);
    expect((await switchTo(app, cookie, "org-c")).status).toBe(404);
    expect(activated).toEqual([]);
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  // r[verify identity.origin.app-origin-only+2]
  it("refuses the switch without a session, and from a foreign origin", async () => {
    const { provider, activated } = fakeProvider();
    const app = withProvider(provider);
    expect((await switchTo(app, null, "org-b")).status).toBe(401);
    const cookie = await signUp(app);
    expect((await switchTo(app, cookie, "org-b", { Origin: "https://evil.example" })).status).toBe(403);
    expect(activated).toEqual([]);
  });

  // r[verify identity.org-context.switch-own-membership+2]
  // r[verify platform.org-context.switch-route]
  it("answers 404 for a body without an organizationId", async () => {
    const { provider, activated } = fakeProvider();
    const app = withProvider(provider);
    const cookie = await signUp(app);
    const res = await app.request("/api/me/active-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(activated).toEqual([]);
  });
});
