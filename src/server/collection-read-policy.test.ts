import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AccessPolicy } from "../domain/artefact/access";
import type {
  ArtefactSummary,
  BookmarksResponse,
  CollectionSummary,
  MyViewsResponse,
  SharedCollectionsResponse,
  SharedListResponse,
} from "../shared/contracts";

// End-to-end collections.read.follows-root+2 — every signed-in collection read asks the one read
// decision: the matrix under the access policy, then the root's link gate with the request's pass.
// `cloudApp` injects a policy refusing `outsider` the `authenticated` tier (a viewer outside the
// tenant in a multi-tenant superset); `app` runs the OSS default.

const HTML = "<!doctype html><h1>read policy</h1>";
const PASSWORD = "correct-horse-battery";

let app: Hono;
let cloudApp: Hono;
let countingApp: Hono;
// Every (viewer, tenant) question `countingApp`'s policy is asked.
const asked: string[] = [];
let owner: string;
let outsider: string;
let outsiderId: string;

async function signUp(email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function get(target: Hono, path: string, cookie: string) {
  return target.request(path, { headers: { cookie } });
}

function json(target: Hono, method: string, path: string, cookie: string, body?: unknown) {
  return target.request(path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createArtefact(cookie: string, title: string): Promise<ArtefactSummary> {
  const form = new FormData();
  form.set("title", title);
  form.set("kind", "slide-deck");
  form.set("payload", new File([HTML], "a.html"));
  const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
  return (await res.json()) as ArtefactSummary;
}

async function setVisibility(
  id: string,
  visibility: string,
  linkGate?: { password: string },
): Promise<ArtefactSummary> {
  const res = await json(app, "PUT", `/api/artefacts/${id}/visibility`, owner, {
    visibility,
    ...(linkGate ? { linkGate } : {}),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ArtefactSummary;
}

// A root of `visibility` (gated when `password`), holding one of the owner's artefacts.
async function tree(name: string, visibility: string, options: { password?: string; grant?: string } = {}) {
  const created = await json(app, "POST", "/api/collections", owner, { name });
  const root = (await created.json()) as CollectionSummary;
  const patched = await json(app, "PATCH", `/api/collections/${root.id}`, owner, {
    visibility,
    ...(options.password ? { linkGate: { password: options.password } } : {}),
  });
  expect(patched.status).toBe(200);
  if (options.grant) {
    const granted = await json(app, "POST", `/api/collections/${root.id}/access`, owner, {
      userId: options.grant,
    });
    expect(granted.status).toBe(204);
  }
  const a = await createArtefact(owner, `${name} artefact`);
  expect((await json(app, "PUT", `/api/artefacts/${a.id}/collection`, owner, { collectionId: root.id })).status).toBe(200);
  const inTree = (await (await get(app, `/api/artefacts/${a.id}`, owner)).json()) as ArtefactSummary;
  return { root, artefact: inTree };
}

async function passFor(slug: string): Promise<string> {
  const res = await cloudApp.request(`/a/${slug}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  expect(res.status).toBe(303);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function sharedTreeIds(cookie: string, target = cloudApp): Promise<string[]> {
  const res = await get(target, "/api/shared/collections", cookie);
  return ((await res.json()) as SharedCollectionsResponse).collections.map((c) => c.id);
}

async function sharedArtefactIds(cookie: string, target = cloudApp): Promise<string[]> {
  const res = await get(target, "/api/shared", cookie);
  return ((await res.json()) as SharedListResponse).artefacts.map((a) => a.id);
}

async function bookmarkedTreeIds(cookie: string): Promise<string[]> {
  const res = await get(cloudApp, "/api/bookmarks", cookie);
  return ((await res.json()) as BookmarksResponse).collections.map((c) => c.id);
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp("crp-owner@example.com");
  outsider = await signUp("crp-outsider@example.com");
  outsiderId = ((await (await get(app, "/api/me", outsider)).json()) as { id: string }).id;
  const refuseOutsider: AccessPolicy = { grantsAuthenticatedTier: (viewerId) => viewerId !== outsiderId };
  cloudApp = createApp(undefined, undefined, undefined, undefined, refuseOutsider);
  const counting: AccessPolicy = {
    grantsAuthenticatedTier: (viewerId, tenantId) => {
      asked.push(`${viewerId}@${tenantId}`);
      return viewerId !== outsiderId;
    },
  };
  countingApp = createApp(undefined, undefined, undefined, undefined, counting);
  // Migrations, the app import and two scrypt sign-ups run close to the default 10 s on a cold run.
}, 30_000);

describe("GET /api/shared/collections asks the read decision", () => {
  // r[verify collections.read.follows-root+2]
  it("hides a root the policy refuses, shows an ungated public one, and a gated one only with its pass", async () => {
    const authenticated = await tree("Auth tree", "authenticated");
    const open = await tree("Open tree", "public");
    const gated = await tree("Gated tree", "public", { password: PASSWORD });

    const before = await sharedTreeIds(outsider);
    expect(before).not.toContain(authenticated.root.id);
    expect(before).toContain(open.root.id);
    expect(before).not.toContain(gated.root.id);

    // The root's pass — minted at any artefact link of the tree — opens the tree.
    const pass = await passFor(gated.artefact.publicSlug!);
    expect(await sharedTreeIds(`${outsider}; ${pass}`)).toContain(gated.root.id);

    // The OSS default policy admits the outsider to every one of them.
    const oss = await sharedTreeIds(outsider, app);
    expect(oss).toEqual(expect.arrayContaining([authenticated.root.id, open.root.id, gated.root.id]));
  });
});

describe("GET /api/shared asks the read decision", () => {
  // r[verify hosting.shared.others-viewable+2]
  it("lists neither a refused tree's artefacts nor a refused top-level artefact; a gated one only with its pass", async () => {
    const refusedTree = await tree("Refused tree", "authenticated");
    const topAuth = await setVisibility((await createArtefact(owner, "Top auth")).id, "authenticated");
    const topGated = await setVisibility((await createArtefact(owner, "Top gated")).id, "public", {
      password: PASSWORD,
    });

    const listed = await sharedArtefactIds(outsider);
    expect(listed).not.toContain(refusedTree.artefact.id);
    expect(listed).not.toContain(topAuth.id);
    expect(listed).not.toContain(topGated.id);

    const pass = await passFor(topGated.publicSlug!);
    expect(await sharedArtefactIds(`${outsider}; ${pass}`)).toContain(topGated.id);

    // Under the OSS default every one of them is listed.
    expect(await sharedArtefactIds(outsider, app)).toEqual(
      expect.arrayContaining([refusedTree.artefact.id, topAuth.id, topGated.id]),
    );
  });
});

describe("collection bookmarks ask the read decision", () => {
  // r[verify collections.bookmark.collection-view-gated+2]
  it("refuses adding a refused root with the missing collection's 404", async () => {
    const refused = await tree("Unbookmarkable", "authenticated");
    const add = await json(cloudApp, "PUT", `/api/collections/${refused.root.id}/bookmark`, outsider);
    const missing = await json(cloudApp, "PUT", "/api/collections/no-such-collection/bookmark", outsider);
    expect(add.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await add.json()).toEqual(await missing.json());
  });

  // r[verify collections.bookmark.collection-view-gated+2]
  it("hides a bookmark whose root is later gated, and shows it again with the pass", async () => {
    const later = await tree("Later gated", "public");
    expect((await json(cloudApp, "PUT", `/api/collections/${later.root.id}/bookmark`, outsider)).status).toBe(204);
    expect(await bookmarkedTreeIds(outsider)).toContain(later.root.id);

    const gate = await json(app, "PUT", `/api/collections/${later.root.id}/link-gate`, owner, { password: PASSWORD });
    expect(gate.status).toBe(200);
    expect(await bookmarkedTreeIds(outsider)).not.toContain(later.root.id);

    // Hidden, not pruned: the row survives and the pin reappears with the root's pass.
    const pass = await passFor(later.artefact.publicSlug!);
    expect(await bookmarkedTreeIds(`${outsider}; ${pass}`)).toContain(later.root.id);
  });
});

describe("contribution asks the read decision", () => {
  // r[verify collections.contributor.on-root-access-list+2]
  it("refuses a listed contributor's move into a tree the decision refuses them, until they hold the pass", async () => {
    const gated = await tree("Contributed", "public", { password: PASSWORD, grant: outsiderId });
    const mine = await createArtefact(outsider, "Outsider's");

    const refused = await json(cloudApp, "PUT", `/api/artefacts/${mine.id}/collection`, outsider, {
      collectionId: gated.root.id,
    });
    expect(refused.status).toBe(404);
    expect(await sharedTreeIds(outsider)).not.toContain(gated.root.id);

    const pass = await passFor(gated.artefact.publicSlug!);
    const moved = await json(cloudApp, "PUT", `/api/artefacts/${mine.id}/collection`, `${outsider}; ${pass}`, {
      collectionId: gated.root.id,
    });
    expect(moved.status).toBe(200);
  });
});

describe("GET /api/views/mine follows Shared with you", () => {
  // r[verify views.mine.own-visible-only]
  it("keeps a view of a gated artefact the caller unlocked, while the request carries its pass", async () => {
    const gated = await setVisibility((await createArtefact(owner, "Viewed gated")).id, "public", {
      password: PASSWORD,
    });
    const pass = await passFor(gated.publicSlug!);
    const withPass = `${outsider}; ${pass}`;
    expect((await get(cloudApp, `/a/${gated.publicSlug!}`, withPass)).status).toBe(200);

    const mine = async (cookie: string) =>
      ((await (await get(cloudApp, "/api/views/mine", cookie)).json()) as MyViewsResponse).views.map(
        (v) => v.artefactId,
      );
    expect(await mine(withPass)).toContain(gated.id);
    expect(await mine(outsider)).not.toContain(gated.id);
  });
});

// A performance property of the listings, not a rule: every candidate of one scoped listing asks the
// same (viewer, tenant) question, so the policy — one membership query per call in a multi-tenant
// superset — is asked it at most once per request.
describe("a listing asks the policy once per (viewer, tenant)", () => {
  it("GET /api/shared, /api/shared/collections, /api/views/mine and /api/bookmarks each ask at most once", async () => {
    await tree("Counted tree", "authenticated");
    for (const title of ["Counted 1", "Counted 2", "Counted 3"]) {
      await setVisibility((await createArtefact(owner, title)).id, "authenticated");
    }

    // Two bookmarked gated trees, so the bookmark list decides more than one root.
    for (const name of ["Counted gated 1", "Counted gated 2"]) {
      const gated = await tree(name, "public", { password: PASSWORD });
      const pass = await passFor(gated.artefact.publicSlug!);
      const add = await json(cloudApp, "PUT", `/api/collections/${gated.root.id}/bookmark`, `${outsider}; ${pass}`);
      expect(add.status).toBe(204);
    }

    for (const path of ["/api/shared", "/api/shared/collections", "/api/views/mine", "/api/bookmarks"]) {
      asked.length = 0;
      expect((await get(countingApp, path, outsider)).status).toBe(200);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.length).toBe(new Set(asked).size);
    }
  });
});
