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
// worker uses, so this test needs no browser (AH27, AH26).
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

  // What the worker does once a render lands (AH26).
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
    it("is null on create and until a render is recorded", async () => {
      const a = await create(owner);
      expect(a.thumbnailUrl).toBeNull();
      expect((await summaryOf(owner, a.id)).thumbnailUrl).toBeNull();
    });

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

    it("is null for an archived artefact", async () => {
      const a = await create(owner);
      await render(a.id);
      await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
      const archived = (await (await app.request("/api/artefacts?archived=true", { headers: { cookie: owner } })).json()) as ArtefactListResponse;
      expect(archived.artefacts.find((x) => x.id === a.id)!.thumbnailUrl).toBeNull();
    });

    it("keeps pointing at the previous render after an HTML replace, until the new one lands (AH26)", async () => {
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

  describe("read access (AH27)", () => {
    it("serves the owner's own private artefact by id", async () => {
      const a = await create(owner);
      await render(a.id);
      await expectImage(await thumbnail(a.id, owner));
    });

    it("serves any signed-in user on an authenticated artefact, by slug or id", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "authenticated");
      await render(a.id);
      await expectImage(await thumbnail(shared.publicSlug!, other));
      await expectImage(await thumbnail(a.id, other));
    });

    it("serves any signed-in user on a public artefact", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      await expectImage(await thumbnail(shared.publicSlug!, other));
    });

    it("serves a selected member, and 404s a signed-in non-member", async () => {
      const a = await create(owner);
      await share(owner, a.id, "selected");
      expect((await send(owner, "POST", `/api/artefacts/${a.id}/access`, { userId: memberId })).status).toBe(204);
      await render(a.id);
      await expectImage(await thumbnail(a.id, member));
      expect((await thumbnail(a.id, other)).status).toBe(404);
    });

    it("serves under a collection root's inherited tier", async () => {
      const col = (await (await send(owner, "POST", "/api/collections", { name: "Shared tree", visibility: "authenticated" })).json()) as CollectionSummary;
      const a = await create(owner);
      expect((await send(owner, "PUT", `/api/artefacts/${a.id}/collection`, { collectionId: col.id })).status).toBe(200);
      await render(a.id);
      await expectImage(await thumbnail(a.id, other));
    });

    it("401s an anonymous caller for every ref, even a public one", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      expect((await thumbnail(shared.publicSlug!, null)).status).toBe(401);
      expect((await thumbnail(a.id, null)).status).toBe(401);
      expect((await thumbnail("no-such-artefact", null)).status).toBe(401);
    });

    it("404s a private artefact for a non-owner", async () => {
      const a = await create(owner);
      await render(a.id);
      expect((await thumbnail(a.id, other)).status).toBe(404);
    });

    it("404s an unknown ref", async () => {
      expect((await thumbnail("no-such-artefact", owner)).status).toBe(404);
    });

    it("404s an archived artefact, including for its owner (AH7)", async () => {
      const a = await create(owner);
      const shared = await share(owner, a.id, "public");
      await render(a.id);
      await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
      expect((await thumbnail(a.id, owner)).status).toBe(404);
      expect((await thumbnail(shared.publicSlug!, other)).status).toBe(404);
    });

    it("404s an artefact that has no thumbnail yet", async () => {
      const a = await create(owner);
      expect((await thumbnail(a.id, owner)).status).toBe(404);
    });

    it("keeps serving the previous thumbnail while a replaced payload renders", async () => {
      const a = await create(owner);
      await render(a.id);
      const form = new FormData();
      form.set("payload", new File(["<h1>v2</h1>"], "a.html"));
      await app.request(`/api/artefacts/${a.id}`, { method: "PATCH", body: form, headers: { cookie: owner } });
      await expectImage(await thumbnail(a.id, owner));
    });
  });

  it("permanent delete removes the thumbnail files (AH11)", async () => {
    const a = await create(owner);
    const hash = await render(a.id);
    await send(owner, "POST", `/api/artefacts/${a.id}/archive`);
    expect((await send(owner, "DELETE", `/api/artefacts/${a.id}`)).status).toBe(204);
    expect(await thumbs.get(a.id, hash)).toBeNull();
  });
});
