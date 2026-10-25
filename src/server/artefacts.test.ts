import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { SINGLETON_SCOPE } from "../domain/artefact/tenant-scope";
import type { ArtefactSummary } from "../shared/contracts";
import { openFrame } from "../test/frame";

// End-to-end S2: drive the real app — sign a user up, then POST an HTML upload
// to /api/artefacts. Exercises the whole vertical slice (BFF → command →
// Drizzle repo + filesystem payload store) against a throwaway SQLite db.
describe("create artefact (S2)", () => {
  let app: Hono;
  let cookie: string;

  async function postArtefact(
    fields: { title?: string; kind?: string; html?: string | null; ownerId?: string },
    auth = true,
  ) {
    const form = new FormData();
    if (fields.ownerId !== undefined) form.set("ownerId", fields.ownerId);
    if (fields.title !== undefined) form.set("title", fields.title);
    if (fields.kind !== undefined) form.set("kind", fields.kind);
    if (fields.html !== null) {
      form.set(
        "payload",
        new File([fields.html ?? "<h1>hello</h1>"], "a.html", {
          type: "text/html",
        }),
      );
    }
    return app.request("/api/artefacts", {
      method: "POST",
      body: form,
      headers: auth ? { cookie } : {},
    });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "correct-horse-battery",
        name: "Owner",
      }),
    });
    cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  it("rejects an unauthenticated upload with 401", async () => {
    const res = await postArtefact({ title: "X", kind: "prototype" }, false);
    expect(res.status).toBe(401);
  });

  // r[verify hosting.create.from-upload+2]
  // r[verify hosting.create.active-private]
  it("creates an active, private artefact and persists it", async () => {
    const res = await postArtefact({
      title: "My prototype",
      kind: "prototype",
      html: "<!doctype html><h1>hi</h1>",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ArtefactSummary;
    expect(body).toMatchObject({
      title: "My prototype",
      kind: "prototype",
      visibility: "private",
      status: "active",
      publicSlug: null,
    });
    expect(body.payloadBytes).toBe(26);

    // Persisted via the Drizzle adapter and owned by the signed-in user.
    const { db } = await import("../infra/db/client");
    const { DrizzleArtefactRepository } = await import(
      "../infra/db/artefact-repository.drizzle"
    );
    const stored = await new DrizzleArtefactRepository(db).findById(
      body.id,
      SINGLETON_SCOPE,
    );
    expect(stored).not.toBeNull();
    expect(stored!.ownerId).toBe(body.ownerId);
    expect(stored!.visibility).toBe("private");
  });

  // r[verify hosting.create.owner-from-session+2]
  // r[verify hosting.create.owner-is-creator]
  it("makes the signed-in user the artefact's owner", async () => {
    const session = (await (
      await app.request("/api/auth/get-session", { headers: { cookie } })
    ).json()) as { user: { id: string } };
    const res = await postArtefact({ title: "Mine", kind: "form" });
    const body = (await res.json()) as ArtefactSummary;
    expect(body.ownerId).toBe(session.user.id);
  });

  // r[verify hosting.create.owner-from-session+2]
  // r[verify hosting.create.owner-is-creator]
  it("ignores an owner named in the upload: the session user still owns it", async () => {
    const session = (await (
      await app.request("/api/auth/get-session", { headers: { cookie } })
    ).json()) as { user: { id: string } };
    const res = await postArtefact({ title: "Spoofed", kind: "form", ownerId: "someone-else" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ArtefactSummary).ownerId).toBe(session.user.id);
  });

  // r[verify hosting.payload.on-filesystem]
  it("stores the payload as a file, keeping only its reference, size and hash on the row", async () => {
    const html = "<!doctype html><h1>kept on disk</h1>";
    const res = await postArtefact({ title: "Stored", kind: "form", html });
    const body = (await res.json()) as ArtefactSummary;

    const { db } = await import("../infra/db/client");
    const { artefact } = await import("../infra/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(artefact).where(eq(artefact.id, body.id));
    const inline = Object.values(row!).some(
      (v) => typeof v === "string" && v.includes("kept on disk"),
    );
    expect(inline).toBe(false);
    expect(row!.payloadBytes).toBe(html.length);
    expect(row!.payloadHash).toBe(createHash("sha256").update(html).digest("hex"));

    const { payloadStore } = await import("./adapters");
    const onDisk = await payloadStore.get(row!.payloadRef);
    expect(new TextDecoder().decode(onDisk)).toBe(html);
  });

  // r[verify hosting.artefact.title-required]
  it("rejects an empty title with 400", async () => {
    const res = await postArtefact({ title: "   ", kind: "form" });
    expect(res.status).toBe(400);
  });

  // r[verify hosting.payload.size-bounds]
  it("rejects a missing payload file with 400", async () => {
    const res = await postArtefact({ title: "No file", kind: "form", html: null });
    expect(res.status).toBe(400);
  });

  // r[verify hosting.kind.closed-set]
  it("rejects an unknown kind with 400", async () => {
    const res = await postArtefact({ title: "Bad kind", kind: "spreadsheet" });
    expect(res.status).toBe(400);
  });

  // S10 — "Your artefacts" listing. Uses a fresh user so counts are exact and
  // independent of the artefacts created by the tests above.
  describe("list own artefacts (S10)", () => {
    let listerCookie: string;
    let listerId: string;
    let secondId: string;

    async function createAs(cookieValue: string, title: string, kind: string) {
      const form = new FormData();
      form.set("title", title);
      form.set("kind", kind);
      form.set("payload", new File(["<h1>x</h1>"], "a.html"));
      return app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: cookieValue },
      });
    }

    beforeAll(async () => {
      const signUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "lister@example.com",
          password: "correct-horse-battery",
          name: "Lister",
        }),
      });
      listerCookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
      const me = await app.request("/api/me", {
        headers: { cookie: listerCookie },
      });
      listerId = ((await me.json()) as { id: string }).id;

      await createAs(listerCookie, "First", "prototype");
      secondId = ((await (await createAs(listerCookie, "Second", "form")).json()) as { id: string })
        .id;

      // An archived artefact for this owner — must be hidden from the list
      // (hosting.lifecycle.archived-hidden-from-listings).
      const { db } = await import("../infra/db/client");
      const { DrizzleArtefactRepository } = await import(
        "../infra/db/artefact-repository.drizzle"
      );
      const { createArtefact } = await import("../domain/artefact/artefact");
      const repo = new DrizzleArtefactRepository(db);
      await repo.save({
        ...createArtefact({
          id: "archived-one",
          ownerId: listerId,
          title: "Archived",
          kind: "other",
          payload: { ref: "ref-x", bytes: 10, hash: "h" },
        }),
        status: "archived",
      });
    });

    it("rejects an unauthenticated list with 401", async () => {
      const res = await app.request("/api/artefacts");
      expect(res.status).toBe(401);
    });

    // r[verify hosting.lifecycle.archived-hidden-from-listings]
    // r[verify hosting.list.own-active+2]
    it("returns only the caller's active artefacts, newest first", async () => {
      const res = await app.request("/api/artefacts", {
        headers: { cookie: listerCookie },
      });
      expect(res.status).toBe(200);
      const { artefacts } = (await res.json()) as {
        artefacts: { title: string; ownerId: string; status: string }[];
      };
      expect(artefacts.map((a) => a.title)).toEqual(["Second", "First"]);
      expect(artefacts.every((a) => a.ownerId === listerId)).toBe(true);
      expect(artefacts.some((a) => a.title === "Archived")).toBe(false);
    });

    // r[verify hosting.list.own-active+2]
    it("gives each listed artefact its visibility and, once shared, its slug", async () => {
      const shared = await app.request(`/api/artefacts/${secondId}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: listerCookie },
        body: JSON.stringify({ visibility: "public" }),
      });
      expect(shared.status).toBe(200);
      const res = await app.request("/api/artefacts", { headers: { cookie: listerCookie } });
      const { artefacts } = (await res.json()) as {
        artefacts: { title: string; visibility: string; publicSlug: string | null }[];
      };
      const byTitle = Object.fromEntries(artefacts.map((a) => [a.title, a]));
      expect(byTitle.Second).toMatchObject({ visibility: "public", publicSlug: expect.any(String) });
      expect(byTitle.First).toMatchObject({ visibility: "private", publicSlug: null });
    });

    // r[verify hosting.listing.own-only]
    it("orders the stored listing by the last change, not by creation", async () => {
      const { db } = await import("../infra/db/client");
      const { DrizzleArtefactRepository } = await import(
        "../infra/db/artefact-repository.drizzle"
      );
      const { createArtefact, editArtefact } = await import("../domain/artefact/artefact");
      const repo = new DrizzleArtefactRepository(db);
      const at = (day: number) => new Date(Date.UTC(2099, 0, day));
      const make = (id: string, day: number) =>
        createArtefact({
          id,
          ownerId: listerId,
          title: id,
          kind: "other",
          payload: { ref: `ref-${id}`, bytes: 10, hash: "h" },
          now: at(day),
        });
      await repo.save(make("order-old", 1));
      await repo.save(make("order-new", 2));
      const old = (await repo.findById("order-old", SINGLETON_SCOPE))!;
      await repo.save(editArtefact(old, { title: "order-old edited", now: at(3) }));

      const listed = await repo.listByOwner(listerId, SINGLETON_SCOPE);
      expect(listed.slice(0, 2).map((a) => a.id)).toEqual(["order-old", "order-new"]);
    });
  });

  // S5 — share / unshare via PUT /api/artefacts/:id/visibility.
  describe("share / unshare (S5)", () => {
    let id: string;

    function setVisibility(visibility: string, cookieValue: string | null = cookie) {
      return app.request(`/api/artefacts/${id}/visibility`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(cookieValue ? { cookie: cookieValue } : {}),
        },
        body: JSON.stringify({ visibility }),
      });
    }

    beforeAll(async () => {
      const res = await postArtefact({ title: "Sharable", kind: "prototype" });
      id = ((await res.json()) as ArtefactSummary).id;
    });

    // r[verify hosting.slug.shared-has-slug]
    // r[verify hosting.share.sets-tier]
    it("mints a slug and raises visibility on first share", async () => {
      const res = await setVisibility("public");
      expect(res.status).toBe(200);
      const a = (await res.json()) as ArtefactSummary;
      expect(a.visibility).toBe("public");
      expect(a.publicSlug).not.toBeNull();
    });

    // r[verify hosting.slug.minted-once-retained]
    it("retains the slug across unshare and reuses it on re-share", async () => {
      const shared = (await (await setVisibility("public")).json()) as ArtefactSummary;
      const slug = shared.publicSlug;

      const unshared = (await (await setVisibility("private")).json()) as ArtefactSummary;
      expect(unshared.visibility).toBe("private");
      expect(unshared.publicSlug).toBe(slug); // retained

      const reshared = (await (
        await setVisibility("authenticated")
      ).json()) as ArtefactSummary;
      expect(reshared.visibility).toBe("authenticated");
      expect(reshared.publicSlug).toBe(slug); // reused
    });

    it("rejects an invalid visibility with 400", async () => {
      expect((await setVisibility("everyone")).status).toBe(400);
    });

    it("rejects an unauthenticated request with 401", async () => {
      expect((await setVisibility("public", null)).status).toBe(401);
    });

    // r[verify hosting.access.no-existence-leak]
    // r[verify hosting.authority.owner-only]
    it("hides existence from a non-owner with 404", async () => {
      const other = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "intruder@example.com",
          password: "correct-horse-battery",
          name: "Intruder",
        }),
      });
      const otherCookie = other.headers.get("set-cookie")!.split(";")[0]!;
      expect((await setVisibility("public", otherCookie)).status).toBe(404);
    });
  });

  // S4 — owner views own artefact by id (any visibility; archived hidden).
  describe("owner view (S4)", () => {
    let id: string;

    beforeAll(async () => {
      const res = await postArtefact({
        title: "Viewable",
        kind: "prototype",
        html: "<h1>mine</h1>",
      });
      id = ((await res.json()) as ArtefactSummary).id;
    });

    // r[verify hosting.owner-view.any-visibility+2]
    it("returns the owner's own (private) artefact detail", async () => {
      const res = await app.request(`/api/artefacts/${id}`, {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id, visibility: "private" });
    });

    // r[verify hosting.owner-view.any-visibility+2]
    it("serves the owner's artefact content as HTML at any visibility", async () => {
      // S12 — `/raw` is now the host shell (toolbar + iframe); the artefact
      // content + runtime live in `/raw/frame`.
      const shell = await app.request(`/api/artefacts/${id}/raw`, {
        headers: { cookie },
      });
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      const shellBody = await shell.text();
      expect(shellBody).toContain("<iframe");
      expect(shellBody).toContain(`/api/artefacts/${id}/raw/frame`);
      expect(shellBody).not.toContain("<h1>mine</h1>");

      // S36 — the frame opens on a token the shell minted, never the cookie.
      const frame = await openFrame(app, id, cookie);
      expect(frame.status).toBe(200);
      // The frame carries the artefact content plus the injected runtime.
      expect(await frame.text()).toContain("<h1>mine</h1>");
    });

    // r[verify hosting.access.no-existence-leak]
    it("hides the artefact from a non-owner with 404", async () => {
      const other = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "viewer-intruder@example.com",
          password: "correct-horse-battery",
          name: "VI",
        }),
      });
      const otherCookie = other.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        (await app.request(`/api/artefacts/${id}`, { headers: { cookie: otherCookie } }))
          .status,
      ).toBe(404);
      expect(
        (await app.request(`/api/artefacts/${id}/raw`, { headers: { cookie: otherCookie } }))
          .status,
      ).toBe(404);
    });

    it("rejects an unauthenticated request with 401", async () => {
      expect((await app.request(`/api/artefacts/${id}`)).status).toBe(401);
      expect((await app.request(`/api/artefacts/${id}/raw`)).status).toBe(401);
    });

    // r[verify hosting.lifecycle.archived-not-served]
    it("returns 404 for an archived artefact, even to its owner", async () => {
      const created = (await (
        await postArtefact({ title: "To archive", kind: "form" })
      ).json()) as ArtefactSummary;
      const { db } = await import("../infra/db/client");
      const { DrizzleArtefactRepository } = await import(
        "../infra/db/artefact-repository.drizzle"
      );
      const repo = new DrizzleArtefactRepository(db);
      const stored = (await repo.findById(created.id, SINGLETON_SCOPE))!;
      await repo.save({ ...stored, status: "archived", archivedAt: new Date() });

      expect(
        (await app.request(`/api/artefacts/${created.id}`, { headers: { cookie } }))
          .status,
      ).toBe(404);
      expect(
        (await app.request(`/api/artefacts/${created.id}/raw`, { headers: { cookie } }))
          .status,
      ).toBe(404);
    });
  });
});
