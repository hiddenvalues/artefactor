import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AccessPolicy } from "../domain/artefact/access";
import { DEFAULT_TENANT } from "../domain/artefact/artefact";
import type { ArtefactSummary, MeResponse } from "../shared/contracts";
import { openFrame } from "../test/frame";

// End-to-end S22 part B (AH18): the composition root injects an `AccessPolicy`
// and the slug-addressed read paths consult it for the `authenticated` tier.
// A stub policy that scopes the tier to a co-member list (the EE ET3 shape)
// denies a signed-in non-member with a **flat 404** (AH8's no-leak uniformity:
// same as an unknown slug), keeps the anonymous redirect uniform, never denies
// the owner, and leaves the other tiers untouched.
describe("injected access policy gates the authenticated tier (S22, AH18)", () => {
  let app: Hono;
  let owner: string;
  let member: string;
  let outsider: string;

  const HTML = "<!doctype html><h1>policy</h1>";

  // The stub policy's membership roster; filled once the users exist.
  const coMembers = new Set<string>();
  const stubPolicy: AccessPolicy = {
    grantsAuthenticatedTier: (viewerId, tenantId) =>
      tenantId === DEFAULT_TENANT && coMembers.has(viewerId),
  };

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-horse-battery",
        name: email,
      }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function meId(cookie: string): Promise<string> {
    const res = await app.request("/api/me", { headers: { cookie } });
    return ((await res.json()) as MeResponse).id;
  }

  async function makeArtefact(visibility: string): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", `${visibility} artefact`);
    form.set("kind", "prototype");
    form.set("payload", new File([HTML], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: owner },
      })
    ).json()) as ArtefactSummary;
    const shared = await app.request(
      `/api/artefacts/${created.id}/visibility`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner },
        body: JSON.stringify({ visibility }),
      },
    );
    return (await shared.json()) as ArtefactSummary;
  }

  function get(path: string, cookie?: string) {
    return app.request(path, { headers: cookie ? { cookie } : {} });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp(undefined, undefined, undefined, undefined, stubPolicy);
    owner = await signUp("owner-s22b@example.com");
    member = await signUp("member-s22b@example.com");
    outsider = await signUp("outsider-s22b@example.com");
    // Only the member is a co-member — deliberately not the owner, to prove
    // the owner's view is fixed (AH9), not policy-granted.
    coMembers.add(await meId(member));
  });

  it("serves an authenticated artefact to a policy-granted co-member", async () => {
    const a = await makeArtefact("authenticated");
    expect((await get(`/a/${a.publicSlug}`, member)).status).toBe(200);
    // S36 — the frame opens on a token minted under the same policy.
    expect((await openFrame(app, a.publicSlug!, member)).status).toBe(200);
  });

  it("denies a signed-in non-member with a flat 404, like an unknown slug (AH8)", async () => {
    const a = await makeArtefact("authenticated");
    const denied = await get(`/a/${a.publicSlug}`, outsider);
    expect(denied.status).toBe(404);
    expect((await openFrame(app, a.publicSlug!, outsider)).status).toBe(404);
    expect((await get("/a/no-such-slug", outsider)).status).toBe(404);
  });

  it("keeps the anonymous redirect uniform — the policy is never asked about them", async () => {
    const a = await makeArtefact("authenticated");
    const res = await get(`/a/${a.publicSlug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("returnTo");
  });

  it("never denies the owner, even when the policy would (AH9)", async () => {
    const a = await makeArtefact("authenticated");
    expect((await get(`/a/${a.publicSlug}`, owner)).status).toBe(200);
  });

  it("leaves the public tier untouched — viewable by the denied user and the anonymous", async () => {
    const a = await makeArtefact("public");
    expect((await get(`/a/${a.publicSlug}`, outsider)).status).toBe(200);
    expect((await get(`/a/${a.publicSlug}`)).status).toBe(200);
  });

  it("gates the slug-addressed data reads by the same policy (AD4 unchanged)", async () => {
    const a = await makeArtefact("authenticated");
    const authors = `/api/artefacts/${a.publicSlug}/data/authors`;
    expect((await get(authors, member)).status).toBe(200);
    expect((await get(authors, outsider)).status).toBe(404);
  });

  it("gates the viewers list by the same policy (VT4 unchanged)", async () => {
    const a = await makeArtefact("authenticated");
    const viewers = `/api/artefacts/${a.publicSlug}/viewers`;
    expect((await get(viewers, member)).status).toBe(200);
    expect((await get(viewers, outsider)).status).toBe(404);
  });
});
