import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEFAULT_TENANT } from "../domain/artefact/artefact";
import type { ArtefactSummary, SharedArtefactSummary } from "../shared/contracts";
import { signUp } from "../test/mcp-oauth";
import type { TenantScopeResolver } from "./middleware/tenant-scope";

// S22 — the tenant-scope seam end to end: a stub resolver injected into `createApp` puts a request
// in whichever tenant its `x-test-tenant` header names (the default tenant without one), as a
// superset's active-org resolver would. Rows of one tenant never reach a request scoped to another.
describe("a stub tenant scope (S22)", () => {
  let app: Hono;
  let owner: string;
  let viewer: string;

  const stubScope: TenantScopeResolver = (c) => ({
    tenantId: c.req.header("x-test-tenant") ?? DEFAULT_TENANT,
  });

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    const { defaultAdapters } = await import("./adapters");
    const { auth } = await import("./auth");
    app = createApp(defaultAdapters, auth, stubScope);
    owner = await signUp(app, "owner-tenancy@example.com");
    viewer = await signUp(app, "viewer-tenancy@example.com");
  });

  // r[verify platform.tenancy.scope-excludes-other-tenants+2]
  // r[verify hosting.tenant.scope-excludes-other-tenants+2]
  it("keeps the default tenant's artefact out of another tenant's own list, shared list and id reads", async () => {
    const form = new FormData();
    form.set("title", "Tenant A deck");
    form.set("kind", "slide-deck");
    form.set("payload", new File(["<!doctype html><h1>a</h1>"], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } })
    ).json()) as ArtefactSummary;
    const shared = await app.request(`/api/artefacts/${created.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: owner },
      body: JSON.stringify({ visibility: "authenticated" }),
    });
    expect(shared.status).toBe(200);

    const ownIds = async (headers: Record<string, string>) =>
      ((await (await app.request("/api/artefacts", { headers })).json()) as { artefacts: ArtefactSummary[] }).artefacts.map(
        (a) => a.id,
      );
    const sharedIds = async (headers: Record<string, string>) =>
      (
        (await (await app.request("/api/shared", { headers })).json()) as { artefacts: SharedArtefactSummary[] }
      ).artefacts.map((a) => a.id);

    // In its own tenant the artefact is listed and readable by id.
    expect(await ownIds({ cookie: owner })).toContain(created.id);
    expect(await sharedIds({ cookie: viewer })).toContain(created.id);
    expect((await app.request(`/api/artefacts/${created.id}`, { headers: { cookie: owner } })).status).toBe(200);

    // Scoped to another tenant, it is gone from every scoped read.
    const elsewhere = { "x-test-tenant": "org-elsewhere" };
    expect(await ownIds({ cookie: owner, ...elsewhere })).not.toContain(created.id);
    expect(await sharedIds({ cookie: viewer, ...elsewhere })).not.toContain(created.id);
    expect(
      (await app.request(`/api/artefacts/${created.id}`, { headers: { cookie: owner, ...elsewhere } })).status,
    ).toBe(404);
  });
});
