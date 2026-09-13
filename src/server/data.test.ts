import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtefactSummary, DataEntryResponse } from "../shared/contracts";

// End-to-end S11: read/write the caller's own data blob through the real app
// (BFF → commands → Drizzle data repo) against a throwaway db.
describe("artefact data store — /data/me (S11)", () => {
  let app: Hono;
  let owner: string;
  let other: string;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  // Create + share an artefact (so it carries a slug); returns id + slug.
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

  function dataMe(
    slug: string,
    init: { method: string; body?: string; cookie?: string | null },
  ) {
    return app.request(`/api/artefacts/${slug}/data/me`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body,
    });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("data-owner@example.com");
    other = await signUp("data-other@example.com");
  });

  it("upserts and reads back the caller's blob", async () => {
    const { slug } = await makeShared(owner);
    const put = await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
    expect(put.status).toBe(200);
    expect(((await put.json()) as DataEntryResponse).blob).toBe('{"v":1}');

    const get = await dataMe(slug, { method: "GET", cookie: owner });
    expect(((await get.json()) as DataEntryResponse).blob).toBe('{"v":1}');

    // Re-write upserts the same entry.
    await dataMe(slug, { method: "PUT", body: '{"v":2}', cookie: owner });
    expect(((await (await dataMe(slug, { method: "GET", cookie: owner })).json()) as DataEntryResponse).blob).toBe(
      '{"v":2}',
    );
  });

  it("returns blob: null when the caller has no entry", async () => {
    const { slug } = await makeShared(owner);
    const get = await dataMe(slug, { method: "GET", cookie: owner });
    expect(get.status).toBe(200);
    expect((await get.json()) as DataEntryResponse).toEqual({ blob: null, updatedAt: null });
  });

  it("keeps each author's blob separate (AD2)", async () => {
    const { slug } = await makeShared(owner, "authenticated");
    await dataMe(slug, { method: "PUT", body: '{"who":"owner"}', cookie: owner });
    await dataMe(slug, { method: "PUT", body: '{"who":"other"}', cookie: other });
    expect(((await (await dataMe(slug, { method: "GET", cookie: owner })).json()) as DataEntryResponse).blob).toBe(
      '{"who":"owner"}',
    );
    expect(((await (await dataMe(slug, { method: "GET", cookie: other })).json()) as DataEntryResponse).blob).toBe(
      '{"who":"other"}',
    );
  });

  it("rejects invalid JSON (400) and unauthenticated writes (401) (AD3, AD8)", async () => {
    const { slug } = await makeShared(owner);
    expect((await dataMe(slug, { method: "PUT", body: "not json", cookie: owner })).status).toBe(400);
    expect((await dataMe(slug, { method: "PUT", body: "{}", cookie: null })).status).toBe(401);
  });

  it("rejects an oversize blob with 413 (AD8)", async () => {
    const { slug } = await makeShared(owner);
    const huge = JSON.stringify("x".repeat(5 * 1024 * 1024 + 1));
    expect((await dataMe(slug, { method: "PUT", body: huge, cookie: owner })).status).toBe(413);
  });

  it("returns 404 for an archived artefact (AD6)", async () => {
    const { id, slug } = await makeShared(owner);
    await app.request(`/api/artefacts/${id}/archive`, { method: "POST", headers: { cookie: owner } });
    expect((await dataMe(slug, { method: "GET", cookie: owner })).status).toBe(404);
    expect((await dataMe(slug, { method: "PUT", body: "{}", cookie: owner })).status).toBe(404);
  });

  it("hides a private artefact's data from a non-owner (AD4)", async () => {
    const { id, slug } = await makeShared(owner);
    // Unshare → private, slug retained.
    await app.request(`/api/artefacts/${id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: owner },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect((await dataMe(slug, { method: "PUT", body: "{}", cookie: other })).status).toBe(404);
    expect((await dataMe(slug, { method: "PUT", body: "{}", cookie: owner })).status).toBe(200);
  });

  it("deletes the caller's entry (204), after which it reads null", async () => {
    const { slug } = await makeShared(owner);
    await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
    expect((await dataMe(slug, { method: "DELETE", cookie: owner })).status).toBe(204);
    expect(((await (await dataMe(slug, { method: "GET", cookie: owner })).json()) as DataEntryResponse).blob).toBeNull();
  });

  // S19 (AD9) — against the real Drizzle adapter, because the upsert is an
  // INSERT … ON CONFLICT DO UPDATE whose SET clause must carry the pin too:
  // otherwise it is stamped on the first write and frozen on every later one.
  describe("payload version pin (S19/AD9)", () => {
    // The owner's pin, read back through the Drizzle adapter.
    async function pinOf(artefactId: string) {
      const { dataRepository } = await import("./adapters");
      const { db } = await import("../infra/db/client");
      const { user } = await import("../infra/db/schema");
      const { eq } = await import("drizzle-orm");
      const [u] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "data-owner@example.com"));
      return (await dataRepository.findByArtefactAndAuthor(artefactId, u!.id))
        ?.authoredAgainstVersion;
    }

    async function payloadHashOf(artefactId: string) {
      const { artefactRepository } = await import("./adapters");
      const { SINGLETON_SCOPE } = await import("../domain/artefact/tenant-scope");
      return (await artefactRepository.findById(artefactId, SINGLETON_SCOPE))!.payloadHash;
    }

    it("stamps the payload hash on write and re-stamps it after a payload edit", async () => {
      const { id, slug } = await makeShared(owner);
      await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
      const first = await payloadHashOf(id);
      expect(await pinOf(id)).toBe(first);

      const form = new FormData();
      form.set("payload", new File(["<h1>f, reshaped</h1>"], "f.html"));
      expect(
        (await app.request(`/api/artefacts/${id}`, { method: "PATCH", body: form, headers: { cookie: owner } }))
          .status,
      ).toBe(200);
      const second = await payloadHashOf(id);
      expect(second).not.toBe(first);
      // Written before the edit → the staleness signal.
      expect(await pinOf(id)).toBe(first);

      await dataMe(slug, { method: "PUT", body: '{"v":2}', cookie: owner });
      expect(await pinOf(id)).toBe(second);
    });

    it("an entry predating the column reads null and is served normally", async () => {
      const { id, slug } = await makeShared(owner);
      await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
      const { db } = await import("../infra/db/client");
      const { dataEntry } = await import("../infra/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(dataEntry).set({ authoredAgainstVersion: null }).where(eq(dataEntry.artefactId, id));

      expect(await pinOf(id)).toBeNull();
      const get = await dataMe(slug, { method: "GET", cookie: owner });
      expect(get.status).toBe(200);
      expect(((await get.json()) as DataEntryResponse).blob).toBe('{"v":1}');
    });
  });

  // S31 — the served tab's shim pins its writes so a stale tab cannot silently
  // overwrite data replaced elsewhere (e.g. by an agent). Unpinned PUTs are
  // unchanged (every test above).
  describe("conditional PUT (S31)", () => {
    function pinnedPut(slug: string, body: string, headers: Record<string, string>) {
      return app.request(`/api/artefacts/${slug}/data/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner, ...headers },
        body,
      });
    }

    it("If-Match the current updatedAt → 200", async () => {
      const { slug } = await makeShared(owner);
      const first = (await (
        await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner })
      ).json()) as DataEntryResponse;
      const res = await pinnedPut(slug, '{"v":2}', { "If-Match": `"${first.updatedAt}"` });
      expect(res.status).toBe(200);
      expect(((await res.json()) as DataEntryResponse).blob).toBe('{"v":2}');
    });

    it("If-Match a stale updatedAt → 412, nothing written", async () => {
      const { slug } = await makeShared(owner);
      await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
      const res = await pinnedPut(slug, '{"v":"stale-tab"}', {
        "If-Match": '"2000-01-01T00:00:00.000Z"',
      });
      expect(res.status).toBe(412);
      const get = (await (await dataMe(slug, { method: "GET", cookie: owner })).json()) as DataEntryResponse;
      expect(get.blob).toBe('{"v":1}');
    });

    it("If-None-Match: * → 200 when there is no entry, 412 once one exists", async () => {
      const { slug } = await makeShared(owner);
      expect((await pinnedPut(slug, '{"v":1}', { "If-None-Match": "*" })).status).toBe(200);
      expect((await pinnedPut(slug, '{"v":2}', { "If-None-Match": "*" })).status).toBe(412);
    });

    it("an unparseable If-Match → 400, never an unconditional write", async () => {
      const { slug } = await makeShared(owner);
      await dataMe(slug, { method: "PUT", body: '{"v":1}', cookie: owner });
      expect((await pinnedPut(slug, '{"v":2}', { "If-Match": '"not-a-date"' })).status).toBe(400);
      const get = (await (await dataMe(slug, { method: "GET", cookie: owner })).json()) as DataEntryResponse;
      expect(get.blob).toBe('{"v":1}');
    });
  });
});
