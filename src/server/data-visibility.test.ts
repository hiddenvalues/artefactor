import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  DataAuthorsResponse,
  DataEntryResponse,
  MeResponse,
} from "../shared/contracts";
import { mintFrameToken, type MintedFrame } from "../test/frame";

// End-to-end S41 — Owner-set data visibility: shared or own-only. The owner's
// `PUT …/data-visibility` route (AH30), and AD11's four enforcement points
// through the real app: the author list, the author read, the frame-token mint
// and the frame redeem.
describe("owner-set data visibility (S41)", () => {
  let app: Hono;
  let owner: string;
  let alice: string;
  let bob: string;
  let carol: string;
  let ownerId: string;
  let aliceId: string;
  let bobId: string;

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

  function setDataVisibility(id: string, cookie: string | null, body: unknown) {
    return app.request(`/api/artefacts/${id}/data-visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  // A storage-using artefact owned by `owner`, shared at `visibility`.
  async function make(visibility = "authenticated") {
    const form = new FormData();
    form.set("title", "Survey");
    form.set("kind", "form");
    form.set(
      "payload",
      new File(["<script>localStorage.setItem('k','v')</script>"], "s.html"),
    );
    const created = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } })
    ).json()) as ArtefactSummary;
    const shared = (await (
      await app.request(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner },
        body: JSON.stringify({ visibility }),
      })
    ).json()) as ArtefactSummary;
    return { id: created.id, slug: shared.publicSlug!, created };
  }

  function putData(slug: string, cookie: string, body: string) {
    return app.request(`/api/artefacts/${slug}/data/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
  }

  // An artefact where the owner, Alice and Bob each hold an entry.
  async function withEntries(visibility = "authenticated") {
    const made = await make(visibility);
    await putData(made.slug, owner, '{"who":"owner"}');
    await putData(made.slug, alice, '{"who":"alice"}');
    await putData(made.slug, bob, '{"who":"bob"}');
    return made;
  }

  async function authorIds(slug: string, cookie?: string): Promise<string[]> {
    const res = await app.request(`/api/artefacts/${slug}/data/authors`, {
      headers: cookie ? { cookie } : {},
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as DataAuthorsResponse).authors.map((a) => a.authorId).sort();
  }

  function authorData(slug: string, authorId: string, cookie?: string) {
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
    owner = await signUp("dv-owner@example.com");
    alice = await signUp("dv-alice@example.com");
    bob = await signUp("dv-bob@example.com");
    carol = await signUp("dv-carol@example.com");
    ownerId = await meId(owner);
    aliceId = await meId(alice);
    bobId = await meId(bob);
  });

  describe("PUT /api/artefacts/:id/data-visibility (AH30)", () => {
    it("a new artefact reports own-only", async () => {
      const { created } = await make();
      expect(created.dataVisibility).toBe("own");
    });

    it("the owner sets it and gets the updated summary", async () => {
      const { id } = await make();
      const res = await setDataVisibility(id, owner, { dataVisibility: "shared" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ArtefactSummary).dataVisibility).toBe("shared");
      const back = await setDataVisibility(id, owner, { dataVisibility: "own" });
      expect(back.status).toBe(200);
      expect(((await back.json()) as ArtefactSummary).dataVisibility).toBe("own");
    });

    it("rejects a bad value with 400", async () => {
      const { id } = await make();
      expect((await setDataVisibility(id, owner, { dataVisibility: "everyone" })).status).toBe(
        400,
      );
      expect((await setDataVisibility(id, owner, {})).status).toBe(400);
      expect((await setDataVisibility(id, owner, null)).status).toBe(400);
      expect((await setDataVisibility(id, owner, "own")).status).toBe(400);
    });

    it("is 404 for a non-owner (AH8/AH9)", async () => {
      const { id } = await make();
      expect((await setDataVisibility(id, alice, { dataVisibility: "shared" })).status).toBe(404);
    });

    it("is 401 unauthenticated", async () => {
      const { id } = await make();
      expect((await setDataVisibility(id, null, { dataVisibility: "shared" })).status).toBe(401);
    });

    it("is refused on an archived artefact with the archived-mutation status (AH7)", async () => {
      const { id } = await make();
      await app.request(`/api/artefacts/${id}/archive`, {
        method: "POST",
        headers: { cookie: owner },
      });
      expect((await setDataVisibility(id, owner, { dataVisibility: "shared" })).status).toBe(400);
    });
  });

  describe("under shared (AD4 unchanged)", () => {
    it("a viewer lists every author and loads another's entry", async () => {
      const { id, slug } = await withEntries();
      await setDataVisibility(id, owner, { dataVisibility: "shared" });
      expect(await authorIds(slug, alice)).toEqual([ownerId, aliceId, bobId].sort());
      const res = await authorData(slug, bobId, alice);
      expect(((await res.json()) as DataEntryResponse).blob).toBe('{"who":"bob"}');
    });
  });

  describe("under own (AD11)", () => {
    it("a non-owner lists only their own entry; the owner lists all; a viewer with none gets []", async () => {
      const { slug } = await withEntries();
      expect(await authorIds(slug, alice)).toEqual([aliceId]);
      expect(await authorIds(slug, owner)).toEqual([ownerId, aliceId, bobId].sort());
      expect(await authorIds(slug, carol)).toEqual([]);
    });

    it("a non-owner's load of another author is the plain 404; the owner's succeeds", async () => {
      const { slug } = await withEntries();
      const refused = await authorData(slug, bobId, alice);
      const unknownArtefact = await authorData("no-such-artefact", bobId, alice);
      expect(refused.status).toBe(404);
      expect(await refused.text()).toBe(await unknownArtefact.text());
      const ownerRead = await authorData(slug, bobId, owner);
      expect(((await ownerRead.json()) as DataEntryResponse).blob).toBe('{"who":"bob"}');
    });

    it("mints a frame token only for what the viewer may load", async () => {
      const { slug } = await withEntries();
      expect((await mintFrameToken(app, slug, alice, bobId)).status).toBe(404);
      expect((await mintFrameToken(app, slug, alice, aliceId)).status).toBe(200);
      expect((await mintFrameToken(app, slug, alice)).status).toBe(200);
      expect((await mintFrameToken(app, slug, owner, bobId)).status).toBe(200);
    });

    it("a foreign-context token minted under shared is refused once the owner flips to own", async () => {
      const { id, slug } = await withEntries();
      await setDataVisibility(id, owner, { dataVisibility: "shared" });
      const minted = await mintFrameToken(app, slug, alice, bobId);
      expect(minted.status).toBe(200);
      const { frameUrl } = (await minted.json()) as MintedFrame;
      expect((await app.request(frameUrl)).status).toBe(200);

      await setDataVisibility(id, owner, { dataVisibility: "own" });
      expect((await app.request(frameUrl)).status).toBe(404);
    });

    it("the viewer's own frame still opens after the flip", async () => {
      const { slug } = await withEntries();
      const minted = await mintFrameToken(app, slug, alice);
      const { frameUrl } = (await minted.json()) as MintedFrame;
      const res = await app.request(frameUrl);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("alice");
    });

    it("gives the anonymous nothing on a public artefact", async () => {
      const { slug } = await withEntries("public");
      expect(await authorIds(slug)).toEqual([]);
      expect((await authorData(slug, bobId)).status).toBe(404);
    });

    it("leaves the viewer's own GET and PUT …/data/me unchanged", async () => {
      const { slug } = await withEntries();
      const put = await putData(slug, alice, '{"who":"alice","v":2}');
      expect(put.status).toBe(200);
      const me = await app.request(`/api/artefacts/${slug}/data/me`, {
        headers: { cookie: alice },
      });
      expect(((await me.json()) as DataEntryResponse).blob).toBe('{"who":"alice","v":2}');
    });
  });
});
