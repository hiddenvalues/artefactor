import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactListResponse,
  ArtefactSummary,
  CollectionSummary,
  SharedListResponse,
} from "../shared/contracts";
import type { ArtefactRepository } from "../domain/artefact/artefact-repository";
import type { ThumbnailStore } from "../domain/artefact/ports";
import { SINGLETON_SCOPE } from "../domain/artefact/tenant-scope";

// End-to-end S35: the thumbnail read and the summary's `thumbnailUrl` through
// the real app (BFF → access matrix → thumbnail store) against a throwaway db.
// Renders are simulated by writing through the same store + compare-and-set the
// worker uses, so this test needs no browser. S44 adds the
// anonymous, slug-only read (`hosting.thumbnail.anonymous-by-slug`).
describe("artefact thumbnails — GET /api/artefacts/:ref/thumbnail (S35)", () => {
  let app: Hono;
  let repo: ArtefactRepository;
  let thumbs: ThumbnailStore;
  let owner: string;
  let other: string;
  let member: string;
  let memberId: string;

  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function idOf(cookie: string): Promise<string> {
    return ((await (await app.request("/api/me", { headers: { cookie } })).json()) as { id: string }).id;
  }

  async function create(cookie: string, html = "<h1>thumb</h1>"): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", "Thumbnailed");
    form.set("kind", "prototype");
    form.set("payload", new File([html], "a.html"));
    const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(201);
    return (await res.json()) as ArtefactSummary;
  }

  async function send(cookie: string, method: string, path: string, body?: unknown) {
    return app.request(path, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function share(cookie: string, id: string, visibility: string): Promise<ArtefactSummary> {
    return (await (await send(cookie, "PUT", `/api/artefacts/${id}/visibility`, { visibility })).json()) as ArtefactSummary;
  }

  // What the worker does once a render lands (hosting.thumbnail.recorded-by-compare-and-set).
  async function render(id: string): Promise<string> {
    const a = (await repo.findById(id, SINGLETON_SCOPE))!;
    await thumbs.put(id, a.payloadHash, WEBP);
    expect(await repo.recordThumbnail(id, a.payloadHash)).toBe(true);
    return a.payloadHash;
  }

  async function summaryOf(cookie: string, id: string): Promise<ArtefactSummary> {
    return (await (await app.request(`/api/artefacts/${id}`, { headers: { cookie } })).json()) as ArtefactSummary;
  }

  function thumbnail(ref: string, cookie?: string | null) {
    return app.request(`/api/artefacts/${ref}/thumbnail`, { headers: cookie ? { cookie } : {} });
  }

  async function expectImage(res: Response) {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    const adapters = await import("./adapters");
    app = createApp();
    repo = adapters.artefactRepository;
    thumbs = adapters.thumbnailStore;
    owner = await signUp("thumb-owner@example.com");
    other = await signUp("thumb-other@example.com");
    member = await signUp("thumb-member@example.com");
    memberId = await idOf(member);
  });

  describe("summary thumbnailUrl", () => {
    // r[verify hosting.thumbnail.summary-url]
    // r[verify hosting.thumbnail.create-enqueues-once]
    it("is null on create and until a render is recorded", async () => {
      const a = await create(owner);
      expect(a.thumbnailUrl).toBeNull();
      expect((await summaryOf(owner, a.id)).thumbnailUrl).toBeNull();
    });

    // r[verify hosting.thumbnail.summary-url]
    it("points at the thumbnail, versioned by its hash, once rendered", async () => {
      const a = await create(owner);
      const hash = await render(a.id);
      expect((await summaryOf(owner, a.id)).thumbnailUrl).toBe(
        `/api/artefacts/${a.id}/thumbnail?v=${hash}`,
      );
      const list = (await (await app.request("/api/artefacts", { headers: { cookie: owner } })).json()) as ArtefactListResponse;
      expect(list.artefacts.find((x) => x.id === a.id)!.thumbnailUrl).toBe(
        `/api/artefacts/${a.id}/thumbnail?v=${hash}`,
      );
    });

    it("appears in \"Shared with you\"", async () => {
      const a = await create(owner);
      await share(owner, a.id, "authenticated");
      const hash = await render(a.id);
      const shared = (await (await app.request("/api/shared", { headers: { cookie: other } })).json()) as SharedListResponse;
      expect(shared.artefacts.find((x) => x.id === a.id)!.thumbnailUrl).toBe(
        `/api/artefacts/${a.id}/thumbnail?v=${hash}`,
      );
    });

    // r[verify hosting.thumbnail.summary-url]
    it("is null for an archived artefact", async () => {
      const a = await create(owner);
      await render(a.id);
      await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
      const archived = (await (await app.request("/api/artefacts?archived=true", { headers: { cookie: owner } })).json()) as ArtefactListResponse;
      expect(archived.artefacts.find((x) => x.id === a.id)!.thumbnailUrl).toBeNull();
    });

    // r[verify hosting.thumbnail.previous-kept-until-replaced]
    it("keeps pointing at the previous render after an HTML replace, until the new one lands", async () => {
      const a = await create(owner);
      const before = await render(a.id);
      const form = new FormData();
      form.set("payload", new File(["<h1>v2</h1>"], "a.html"));
      const res = await app.request(`/api/artefacts/${a.id}`, { method: "PATCH", body: form, headers: { cookie: owner } });
      expect(((await res.json()) as ArtefactSummary).thumbnailUrl).toBe(
        `/api/artefacts/${a.id}/thumbnail?v=${before}`,
      );

      const after = await render(a.id);
      expect(after).not.toBe(before);
      expect((await summaryOf(owner, a.id)).thumbnailUrl).toBe(
        `/api/artefacts/${a.id}/thumbnail?v=${after}`,
      );
    });
  });

  // r[verify hosting.thumbnail.host-chrome-only]
  it("recording a thumbnail changes nothing but thumbnailUrl: the summary, listing, serving and data API answer the same", async () => {
    const a = await create(owner);
    await share(owner, a.id, "public");
    const slug = (await summaryOf(owner, a.id)).publicSlug!;
    const hidden = await create(owner, "<h1>private</h1>");

    async function observe() {
      const { thumbnailUrl, ...summary } = await summaryOf(owner, a.id);
      const list = (await (await app.request("/api/artefacts", { headers: { cookie: owner } })).json()) as ArtefactListResponse;
      const { thumbnailUrl: _listed, ...listed } = list.artefacts.find((x) => x.id === a.id)!;
      const status = async (path: string, cookie?: string) =>
        (await app.request(path, { headers: cookie ? { cookie } : {} })).status;
      return {
        thumbnailUrl,
        rest: {
          summary,
          listed,
          serveOwner: await status(`/a/${slug}`, owner),
          serveOther: await status(`/a/${slug}`, other),
          serveAnonymous: await status(`/a/${slug}`),
          privateDownloadOther: await status(`/api/artefacts/${hidden.id}/download`, other),
          privateDownloadAnonymous: await status(`/api/artefacts/${hidden.id}/download`),
          privateSharedWithOther: (
            (await (await app.request("/api/shared", { headers: { cookie: other } })).json()) as SharedListResponse
          ).artefacts.some((x) => x.id === hidden.id),
          ownData: await (await send(owner, "GET", `/api/artefacts/${a.id}/data/me`)).text(),
          authors: await (await send(owner, "GET", `/api/artefacts/${a.id}/data/authors`)).text(),
        },
      };
    }

    const before = await observe();
    const hash = await render(a.id);
    await render(hidden.id);
    const after = await observe();

    expect(before.thumbnailUrl).toBeNull();
    expect(after.thumbnailUrl).toBe(`/api/artefacts/${a.id}/thumbnail?v=${hash}`);
    expect(after.rest).toEqual(before.rest);
    expect(before.rest.serveAnonymous).toBe(200);
    expect(before.rest.privateDownloadOther).toBe(404);
    expect(before.rest.privateDownloadAnonymous).toBe(404);
    expect(before.rest.privateSharedWithOther).toBe(false);
  });

  describe("read access", () => {
    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("serves the owner's own private artefact by id", async () => {
      const a = await create(owner);
      await render(a.id);
      await expectImage(await thumbnail(a.id, owner));
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("serves any signed-in user on an authenticated artefact, by slug or id", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "authenticated");
      await render(a.id);
      await expectImage(await thumbnail(shared.publicSlug!, other));
      await expectImage(await thumbnail(a.id, other));
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("serves any signed-in user on a public artefact", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      await expectImage(await thumbnail(shared.publicSlug!, other));
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("serves a selected member, and 404s a signed-in non-member", async () => {
      const a = await create(owner);
      await share(owner, a.id, "selected");
      expect((await send(owner, "POST", `/api/artefacts/${a.id}/access`, { userId: memberId })).status).toBe(204);
      await render(a.id);
      await expectImage(await thumbnail(a.id, member));
      expect((await thumbnail(a.id, other)).status).toBe(404);
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("serves under a collection root's inherited tier", async () => {
      const col = (await (await send(owner, "POST", "/api/collections", { name: "Shared tree", visibility: "authenticated" })).json()) as CollectionSummary;
      const a = await create(owner);
      expect((await send(owner, "PUT", `/api/artefacts/${a.id}/collection`, { collectionId: col.id })).status).toBe(200);
      await render(a.id);
      await expectImage(await thumbnail(a.id, other));
    });

    // r[verify hosting.thumbnail.anonymous-by-slug]
    // r[verify hosting.thumbnail.cache-by-audience]
    it("serves an anonymous caller a public artefact by slug, publicly cacheable for 5 minutes", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      const res = await thumbnail(shared.publicSlug!, null);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
    });

    // r[verify hosting.thumbnail.anonymous-by-slug]
    // r[verify hosting.thumbnail.cache-by-audience]
    it("serves an anonymous caller an artefact contained in a public root, by slug", async () => {
      const col = (await (await send(owner, "POST", "/api/collections", { name: "Public tree", visibility: "public" })).json()) as CollectionSummary;
      const a = await create(owner);
      const moved = (await (await send(owner, "PUT", `/api/artefacts/${a.id}/collection`, { collectionId: col.id })).json()) as ArtefactSummary;
      await render(a.id);
      const res = await thumbnail(moved.publicSlug!, null);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    });

    // r[verify hosting.thumbnail.anonymous-by-slug]
    it("gives an anonymous caller one flat 404 for an id, an unknown, private or archived slug, and an unrendered artefact", async () => {
      const pub = await create(owner);
      const pubSlug = (await share(owner, pub.id, "public")).publicSlug!;
      await render(pub.id);

      const wentPrivate = await create(owner);
      const privateSlug = (await share(owner, wentPrivate.id, "public")).publicSlug!;
      await render(wentPrivate.id);
      await share(owner, wentPrivate.id, "private");

      const archived = await create(owner);
      const archivedSlug = (await share(owner, archived.id, "public")).publicSlug!;
      await render(archived.id);
      await send(owner, "POST", `/api/artefacts/${archived.id}/archive`);

      const unrendered = await create(owner);
      const unrenderedSlug = (await share(owner, unrendered.id, "public")).publicSlug!;

      const authOnly = await create(owner);
      const authSlug = (await share(owner, authOnly.id, "authenticated")).publicSlug!;
      await render(authOnly.id);

      const baseline = await thumbnail("no-such-artefact", null);
      expect(baseline.status).toBe(404);
      const body = await baseline.text();
      for (const ref of [pub.id, privateSlug, archivedSlug, unrenderedSlug, authSlug]) {
        const res = await thumbnail(ref, null);
        expect(res.status, ref).toBe(404);
        expect(await res.text(), ref).toBe(body);
      }
      expect((await thumbnail(pubSlug, null)).status).toBe(200);
    });

    // r[verify hosting.thumbnail.cache-by-audience]
    it("keeps the signed-in cache header by slug and by id (regression)", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      await expectImage(await thumbnail(shared.publicSlug!, other));
      await expectImage(await thumbnail(a.id, other));
      await expectImage(await thumbnail(a.id, owner));
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("404s a private artefact for a non-owner", async () => {
      const a = await create(owner);
      await render(a.id);
      expect((await thumbnail(a.id, other)).status).toBe(404);
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("404s an unknown ref", async () => {
      expect((await thumbnail("no-such-artefact", owner)).status).toBe(404);
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    // r[verify hosting.lifecycle.archived-not-served]
    it("404s an archived artefact, including for its owner", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
      expect((await thumbnail(a.id, owner)).status).toBe(404);
      expect((await thumbnail(shared.publicSlug!, other)).status).toBe(404);
    });

    // r[verify hosting.thumbnail.read-follows-export-matrix]
    it("404s an artefact that has no thumbnail yet", async () => {
      const a = await create(owner);
      expect((await thumbnail(a.id, owner)).status).toBe(404);
    });

    // r[verify hosting.thumbnail.previous-kept-until-replaced]
    it("keeps serving the previous thumbnail while a replaced payload renders", async () => {
      const a = await create(owner);
      await render(a.id);
      const form = new FormData();
      form.set("payload", new File(["<h1>v2</h1>"], "a.html"));
      await app.request(`/api/artefacts/${a.id}`, { method: "PATCH", body: form, headers: { cookie: owner } });
      await expectImage(await thumbnail(a.id, owner));
    });
  });

  // r[verify hosting.delete.removes-everything+2]
  it("permanent delete removes the thumbnail files", async () => {
    const a = await create(owner);
    const hash = await render(a.id);
    await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
    expect((await send(owner, "DELETE", `/api/artefacts/${a.id}`)).status).toBe(204);
    expect(await thumbs.get(a.id, hash)).toBeNull();
  });
});
