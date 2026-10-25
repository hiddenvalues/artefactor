import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AccessPolicy } from "../domain/artefact/access";
import type {
  ArtefactSummary,
  CollectionListResponse,
  CollectionSummary,
  SharedCollectionsResponse,
} from "../shared/contracts";
import { mintFrameToken } from "../test/frame";

// End-to-end S32b — Link controls on public collections: password + expiry.
// A public root's gate governs every artefact in its tree, for the audience
// S32a gates (the anonymous in OSS; also a signed-in outsider under a policy
// refusing the `authenticated` tier). One unlock opens the whole tree.

const HTML = "<!doctype html><h1>in a tree</h1>";
const PASSWORD = "correct-horse-battery";
const HOUR = 60 * 60 * 1000;

type Sqlite = { prepare(sql: string): { run(...args: unknown[]): unknown } };

let sqlite: Sqlite;
let app: Hono;
let cloudApp: Hono;
let owner: string;
let other: string;
let otherId: string;
let cloudOutsider: string;

async function signUp(target: Hono, email: string): Promise<string> {
  const res = await target.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function get(target: Hono, path: string, cookie?: string) {
  return target.request(path, { headers: cookie ? { cookie } : {} });
}

function json(target: Hono, method: string, path: string, cookie: string, body?: unknown) {
  return target.request(path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createArtefact(cookie: string, title = "Deck"): Promise<ArtefactSummary> {
  const form = new FormData();
  form.set("title", title);
  form.set("kind", "slide-deck");
  form.set("payload", new File([HTML], "a.html"));
  const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
  return (await res.json()) as ArtefactSummary;
}

async function createCollection(body: { name: string; parentId?: string; visibility?: string }) {
  const res = await json(app, "POST", "/api/collections", owner, body);
  expect(res.status).toBe(201);
  return (await res.json()) as CollectionSummary;
}

async function move(cookie: string, artefactId: string, collectionId: string | null): Promise<ArtefactSummary> {
  const res = await json(app, "PUT", `/api/artefacts/${artefactId}/collection`, cookie, { collectionId });
  expect(res.status).toBe(200);
  return (await (await get(app, `/api/artefacts/${artefactId}`, cookie)).json()) as ArtefactSummary;
}

// A public root gated with `linkGate`, holding two of the owner's artefacts.
async function gatedTree(linkGate: { password?: string; expiresAt?: string } = { password: PASSWORD }) {
  const root = await createCollection({ name: "Tree" });
  const res = await json(app, "PATCH", `/api/collections/${root.id}`, owner, { visibility: "public", linkGate });
  expect(res.status).toBe(200);
  const a = await move(owner, (await createArtefact(owner, "A")).id, root.id);
  const b = await move(owner, (await createArtefact(owner, "B")).id, root.id);
  return { root: (await res.json()) as CollectionSummary, a, b };
}

function unlock(target: Hono, slug: string, password: string) {
  return target.request(`/a/${slug}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
  });
}

async function passFor(target: Hono, slug: string) {
  const res = await unlock(target, slug, PASSWORD);
  expect(res.status).toBe(303);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function frameSrc(html: string): string {
  const m = html.match(/"frameUrl":"([^"]+)"/);
  expect(m, "shell carries a frame URL").not.toBeNull();
  return m![1]!.replace(/\\u0026/g, "&");
}

const challenged = async (target: Hono, slug: string, cookie?: string) =>
  (await (await get(target, `/a/${slug}`, cookie)).text()).includes(`action="/a/${slug}/unlock"`);

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  sqlite = client.sqlite as unknown as Sqlite;
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp(app, "clg-owner@example.com");
  other = await signUp(app, "clg-other@example.com");
  otherId = ((await (await get(app, "/api/me", other)).json()) as { id: string }).id;
  cloudOutsider = await signUp(app, "clg-outsider@example.com");
  const outsiderId = ((await (await get(app, "/api/me", cloudOutsider)).json()) as { id: string }).id;
  const refuseOutsider: AccessPolicy = { grantsAuthenticatedTier: (viewerId) => viewerId !== outsiderId };
  cloudApp = createApp(undefined, undefined, undefined, undefined, refuseOutsider);
});

describe("BFF — a collection root's gate", () => {
  // r[verify collections.link-gate.public-root-only]
  it("PATCH sets a gate with the change to public, and rejects one with any other tier (400)", async () => {
    const root = await createCollection({ name: "Atomic" });
    const bad = await json(app, "PATCH", `/api/collections/${root.id}`, owner, {
      visibility: "selected",
      linkGate: { password: PASSWORD },
    });
    expect(bad.status).toBe(400);
    const res = await json(app, "PATCH", `/api/collections/${root.id}`, owner, {
      visibility: "public",
      linkGate: { password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as CollectionSummary;
    expect(summary.visibility).toBe("public");
    expect(summary.linkGate).toEqual({ passwordProtected: true, expiresAt: null });
  });

  // r[verify collections.link-gate.public-root-only]
  it("PUT/DELETE …/link-gate: nested or archived → 400, non-owner → 404, short password → 400", async () => {
    const { root } = await gatedTree();
    const nested = await createCollection({ name: "Nested", parentId: root.id });
    expect((await json(app, "PUT", `/api/collections/${nested.id}/link-gate`, owner, { password: PASSWORD })).status).toBe(400);
    expect((await json(app, "PUT", `/api/collections/${root.id}/link-gate`, other, { password: PASSWORD })).status).toBe(404);
    expect((await json(app, "DELETE", `/api/collections/${root.id}/link-gate`, other)).status).toBe(404);
    expect((await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, { password: "1234567" })).status).toBe(400);

    const expiresAt = new Date(Date.now() + 24 * HOUR).toISOString();
    const set = await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, { expiresAt });
    expect(((await set.json()) as CollectionSummary).linkGate).toEqual({ passwordProtected: true, expiresAt });
    const cleared = await json(app, "DELETE", `/api/collections/${root.id}/link-gate`, owner);
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as CollectionSummary).linkGate).toBeNull();

    await json(app, "POST", `/api/collections/${root.id}/archive`, owner);
    expect((await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, { password: PASSWORD })).status).toBe(400);
  });

  // r[verify collections.link-gate.cleared-leaving-public]
  it("leaving public clears the root's gate; public → public keeps it", async () => {
    const { root } = await gatedTree();
    const same = await json(app, "PATCH", `/api/collections/${root.id}`, owner, { visibility: "public" });
    expect(((await same.json()) as CollectionSummary).linkGate).toEqual({ passwordProtected: true, expiresAt: null });
    const away = await json(app, "PATCH", `/api/collections/${root.id}`, owner, { visibility: "selected" });
    expect(((await away.json()) as CollectionSummary).linkGate).toBeNull();
  });

  // r[verify collections.link-gate.owner-summary-only]
  it("only the owner's summaries carry linkGate, and no response carries the hash", async () => {
    const { root } = await gatedTree();
    await json(app, "POST", `/api/collections/${root.id}/access`, owner, { userId: otherId });
    const own = await (await get(app, "/api/collections", owner)).text();
    expect(own).not.toMatch(/passwordHash|scrypt/);
    const mine = (JSON.parse(own) as CollectionListResponse).collections.find((c) => c.id === root.id)!;
    expect(mine.linkGate).toEqual({ passwordProtected: true, expiresAt: null });

    const shared = (await (await get(app, "/api/shared/collections", other)).json()) as SharedCollectionsResponse;
    const seen = shared.collections.find((c) => c.id === root.id)!;
    expect(seen).toBeDefined();
    expect("linkGate" in seen).toBe(false);
    expect(JSON.stringify(shared)).not.toMatch(/passwordHash|scrypt/);
  });
});

describe("anonymous visitor on a password-gated public tree", () => {
  // r[verify collections.link-gate.root-governs-tree]
  it("is challenged on every artefact; one unlock opens a sibling's shell, frame and data", async () => {
    const { a, b } = await gatedTree();
    expect(await challenged(app, a.publicSlug!)).toBe(true);
    expect(await challenged(app, b.publicSlug!)).toBe(true);
    expect((await get(app, `/api/artefacts/${b.publicSlug}/data/authors`)).status).toBe(403);

    const pass = await passFor(app, a.publicSlug!);
    const shell = await get(app, `/a/${b.publicSlug}`, pass);
    const src = frameSrc(await shell.text());
    expect(src).toContain("?t=");
    const frame = await app.request(src);
    expect(frame.status).toBe(200);
    expect(await frame.text()).toContain("<h1>in a tree</h1>");
    expect((await get(app, `/api/artefacts/${b.publicSlug}/data/authors`, pass)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${b.id}/download`, pass)).status).toBe(200);
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("the tree owner is never challenged", async () => {
    const { a } = await gatedTree();
    expect(await challenged(app, a.publicSlug!, owner)).toBe(false);
    expect(await challenged(cloudApp, a.publicSlug!, owner)).toBe(false);
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("a contributor's artefact in the tree is gated by the root", async () => {
    const { root } = await gatedTree();
    await json(app, "POST", `/api/collections/${root.id}/access`, owner, { userId: otherId });
    const theirs = await move(other, (await createArtefact(other, "Contribution")).id, root.id);
    expect(theirs.publicSlug).toBeTruthy();
    expect(await challenged(app, theirs.publicSlug!)).toBe(true);
    const pass = await passFor(app, theirs.publicSlug!);
    expect(await challenged(app, theirs.publicSlug!, pass)).toBe(false);
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("an artefact's own retained gate is dormant in a tree and applies again after eviction", async () => {
    const top = await createArtefact(owner, "Own gate");
    await json(app, "PUT", `/api/artefacts/${top.id}/visibility`, owner, {
      visibility: "public",
      linkGate: { password: PASSWORD },
    });
    const ungated = await createCollection({ name: "Open tree", visibility: "public" });
    const contained = await move(owner, top.id, ungated.id);
    expect(await challenged(app, contained.publicSlug!)).toBe(false);
    await move(owner, top.id, null);
    expect(await challenged(app, contained.publicSlug!)).toBe(true);
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("changing the root's password voids every pass in the tree; an expiry-only change does not", async () => {
    const { root, a, b } = await gatedTree();
    const pass = await passFor(app, a.publicSlug!);
    await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, {
      expiresAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    });
    expect(await challenged(app, b.publicSlug!, pass)).toBe(false);
    await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, { password: "another-password" });
    expect(await challenged(app, a.publicSlug!, pass)).toBe(true);
    expect(await challenged(app, b.publicSlug!, pass)).toBe(true);
  });

  // r[verify collections.link-gate.root-governs-tree]
  // r[verify hosting.link-gate.unlock-limit-per-holder]
  it("the unlock rate limit counts per holder: the 11th attempt across siblings is refused (429)", async () => {
    const { a, b } = await gatedTree();
    for (let i = 0; i < 10; i++) {
      expect((await unlock(app, a.publicSlug!, "wrong-password")).status).toBe(401);
    }
    expect((await unlock(app, b.publicSlug!, PASSWORD)).status).toBe(429);
  });
});

describe("an anonymous thumbnail read in a gated tree (S44)", () => {
  // r[verify hosting.thumbnail.anonymous-by-slug]
  // r[verify hosting.thumbnail.cache-by-audience]
  it("gets the standard challenge, and with the root's pass the image, never cached", async () => {
    const { a } = await gatedTree();
    const { artefactRepository: repo, thumbnailStore } = await import("./adapters");
    const stored = (await repo.findById(a.id, { tenantId: "default" }))!;
    await thumbnailStore.put(a.id, stored.payloadHash, new Uint8Array([82, 73, 70, 70]));
    expect(await repo.recordThumbnail(a.id, stored.payloadHash)).toBe(true);

    const challenged = await get(app, `/api/artefacts/${a.publicSlug}/thumbnail`);
    expect(challenged.status).toBe(403);
    expect(await challenged.json()).toEqual({ gate: "password" });
    const pass = await passFor(app, a.publicSlug!);
    const opened = await get(app, `/api/artefacts/${a.publicSlug}/thumbnail`, pass);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("a signed-in outsider the policy refuses the authenticated tier", () => {
  // r[verify collections.link-gate.root-governs-tree]
  it("reads a contained artefact's thumbnail through the root's pass, never cached", async () => {
    const { a } = await gatedTree();
    const { artefactRepository: repo, thumbnailStore } = await import("./adapters");
    const stored = (await repo.findById(a.id, { tenantId: "default" }))!;
    await thumbnailStore.put(a.id, stored.payloadHash, new Uint8Array([82, 73, 70, 70]));
    expect(await repo.recordThumbnail(a.id, stored.payloadHash)).toBe(true);

    expect((await get(cloudApp, `/api/artefacts/${a.publicSlug}/thumbnail`, cloudOutsider)).status).toBe(403);
    const pass = await passFor(cloudApp, a.publicSlug!);
    const gated = await get(cloudApp, `/api/artefacts/${a.publicSlug}/thumbnail`, `${cloudOutsider}; ${pass}`);
    expect(gated.status).toBe(200);
    expect(gated.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("a gated root's expiry", () => {
  const expireNow = (rootId: string) =>
    sqlite.prepare("UPDATE collection SET link_expires_at = ? WHERE id = ?").run(Date.now() - 1000, rootId);

  // r[verify collections.link-gate.root-governs-tree]
  it("anonymous → sign-in and outsider → 404 for every artefact; extending restores the same URLs", async () => {
    const { root, a, b } = await gatedTree({ expiresAt: new Date(Date.now() + HOUR).toISOString() });
    expect((await get(app, `/a/${a.publicSlug}`)).status).toBe(200);
    expireNow(root.id);
    for (const slug of [a.publicSlug!, b.publicSlug!]) {
      const anon = await get(app, `/a/${slug}`);
      expect(anon.status).toBe(302);
      expect(anon.headers.get("location")).toBe(`/?returnTo=${encodeURIComponent(`/a/${slug}`)}`);
      expect((await get(cloudApp, `/a/${slug}`, cloudOutsider)).status).toBe(404);
      expect((await mintFrameToken(cloudApp, slug, cloudOutsider)).status).toBe(404);
    }
    expect((await get(app, `/a/${a.publicSlug}`, owner)).status).toBe(200);

    await json(app, "PUT", `/api/collections/${root.id}/link-gate`, owner, {
      expiresAt: new Date(Date.now() + HOUR).toISOString(),
    });
    expect((await get(app, `/a/${a.publicSlug}`)).status).toBe(200);
    expect((await get(app, `/a/${b.publicSlug}`)).status).toBe(200);
  });
});
