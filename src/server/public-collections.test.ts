import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  CollectionListResponse,
  CollectionSummary,
  PublicCollectionResponse,
  SharedCollectionsResponse,
} from "../shared/contracts";

// End-to-end S44 — Public collection links and anonymous thumbnails, the
// collection side: a root's slug on the owner's summaries and the anonymous
// `GET /api/public/collections/:slug` through the real app against a
// throwaway db.

const PASSWORD = "correct-horse-battery";
const HOUR = 60 * 60 * 1000;

let app: Hono;
let owner: string;
let other: string;
let otherId: string;

async function signUp(email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name: email }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function get(path: string, cookie?: string) {
  return app.request(path, { headers: cookie ? { cookie } : {} });
}

function json(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createCollection(body: { name: string; parentId?: string; visibility?: string }) {
  const res = await json("POST", "/api/collections", owner, body);
  expect(res.status).toBe(201);
  return (await res.json()) as CollectionSummary;
}

async function patch(id: string, body: unknown): Promise<CollectionSummary> {
  const res = await json("PATCH", `/api/collections/${id}`, owner, body);
  expect(res.status).toBe(200);
  return (await res.json()) as CollectionSummary;
}

async function artefactIn(collectionId: string, title: string): Promise<ArtefactSummary> {
  const form = new FormData();
  form.set("title", title);
  form.set("kind", "prototype");
  form.set("payload", new File(["<h1>tree</h1>"], "a.html"));
  const created = (await (
    await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } })
  ).json()) as ArtefactSummary;
  const moved = await json("PUT", `/api/artefacts/${created.id}/collection`, owner, { collectionId });
  expect(moved.status).toBe(200);
  return (await moved.json()) as ArtefactSummary;
}

function readPublic(slug: string) {
  return get(`/api/public/collections/${slug}`);
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../infra/db/client");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp("pc-owner@example.com");
  other = await signUp("pc-other@example.com");
  otherId = ((await (await get("/api/me", other)).json()) as { id: string }).id;
});

describe("owner summaries — publicSlug (S44)", () => {
  // r[verify collections.public-link.owner-summary-slug]
  it("carries the slug on a shared root, null on a private root and on a non-root", async () => {
    const root = await createCollection({ name: "Shared root", visibility: "authenticated" });
    expect(root.publicSlug).toEqual(expect.any(String));
    const child = await createCollection({ name: "Child", parentId: root.id });
    expect(child.publicSlug).toBeNull();
    const quiet = await createCollection({ name: "Quiet" });
    expect(quiet.publicSlug).toBeNull();

    const list = (await (await get("/api/collections", owner)).json()) as CollectionListResponse;
    const byId = new Map(list.collections.map((c) => [c.id, c]));
    expect(byId.get(root.id)!.publicSlug).toBe(root.publicSlug);
    expect(byId.get(child.id)!.publicSlug).toBeNull();
    expect(byId.get(quiet.id)!.publicSlug).toBeNull();
  });

  // r[verify collections.public-link.owner-summary-slug]
  it("is kept when the root goes private, and returned by the PATCH", async () => {
    const root = await createCollection({ name: "Toggle" });
    const shared = await patch(root.id, { visibility: "public" });
    expect(shared.publicSlug).toEqual(expect.any(String));
    expect((await patch(root.id, { visibility: "private" })).publicSlug).toBe(shared.publicSlug);
  });

  // r[verify collections.public-link.owner-summary-slug]
  it("never rides on a tree shared with the caller", async () => {
    const root = await createCollection({ name: "For others", visibility: "authenticated" });
    const shared = (await (await get("/api/shared/collections", other)).json()) as SharedCollectionsResponse;
    const mine = shared.collections.find((c) => c.id === root.id)!;
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("publicSlug");
    expect(otherId).not.toBe(mine.ownerId);
  });
});

