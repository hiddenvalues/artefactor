import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";
import { openFrame } from "../test/frame";

// End-to-end S3 (edit) + S7 (archive/restore): drive the real app against a
// throwaway db + payload store.
describe("edit + archive/restore (S3, S7)", () => {
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

  async function create(cookie: string, title: string, html = "<h1>v1</h1>") {
    const form = new FormData();
    form.set("title", title);
    form.set("kind", "prototype");
    form.set("payload", new File([html], "a.html"));
    return (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
    ).json()) as ArtefactSummary;
  }

  function patch(id: string, fields: Record<string, string | File>, cookie?: string) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return app.request(`/api/artefacts/${id}`, {
      method: "PATCH",
      body: form,
      headers: cookie ? { cookie } : {},
    });
  }

  function post(path: string, cookie?: string) {
    return app.request(path, { method: "POST", headers: cookie ? { cookie } : {} });
  }

  function del(path: string, cookie?: string) {
    return app.request(path, { method: "DELETE", headers: cookie ? { cookie } : {} });
  }

  async function listTitles(cookie: string, archived = false) {
    const res = await app.request(`/api/artefacts${archived ? "?archived=true" : ""}`, {
      headers: { cookie },
    });
    return ((await res.json()) as { artefacts: ArtefactSummary[] }).artefacts.map(
      (a) => a.title,
    );
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("owner-lc@example.com");
    other = await signUp("other-lc@example.com");
  });

  describe("edit (S3)", () => {
    it("updates title + kind and reflects them in the detail view", async () => {
      const a = await create(owner, "Original");
      const res = await patch(a.id, { title: "Renamed", kind: "slide-deck" }, owner);
      expect(res.status).toBe(200);
      const updated = (await res.json()) as ArtefactSummary;
      expect(updated).toMatchObject({ title: "Renamed", kind: "slide-deck" });
    });

    it("replaces the payload, served back by the owner raw view", async () => {
      const a = await create(owner, "WithPayload", "<h1>v1</h1>");
      expect((await patch(a.id, { payload: new File(["<h1>v2</h1>"], "b.html") }, owner)).status).toBe(200);
      // The artefact content lives in the raw view's iframe frame (S12 shell),
      // opened with a frame token (S36).
      const raw = await openFrame(app, a.id, owner);
      expect(await raw.text()).toContain("<h1>v2</h1>");
    });

    it("rejects an empty title (400), a non-owner (404) and the anonymous (401)", async () => {
      const a = await create(owner, "Guards");
      expect((await patch(a.id, { title: "   " }, owner)).status).toBe(400);
      expect((await patch(a.id, { title: "x" }, other)).status).toBe(404);
      expect((await patch(a.id, { title: "x" })).status).toBe(401);
    });
  });

  describe("archive / restore (S7)", () => {
    it("archives, hides from the active list + owner view, then restores", async () => {
      const a = await create(owner, "Lifecycle");
      // Share it so we can also assert the slug stops serving.
      await app.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner },
        body: JSON.stringify({ visibility: "public" }),
      });
      const slug = (await (
        await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: owner } })
      ).json() as ArtefactSummary).publicSlug!;

      const archived = await post(`/api/artefacts/${a.id}/archive`, owner);
      expect(archived.status).toBe(200);
      expect(((await archived.json()) as ArtefactSummary).status).toBe("archived");

      // Hidden from active "Your artefacts" + owner view + slug serving; visible in archived list.
      expect(await listTitles(owner)).not.toContain("Lifecycle");
      expect(await listTitles(owner, true)).toContain("Lifecycle");
      expect((await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: owner } })).status).toBe(404);
      // Archived ⇒ not served. An anonymous viewer is bounced to sign-in (302),
      // uniform with any other miss; the artefact is no longer rendered (≠ 200).
      expect((await app.request(`/a/${slug}`)).status).toBe(302);

      const restored = await post(`/api/artefacts/${a.id}/restore`, owner);
      expect(restored.status).toBe(200);
      const body = (await restored.json()) as ArtefactSummary;
      expect(body.status).toBe("active");
      expect(body.visibility).toBe("public"); // prior tier retained
      expect(await listTitles(owner)).toContain("Lifecycle");
      expect((await app.request(`/a/${slug}`)).status).toBe(200);
    });

    it("rejects a non-owner archive (404) and the anonymous (401)", async () => {
      const a = await create(owner, "Protected");
      expect((await post(`/api/artefacts/${a.id}/archive`, other)).status).toBe(404);
      expect((await post(`/api/artefacts/${a.id}/archive`)).status).toBe(401);
    });

    it("rejects archiving twice (404) and restoring an active artefact (400)", async () => {
      const a = await create(owner, "Twice");
      expect((await post(`/api/artefacts/${a.id}/archive`, owner)).status).toBe(200);
      expect((await post(`/api/artefacts/${a.id}/archive`, owner)).status).toBe(404);

      const b = await create(owner, "StillActive");
      expect((await post(`/api/artefacts/${b.id}/restore`, owner)).status).toBe(400);
    });
  });

  describe("delete (S15, AH11)", () => {
    it("refuses to delete an active artefact (400) — must archive first", async () => {
      const a = await create(owner, "ActiveDelete");
      expect((await del(`/api/artefacts/${a.id}`, owner)).status).toBe(400);
      expect(await listTitles(owner)).toContain("ActiveDelete");
    });

    it("permanently deletes an archived artefact (204), gone everywhere after", async () => {
      const a = await create(owner, "DeleteMe");
      expect((await post(`/api/artefacts/${a.id}/archive`, owner)).status).toBe(200);
      expect((await del(`/api/artefacts/${a.id}`, owner)).status).toBe(204);
      expect(await listTitles(owner, true)).not.toContain("DeleteMe");
      expect((await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: owner } })).status).toBe(404);
      // A second delete now sees nothing to delete → not-found.
      expect((await del(`/api/artefacts/${a.id}`, owner)).status).toBe(404);
    });

    it("rejects a non-owner delete (404) and the anonymous (401)", async () => {
      const a = await create(owner, "GuardedDelete");
      await post(`/api/artefacts/${a.id}/archive`, owner);
      expect((await del(`/api/artefacts/${a.id}`, other)).status).toBe(404);
      expect((await del(`/api/artefacts/${a.id}`)).status).toBe(401);
      // Still there for the owner.
      expect(await listTitles(owner, true)).toContain("GuardedDelete");
    });
  });
});
