import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { CollectionSummary, PublicCollectionResponse } from "../shared/contracts";

// End-to-end S74 — Collection description: `POST`/`PATCH /api/collections`
// take an optional description, the summary returns it, and the anonymous
// public tree carries it, through the real app against a throwaway db.

const PASSWORD = "correct-horse-battery";

let app: Hono;
let owner: string;

async function signUp(email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name: email }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function json(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", cookie: owner },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function create(body: Record<string, unknown>): Promise<CollectionSummary> {
  const res = await json("POST", "/api/collections", body);
  expect(res.status).toBe(201);
  return (await res.json()) as CollectionSummary;
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../infra/db/client");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp("cdesc-owner@example.com");
});

// r[verify collections.collection.description+2]
describe("collection description over the BFF (S74)", () => {
  it("POST takes a description and the summary carries it; none is null", async () => {
    const help = await create({ name: "Help", description: "  Guides for new users  " });
    expect(help.description).toBe("Guides for new users");
    expect((await create({ name: "Bare" })).description).toBeNull();
  });

  it("PATCH sets it, an absent key leaves it, null clears it", async () => {
    const c = await create({ name: "Topics", description: "First" });
    const set = await json("PATCH", `/api/collections/${c.id}`, { description: "Second" });
    expect(((await set.json()) as CollectionSummary).description).toBe("Second");
    const renamed = await json("PATCH", `/api/collections/${c.id}`, { name: "Topics 2" });
    expect(((await renamed.json()) as CollectionSummary).description).toBe("Second");
    const cleared = await json("PATCH", `/api/collections/${c.id}`, { description: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as CollectionSummary).description).toBeNull();
  });

  it("a non-string or an over-limit description is 400, naming the limit", async () => {
    const c = await create({ name: "Strict" });
    const notText = await json("PATCH", `/api/collections/${c.id}`, { description: 42 });
    expect(notText.status).toBe(400);
    expect(((await notText.json()) as { error: string }).error).toContain("280");
    const notTextCreate = await json("POST", "/api/collections", { name: "X", description: 42 });
    expect(notTextCreate.status).toBe(400);
    expect(((await notTextCreate.json()) as { error: string }).error).toContain("280");
    const long = await json("PATCH", `/api/collections/${c.id}`, { description: "a".repeat(281) });
    expect(long.status).toBe(400);
    expect(((await long.json()) as { error: string }).error).toContain("280");
    const longCreate = await json("POST", "/api/collections", { name: "Y", description: "a".repeat(281) });
    expect(longCreate.status).toBe(400);
  });

  // r[verify collections.public-link.anonymous-projection+2]
  it("the anonymous public tree carries each node's description", async () => {
    const root = await create({ name: "Landing", visibility: "public", description: "The site" });
    await create({ name: "Help", parentId: root.id, description: "Answers" });
    const res = await app.request(`/api/public/collections/${root.publicSlug}`);
    expect(res.status).toBe(200);
    const tree = (await res.json()) as PublicCollectionResponse;
    expect(tree.description).toBe("The site");
    expect(tree.children[0]!.description).toBe("Answers");
  });
});
