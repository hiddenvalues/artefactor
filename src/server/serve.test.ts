import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { SINGLETON_SCOPE } from "../domain/artefact/tenant-scope";
import type { ArtefactSummary } from "../shared/contracts";
import { openFrame } from "../test/frame";

// End-to-end S6: serve an artefact by slug, enforcing the access matrix. Drives
// the real app against a throwaway db + filesystem payload store: create →
// share → GET /a/:slug as various viewers.
describe("serve artefact by slug (S6)", () => {
  let app: Hono;
  let ownerCookie: string;
  let otherCookie: string;

  const HTML = "<!doctype html><h1>served</h1>";

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  // Create an artefact as the owner and set its visibility; return its summary.
  async function makeArtefact(visibility: string): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", `${visibility} artefact`);
    form.set("kind", "prototype");
    form.set("payload", new File([HTML], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: ownerCookie },
      })
    ).json()) as ArtefactSummary;

    if (visibility === "private") return created;
    const shared = await app.request(`/api/artefacts/${created.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ visibility }),
    });
    return (await shared.json()) as ArtefactSummary;
  }

  function get(slug: string, cookie?: string) {
    return app.request(`/a/${slug}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  // The artefact itself lives inside the iframe at `/a/:slug/frame`; `author`
  // selects the data context (S12), named by the frame token the shell mints
  // (S36).
  function frame(slug: string, opts: { cookie?: string; author?: string } = {}) {
    return openFrame(app, slug, opts.cookie, opts.author);
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    ownerCookie = await signUp("owner-s6@example.com");
    otherCookie = await signUp("other-s6@example.com");
  });

  it("serves the host shell (with the data-context switcher) to anyone for a public artefact", async () => {
    const a = await makeArtefact("public");
    const res = await get(a.publicSlug!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    // The shell is host chrome around an iframe pointing at the frame route; the
    // artefact payload itself is NOT in the shell (it lives in the iframe).
    expect(body).toContain("<iframe");
    expect(body).toContain(`/a/${a.publicSlug}/frame`);
    expect(body).toContain(`/api/artefacts/${a.publicSlug}/data/authors`);
    expect(body).not.toContain(HTML);
  });

  it("flags usesStorage in the shell config so the picker is suppressed for non-persisting artefacts (S20)", async () => {
    // The default fixture HTML has no localStorage → flagged false.
    const stat = await makeArtefact("public");
    expect(await (await get(stat.publicSlug!)).text()).toContain('"usesStorage":false');

    // An artefact whose HTML uses localStorage → flagged true (picker can appear).
    const form = new FormData();
    form.set("title", "persisting form");
    form.set("kind", "form");
    form.set(
      "payload",
      new File(["<script>localStorage.setItem('k','v')</script>"], "p.html"),
    );
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: ownerCookie },
      })
    ).json()) as ArtefactSummary;
    const shared = (await (
      await app.request(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ visibility: "public" }),
      })
    ).json()) as ArtefactSummary;
    expect(await (await get(shared.publicSlug!)).text()).toContain('"usesStorage":true');
  });

  it("shows the artefact's icon, title and kind in the shell toolbar (as in the list view)", async () => {
    const a = await makeArtefact("public");
    const body = await (await get(a.publicSlug!)).text();
    expect(body).toContain(`<div class="ae-title">${a.title}</div>`);
    // The kind label (here "Prototype") mirrors the SPA list view.
    expect(body).toContain("Prototype");
    // The kind icon tile is present (rendered from shared kind-presentation).
    expect(body).toContain('class="ae-tile"');
  });

  it("hides the back-to-admin button from anonymous viewers, shows it for signed-in viewers", async () => {
    const a = await makeArtefact("public");
    // Anonymous (public-link) viewers have no admin UI — no back button.
    // (The `.ae-back` CSS rule is always present, so match the element itself.)
    const anon = await (await get(a.publicSlug!)).text();
    expect(anon).not.toContain('class="ae-back"');
    // A signed-in viewer can return to the admin UI at "/".
    const signedIn = await (await get(a.publicSlug!, otherCookie)).text();
    expect(signedIn).toContain('class="ae-back"');
    expect(signedIn).toContain('href="/"');
  });

  it("renders host tools (data-context switcher) only for signed-in viewers, never anonymous", async () => {
    const a = await makeArtefact("public");
    // The host-tools wrapper (and the picker inside it) are omitted entirely for
    // anonymous viewers — they only ever see the artefact + title bar.
    const anon = await (await get(a.publicSlug!)).text();
    expect(anon).not.toContain('class="ae-tools"');
    expect(anon).not.toContain('id="ae-switch"');
    // A signed-in viewer gets the host-tools wrapper (future widgets live here too).
    const signedIn = await (await get(a.publicSlug!, otherCookie)).text();
    expect(signedIn).toContain('class="ae-tools"');
    expect(signedIn).toContain('id="ae-switch"');
  });

  it("serves the artefact payload + bootstrap in the frame (read-only for the anonymous)", async () => {
    const a = await makeArtefact("public");
    const body = await (await frame(a.publicSlug!)).text();
    // Trusted payload, plus the S13 localStorage bootstrap (read-only for the
    // anonymous viewer — seeded empty, no write-through).
    expect(body).toContain(HTML);
    expect(body).toContain("localStorage");
    expect(body).toContain('"writable":false');
  });

  it("seeds the signed-in owner's own data context (read-write) into the frame", async () => {
    const a = await makeArtefact("public");
    // Owner persists some data, then re-fetches the served frame.
    await app.request(`/api/artefacts/${a.publicSlug}/data/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: '{"theme":"dark"}',
    });
    const body = await (await frame(a.publicSlug!, { cookie: ownerCookie })).text();
    expect(body).toContain('"writable":true');
    // The seed blob is inlined so first reads are synchronous.
    expect(body).toContain("theme");
    expect(body).toContain("dark");
  });

  it("seeds another author's data read-only via an author frame token (S12, AD5, S36)", async () => {
    // Authenticated artefact: owner writes data; a different signed-in viewer
    // loads the owner's context through the switcher — under `shared` data
    // visibility, since new artefacts default to own-only (S41).
    const a = await makeArtefact("authenticated");
    await app.request(`/api/artefacts/${a.id}/data-visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ dataVisibility: "shared" }),
    });
    const ownerId = (
      (await (await app.request("/api/me", { headers: { cookie: ownerCookie } })).json()) as {
        id: string;
      }
    ).id;
    await app.request(`/api/artefacts/${a.publicSlug}/data/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: '{"theme":"owner-dark"}',
    });

    const body = await (
      await frame(a.publicSlug!, { cookie: otherCookie, author: ownerId })
    ).text();
    // Owner's blob is seeded, but the viewing context is read-only (AD5).
    expect(body).toContain("owner-dark");
    expect(body).toContain('"writable":false');
  });

  it("serves a 'Members' (authenticated) artefact to signed-in users; redirects the anonymous to sign in", async () => {
    const a = await makeArtefact("authenticated");
    expect((await get(a.publicSlug!, otherCookie)).status).toBe(200);
    // Anonymous (e.g. an org member who hasn't created their account yet) is
    // sent to sign in with a returnTo pointing back at this artefact — not 404.
    const anon = await get(a.publicSlug!);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe(
      `/?returnTo=${encodeURIComponent(`/a/${a.publicSlug}`)}`,
    );
  });

  it("serves a private artefact only to its owner (other signed-in → 404, anonymous → sign-in)", async () => {
    // Share to mint a slug, then unshare so it is private but addressable.
    const shared = await makeArtefact("public");
    await app.request(`/api/artefacts/${shared.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ visibility: "private" }),
    });
    const slug = shared.publicSlug!;
    expect((await get(slug, ownerCookie)).status).toBe(200);
    // A signed-in non-owner is denied with a flat 404 (no redirect loop, no leak).
    expect((await get(slug, otherCookie)).status).toBe(404);
    // Anonymous is redirected to sign in (uniform with an unknown slug, so the
    // existence of a private artefact is never revealed — AH8).
    expect((await get(slug)).status).toBe(302);
  });

  it("redirects an anonymous unknown slug to sign in, but 404s an authenticated one (no existence leak)", async () => {
    // Uniform anonymous redirect: an attacker can't tell a missing slug from a
    // real-but-gated one. A signed-in user gets the honest 404.
    expect((await get("does-not-exist")).status).toBe(302);
    expect((await get("does-not-exist", otherCookie)).status).toBe(404);
  });

  it("returns 404 for an archived artefact to its owner; anonymous still bounced to sign-in (AH7)", async () => {
    const a = await makeArtefact("public");
    const slug = a.publicSlug!;
    // Archive directly via the repo (archive endpoint is S7).
    const { db } = await import("../infra/db/client");
    const { DrizzleArtefactRepository } = await import(
      "../infra/db/artefact-repository.drizzle"
    );
    const repo = new DrizzleArtefactRepository(db);
    const stored = (await repo.findById(a.id, SINGLETON_SCOPE))!;
    await repo.save({ ...stored, status: "archived", archivedAt: new Date() });

    // The owner is authenticated → honest 404 (archived is inert, even to them).
    expect((await get(slug, ownerCookie)).status).toBe(404);
    // Anonymous → sign-in redirect, indistinguishable from any other miss.
    expect((await get(slug)).status).toBe(302);
  });
});
