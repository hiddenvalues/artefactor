import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  ArtefactViewersResponse,
  MyViewsResponse,
} from "../shared/contracts";
import { mintFrameToken, openFrame } from "../test/frame";

// End-to-end S21: record a view when a signed-in viewer opens an artefact, and
// list "who has viewed" via the BFF. Drives the real app against a throwaway db
// + filesystem payload store.
describe("who has viewed (S21)", () => {
  let app: Hono;
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;
  let otherId: string;

  const HTML = "<!doctype html><h1>served</h1>";

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function meId(cookie: string): Promise<string> {
    return (
      (await (await app.request("/api/me", { headers: { cookie } })).json()) as {
        id: string;
      }
    ).id;
  }

  async function makePublicArtefact(): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", "viewable artefact");
    form.set("kind", "prototype");
    form.set("payload", new File([HTML], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: ownerCookie },
      })
    ).json()) as ArtefactSummary;
    const shared = await app.request(`/api/artefacts/${created.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ visibility: "public" }),
    });
    return (await shared.json()) as ArtefactSummary;
  }

  function open(slug: string, cookie?: string) {
    return app.request(`/a/${slug}`, { headers: cookie ? { cookie } : {} });
  }

  async function viewers(
    ref: string,
    cookie?: string,
  ): Promise<{ status: number; body: ArtefactViewersResponse }> {
    const res = await app.request(`/api/artefacts/${ref}/viewers`, {
      headers: cookie ? { cookie } : {},
    });
    const body = res.status === 200 ? await res.json() : { viewers: [] };
    return { status: res.status, body: body as ArtefactViewersResponse };
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    ownerCookie = await signUp("owner-s21@example.com");
    otherCookie = await signUp("other-s21@example.com");
    ownerId = await meId(ownerCookie);
    otherId = await meId(otherCookie);
  });

  // r[verify views.shell.viewed-by-widget]
  it("renders the 'viewed by' widget (and its endpoint) only for signed-in viewers", async () => {
    const a = await makePublicArtefact();
    const signedIn = await (await open(a.publicSlug!, otherCookie)).text();
    expect(signedIn).toContain('id="ae-viewers"');
    expect(signedIn).toContain(`/api/artefacts/${a.publicSlug}/viewers`);
    // The owner preview is a signed-in host shell too.
    const preview = await (
      await app.request(`/api/artefacts/${a.id}/raw`, { headers: { cookie: ownerCookie } })
    ).text();
    expect(preview).toContain('id="ae-viewers"');
    expect(preview).toContain(`/api/artefacts/${a.id}/viewers`);
    // Anonymous viewers never get the host tools, so never the widget.
    const anon = await (await open(a.publicSlug!)).text();
    expect(anon).not.toContain('id="ae-viewers"');
  });

  // r[verify views.record.on-shell-serve]
  // r[verify views.viewers-endpoint.identity-enriched]
  // r[verify views.viewers.excludes-caller]
  it("records a signed-in view and lists it for another viewer, excluding the caller", async () => {
    const a = await makePublicArtefact();
    // A signed-in non-owner opens it → a view is recorded.
    expect((await open(a.publicSlug!, otherCookie)).status).toBe(200);

    // The owner sees the other viewer (with display identity), not themselves.
    const seen = await viewers(a.publicSlug!, ownerCookie);
    expect(seen.status).toBe(200);
    expect(seen.body.viewers.map((v) => v.viewerId)).toEqual([otherId]);
    const who = seen.body.viewers[0]!;
    expect(who.email).toBe("other-s21@example.com");
    expect(who.name).toBe("other-s21@example.com");
    expect(Date.parse(who.viewedAt)).not.toBeNaN();
  });

  // r[verify views.entry.one-per-pair]
  it("keeps latest view only — re-opening adds no second entry", async () => {
    const a = await makePublicArtefact();
    await open(a.publicSlug!, otherCookie);
    await open(a.publicSlug!, otherCookie);
    const seen = await viewers(a.publicSlug!, ownerCookie);
    expect(seen.body.viewers).toHaveLength(1);
    expect(seen.body.viewers[0]!.viewerId).toBe(otherId);
  });

  // r[verify views.viewers.excludes-caller]
  it("excludes the owner's own view from their list", async () => {
    const a = await makePublicArtefact();
    // Only the owner opens it (via the shared link).
    await open(a.publicSlug!, ownerCookie);
    const seen = await viewers(a.publicSlug!, ownerCookie);
    expect(seen.body.viewers).toEqual([]);
  });

  // r[verify views.record.on-shell-serve]
  it("records nothing when the shell is denied or the artefact is archived", async () => {
    const a = await makePublicArtefact();
    const setVisibility = (visibility: string) =>
      app.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ visibility }),
      });
    // Private (slug retained): the signed-in non-owner is denied, so no view.
    expect((await setVisibility("private")).status).toBe(200);
    expect((await open(a.publicSlug!, otherCookie)).status).toBe(404);
    // Archived: nothing is served, so no view.
    expect((await setVisibility("public")).status).toBe(200);
    const lifecycle = (action: string) =>
      app.request(`/api/artefacts/${a.id}/${action}`, {
        method: "POST",
        headers: { cookie: ownerCookie },
      });
    const archived = await lifecycle("archive");
    expect(archived.status).toBe(200);
    expect((await open(a.publicSlug!, otherCookie)).status).toBe(404);
    const restored = await lifecycle("restore");
    expect(restored.status).toBe(200);
    const seen = await viewers(a.publicSlug!, ownerCookie);
    expect(seen.status).toBe(200);
    expect(seen.body.viewers).toEqual([]);
  });

  // r[verify views.record.authenticated-only]
  it("does not record anonymous opens", async () => {
    const a = await makePublicArtefact();
    // An anonymous visitor opens the public link — nothing is attributed.
    expect((await open(a.publicSlug!)).status).toBe(200);
    const seen = await viewers(a.publicSlug!, ownerCookie);
    expect(seen.body.viewers).toEqual([]);
  });

  // r[verify views.viewers.follows-artefact-access]
  it("requires auth to read the viewers list", async () => {
    const a = await makePublicArtefact();
    const res = await app.request(`/api/artefacts/${a.publicSlug}/viewers`);
    expect(res.status).toBe(401);
  });

  // r[verify hosting.access.no-existence-leak]
  // r[verify views.viewers.follows-artefact-access]
  it("404s the viewers list for a viewer who cannot see the artefact", async () => {
    // Share to mint a slug, then unshare → private but addressable by slug.
    const a = await makePublicArtefact();
    await app.request(`/api/artefacts/${a.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ visibility: "private" }),
    });
    // A signed-in non-owner is denied (flat 404, no existence leak).
    expect((await viewers(a.publicSlug!, otherCookie)).status).toBe(404);
    // The owner can still read it.
    expect((await viewers(a.publicSlug!, ownerCookie)).status).toBe(200);
  });
  // S47 — the owner preview records a view, and the caller reads their own
  // views of what they can open now.
  describe("own views (S47)", () => {
    async function makePrivateArtefact(cookie = ownerCookie): Promise<ArtefactSummary> {
      const form = new FormData();
      form.set("title", "own artefact");
      form.set("kind", "prototype");
      form.set("payload", new File([HTML], "a.html"));
      const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
      return (await res.json()) as ArtefactSummary;
    }

    async function setVisibility(id: string, visibility: string, cookie = ownerCookie) {
      const res = await app.request(`/api/artefacts/${id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as ArtefactSummary;
    }

    const preview = (id: string, cookie: string) =>
      app.request(`/api/artefacts/${id}/raw`, { headers: { cookie } });

    async function mine(cookie: string): Promise<MyViewsResponse["views"]> {
      const res = await app.request("/api/views/mine", { headers: { cookie } });
      expect(res.status).toBe(200);
      return ((await res.json()) as MyViewsResponse).views;
    }
    const viewedAtOf = async (cookie: string, id: string) =>
      (await mine(cookie)).filter((v) => v.artefactId === id);

    // r[verify views.mine.own-visible-only]
    it("401s an anonymous caller", async () => {
      expect((await app.request("/api/views/mine")).status).toBe(401);
    });

    // r[verify hosting.home.own-views]
    // r[verify views.record.on-owner-preview]
    // r[verify views.entry.one-per-pair]
    it("records the owner's preview; a second open bumps viewedAt and adds no row", async () => {
      const a = await makePrivateArtefact();
      expect(await viewedAtOf(ownerCookie, a.id)).toEqual([]);
      expect((await preview(a.id, ownerCookie)).status).toBe(200);
      const first = await viewedAtOf(ownerCookie, a.id);
      expect(first).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 1100)); // SQLite timestamps are whole seconds
      await preview(a.id, ownerCookie);
      const second = await viewedAtOf(ownerCookie, a.id);
      expect(second).toHaveLength(1);
      expect(Date.parse(second[0]!.viewedAt)).toBeGreaterThan(Date.parse(first[0]!.viewedAt));
    });

    // r[verify hosting.home.own-views]
    // r[verify views.record.on-owner-preview]
    it("records nothing for a non-owner's 404, the preview frame or the frame-token route", async () => {
      const a = await makePrivateArtefact();
      expect((await preview(a.id, otherCookie)).status).toBe(404);
      // The owner preview's frame: minted on the id ref, then loaded.
      expect((await openFrame(app, a.id, ownerCookie)).status).toBe(200);
      // Shared now, so their own views would list any entry either of them had.
      const shared = await setVisibility(a.id, "public");
      expect(shared.publicSlug).toBeTruthy();
      // The frame-token route on the slug ref, for the owner and a non-owner.
      for (const cookie of [ownerCookie, otherCookie]) {
        expect((await mintFrameToken(app, shared.publicSlug!, cookie)).status).toBe(200);
      }
      expect(await viewedAtOf(otherCookie, a.id)).toEqual([]);
      expect(await viewedAtOf(ownerCookie, a.id)).toEqual([]);
    });

    // r[verify hosting.home.own-views]
    // r[verify views.mine.own-visible-only]
    it("lists own active and selected-member views newest first, and never another viewer's", async () => {
      const own = await makePrivateArtefact();
      const theirs = await makePrivateArtefact(otherCookie);
      await setVisibility(theirs.id, "selected", otherCookie);
      const grant = await app.request(`/api/artefacts/${theirs.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: otherCookie },
        body: JSON.stringify({ userId: ownerId }),
      });
      expect(grant.ok).toBe(true);
      const slug = (
        (await (await app.request(`/api/artefacts/${theirs.id}`, { headers: { cookie: otherCookie } })).json()) as ArtefactSummary
      ).publicSlug!;

      await preview(own.id, ownerCookie);
      await new Promise((r) => setTimeout(r, 1100));
      expect((await open(slug, ownerCookie)).status).toBe(200);
      // The author's own preview is their entry, never the owner's.
      await preview(theirs.id, otherCookie);

      const views = (await mine(ownerCookie)).filter((v) => [own.id, theirs.id].includes(v.artefactId));
      expect(views.map((v) => v.artefactId)).toEqual([theirs.id, own.id]);
      const all = await mine(ownerCookie);
      const sorted = [...all].sort((x, y) => Date.parse(y.viewedAt) - Date.parse(x.viewedAt));
      expect(all).toEqual(sorted);
      expect(await viewedAtOf(otherCookie, own.id)).toEqual([]);
      expect(otherId).not.toBe(ownerId);
    });

    // r[verify hosting.home.own-views]
    // r[verify views.mine.own-visible-only]
    it("omits an own artefact once archived, and another's once set private", async () => {
      const own = await makePrivateArtefact();
      await preview(own.id, ownerCookie);
      const theirs = await makePrivateArtefact(otherCookie);
      await setVisibility(theirs.id, "authenticated", otherCookie);
      const slug = (
        (await (await app.request(`/api/artefacts/${theirs.id}`, { headers: { cookie: otherCookie } })).json()) as ArtefactSummary
      ).publicSlug!;
      await open(slug, ownerCookie);
      expect(await viewedAtOf(ownerCookie, own.id)).toHaveLength(1);
      expect(await viewedAtOf(ownerCookie, theirs.id)).toHaveLength(1);

      await app.request(`/api/artefacts/${own.id}/archive`, { method: "POST", headers: { cookie: ownerCookie } });
      await setVisibility(theirs.id, "private", otherCookie);
      expect(await viewedAtOf(ownerCookie, own.id)).toEqual([]);
      expect(await viewedAtOf(ownerCookie, theirs.id)).toEqual([]);
    });
  });
});