describe("GET /api/public/collections/:slug (S44)", () => {
  // r[verify collections.public-link.anonymous-tree-read]
  // r[verify collections.public-link.anonymous-projection+2]
  // r[verify collections.url.public-tree-read+2]
  it("serves a public, active, ungated root's tree with no session, publicly cacheable", async () => {
    const root = await createCollection({ name: "Landing page", visibility: "public" });
    const howTos = await createCollection({ name: "How-tos", parentId: root.id });
    const a = await artefactIn(howTos.id, "Getting started");

    const res = await readPublic(root.publicSlug!);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const tree = (await res.json()) as PublicCollectionResponse;
    expect(tree).toEqual({
      name: "Landing page",
      description: null,
      artefacts: [],
      children: [
        {
          name: "How-tos",
          description: null,
          children: [],
          artefacts: [
            {
              title: "Getting started",
              kind: "prototype",
              slug: a.publicSlug,
              updatedAt: a.updatedAt,
              thumbnailUrl: null,
            },
          ],
        },
      ],
    });
  });

  // r[verify collections.public-link.anonymous-tree-read]
  // r[verify collections.url.public-tree-read+2]
  it("answers every failure with the same flat 404", async () => {
    const unknown = await readPublic("no-such-slug");
    expect(unknown.status).toBe(404);
    const body = await unknown.text();

    const misses: string[] = [];
    for (const tier of ["selected", "authenticated"] as const) {
      misses.push((await createCollection({ name: `T-${tier}`, visibility: tier })).publicSlug!);
    }
    const wentPrivate = await createCollection({ name: "Went private", visibility: "public" });
    await patch(wentPrivate.id, { visibility: "private" });
    misses.push(wentPrivate.publicSlug!);
    const archived = await createCollection({ name: "Archived", visibility: "public" });
    expect((await json("POST", `/api/collections/${archived.id}/archive`, owner)).status).toBe(200);
    misses.push(archived.publicSlug!);
    const withPassword = await createCollection({ name: "Password", visibility: "public" });
    await patch(withPassword.id, { visibility: "public", linkGate: { password: PASSWORD } });
    misses.push(withPassword.publicSlug!);
    const withExpiry = await createCollection({ name: "Expiry", visibility: "public" });
    expect(
      (
        await json("PUT", `/api/collections/${withExpiry.id}/link-gate`, owner, {
          expiresAt: new Date(Date.now() + HOUR).toISOString(),
        })
      ).status,
    ).toBe(200);
    misses.push(withExpiry.publicSlug!);

    for (const slug of misses) {
      const res = await readPublic(slug);
      expect(res.status, slug).toBe(404);
      expect(await res.text(), slug).toBe(body);
    }
  });

  it("never needs, nor changes with, a session", async () => {
    const root = await createCollection({ name: "Same for all", visibility: "public" });
    const anonymous = await (await readPublic(root.publicSlug!)).json();
    const signedIn = await (await get(`/api/public/collections/${root.publicSlug}`, other)).json();
    expect(signedIn).toEqual(anonymous);
  });
});

describe("cross-origin read of /api/public/collections/:slug (S73)", () => {
  const SITE = "https://artefactor.cloud";

  function fromSite(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
    return app.request(path, { method: init.method, headers: { Origin: SITE, ...init.headers } });
  }

  // r[verify collections.public-link.cross-origin-read]
  it("answers any origin with `*` and never allows credentials", async () => {
    const root = await createCollection({ name: "Cross-origin", visibility: "public" });
    const res = await fromSite(`/api/public/collections/${root.publicSlug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  // r[verify collections.public-link.cross-origin-read]
  it("answers a HEAD with `*` too", async () => {
    const root = await createCollection({ name: "Cross-origin head", visibility: "public" });
    const res = await fromSite(`/api/public/collections/${root.publicSlug}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  // r[verify collections.public-link.cross-origin-read]
  it("carries the header on the flat 404 too", async () => {
    const res = await fromSite("/api/public/collections/no-such-slug");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // r[verify collections.url.public-tree-read+2]
  // r[verify collections.public-link.cross-origin-read]
  it("answers a path that names no single slug with the same JSON 404, never the SPA", async () => {
    const root = await createCollection({ name: "Malformed paths", visibility: "public" });
    for (const p of [
      `/api/public/collections/${root.publicSlug}/`,
      "/api/public/collections/",
      "/api/public/collections",
      `/api/public/collections/${root.publicSlug}/extra`,
    ]) {
      const res = await fromSite(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("content-type"), p).toMatch(/^application\/json/);
      expect(await res.json(), p).toEqual({ error: "not found" });
      expect(res.headers.get("access-control-allow-origin"), p).toBe("*");
    }
  });

  // r[verify collections.public-link.cross-origin-read]
  it("answers the preflight with 204 and the read methods", async () => {
    const res = await fromSite("/api/public/collections/any-slug", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const methods = (res.headers.get("access-control-allow-methods") ?? "").split(",");
    expect(methods.map((m) => m.trim())).toEqual(expect.arrayContaining(["GET", "HEAD", "OPTIONS"]));
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  // r[verify collections.public-link.cross-origin-read]
  it("carries the header on an error from the session step, which runs after it", async () => {
    const { createApp } = await import("./app");
    const { defaultAdapters } = await import("./adapters");
    const { auth } = await import("./auth");
    const failing = {
      ...auth,
      api: {
        ...auth.api,
        getSession: () => {
          throw new Error("session store down");
        },
      },
    } as unknown as typeof auth;
    const res = await createApp(defaultAdapters, failing).request("/api/public/collections/any-slug", {
      headers: { Origin: SITE },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // r[verify collections.public-link.cross-origin-read]
  it("adds no CORS to any other route", async () => {
    const res = await fromSite("/api/artefacts", { headers: { cookie: owner } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  // r[verify collections.public-link.cross-origin-read]
  it("serves a cookie-bearing cross-origin read the same anonymous projection", async () => {
    const root = await createCollection({ name: "Cookie or not", visibility: "public" });
    await artefactIn(root.id, "Shown");
    const path = `/api/public/collections/${root.publicSlug}`;
    const anonymous = await (await fromSite(path)).json();
    const withCookie = await fromSite(path, { headers: { cookie: owner } });
    expect(withCookie.headers.get("access-control-allow-origin")).toBe("*");
    const body = await withCookie.json();
    expect(body).toEqual(anonymous);
    expect(JSON.stringify(body)).not.toMatch(/ownerId|"id"|publicSlug|visibility/);
  });
});
