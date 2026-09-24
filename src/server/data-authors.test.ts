import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  DataAuthorsResponse,
  DataEntryResponse,
  MeResponse,
} from "../shared/contracts";

// End-to-end S12: the host data-context switcher endpoints
// (`…/data/authors` + `…/data/:authorId`) through the real app, enforcing the
// access matrix (AD4) and BFF name/email enrichment.
describe("data-context switcher — /data/authors + /data/:authorId (S12)", () => {
  let app: Hono;
  let owner: string;
  let other: string;
  let ownerId: string;
  let otherId: string;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function meId(cookie: string): Promise<string> {
    return ((await (await app.request("/api/me", { headers: { cookie } })).json()) as MeResponse)
      .id;
  }

  async function makeShared(cookie: string, visibility = "public") {
    const form = new FormData();
    form.set("title", "Form");
    form.set("kind", "form");
    form.set("payload", new File(["<h1>f</h1>"], "f.html"));
    const created = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
    ).json()) as ArtefactSummary;
    const shared = (await (
      await app.request(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility }),
      })
    ).json()) as ArtefactSummary;
    return { id: created.id, slug: shared.publicSlug! };
  }

  function putData(slug: string, cookie: string, body: string) {
    return app.request(`/api/artefacts/${slug}/data/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
  }

  function authors(slug: string, cookie?: string | null) {
    return app.request(`/api/artefacts/${slug}/data/authors`, {
      headers: cookie ? { cookie } : {},
    });
  }

  function authorData(slug: string, authorId: string, cookie?: string | null) {
    return app.request(`/api/artefacts/${slug}/data/${authorId}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("authors-owner@example.com");
    other = await signUp("authors-other@example.com");
    ownerId = await meId(owner);
    otherId = await meId(other);
  });

  it("lists authors with name/email, and loads a chosen author's blob (AD4)", async () => {
    const { slug } = await makeShared(owner, "authenticated");
    await putData(slug, owner, '{"who":"owner"}');
    await putData(slug, other, '{"who":"other"}');

    const list = (await (await authors(slug, other)).json()) as DataAuthorsResponse;
    const ids = list.authors.map((a) => a.authorId).sort();
    expect(ids).toEqual([ownerId, otherId].sort());
    const ownerRow = list.authors.find((a) => a.authorId === ownerId)!;
    expect(ownerRow.email).toBe("authors-owner@example.com");
    expect(ownerRow.name).toBe("authors-owner@example.com");
    // S40 widened the port's author refs; this response keeps its shape.
    expect(Object.keys(ownerRow).sort()).toEqual(["authorId", "email", "name", "updatedAt"]);
    expect(typeof ownerRow.updatedAt).toBe("string");

    // A different signed-in viewer loads the owner's blob (read seed for S12).
    const loaded = (await (await authorData(slug, ownerId, other)).json()) as DataEntryResponse;
    expect(loaded.blob).toBe('{"who":"owner"}');
  });

  it("returns blob: null for an author with no entry", async () => {
    const { slug } = await makeShared(owner, "authenticated");
    const loaded = (await (await authorData(slug, otherId, owner)).json()) as DataEntryResponse;
    expect(loaded).toEqual({ blob: null, updatedAt: null });
  });

  it("allows anonymous reads on a public artefact (AD4)", async () => {
    const { slug } = await makeShared(owner, "public");
    await putData(slug, owner, '{"v":1}');
    expect((await authors(slug)).status).toBe(200);
    const loaded = (await (await authorData(slug, ownerId)).json()) as DataEntryResponse;
    expect(loaded.blob).toBe('{"v":1}');
  });

  it("denies anonymous on an authenticated artefact (AD4)", async () => {
    const { slug } = await makeShared(owner, "authenticated");
    expect((await authors(slug)).status).toBe(404);
    expect((await authorData(slug, ownerId)).status).toBe(404);
  });

  it("denies a non-owner on a private artefact (AD4/AH8)", async () => {
    const { id, slug } = await makeShared(owner, "public");
    await app.request(`/api/artefacts/${id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: owner },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect((await authors(slug, other)).status).toBe(404);
    expect((await authors(slug, owner)).status).toBe(200);
  });

  it("returns 404 for an archived artefact (AD6)", async () => {
    const { id, slug } = await makeShared(owner, "authenticated");
    await app.request(`/api/artefacts/${id}/archive`, { method: "POST", headers: { cookie: owner } });
    expect((await authors(slug, owner)).status).toBe(404);
    expect((await authorData(slug, ownerId, owner)).status).toBe(404);
  });

  it("does not let /:authorId shadow the static /me route", async () => {
    const { slug } = await makeShared(owner, "authenticated");
    await putData(slug, owner, '{"mine":true}');
    const me = (await (
      await app.request(`/api/artefacts/${slug}/data/me`, { headers: { cookie: owner } })
    ).json()) as DataEntryResponse;
    expect(me.blob).toBe('{"mine":true}');
  });
});
