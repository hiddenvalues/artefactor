import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactListResponse,
  ArtefactSummary,
  CollectionListResponse,
  CollectionSummary,
} from "../shared/contracts";

// End-to-end: the collection create and the collection and artefact restore
// routes refuse what the domain refuses — a tier on a nested collection, a
// restore under an archived collection — through the real app against a
// throwaway db. The web app's restore refusal names, never ids.

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

async function artefactIn(collectionId: string, title: string): Promise<ArtefactSummary> {
  const form = new FormData();
  form.set("title", title);
  form.set("kind", "prototype");
  form.set("payload", new File(["<h1>tree</h1>"], "a.html"));
  const created = (await (
    await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } })
  ).json()) as ArtefactSummary;
  const moved = await json("PUT", `/api/artefacts/${created.id}/collection`, { collectionId });
  expect(moved.status).toBe(200);
  return (await moved.json()) as ArtefactSummary;
}

async function listNames(archived: boolean): Promise<string[]> {
  const res = await json("GET", `/api/collections${archived ? "?archived=true" : ""}`);
  return ((await res.json()) as CollectionListResponse).collections.map((c) => c.name);
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../infra/db/client");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp("clife-owner@example.com");
});

describe("collection create and restore over the BFF", () => {
  // r[verify collections.access.set-on-root-only+2]
  it("POST with a parentId and a visibility is 400 and creates nothing", async () => {
    const root = await create({ name: "Tier root" });
    const res = await json("POST", "/api/collections", {
      name: "Tiered child",
      parentId: root.id,
      visibility: "public",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /a nested collection takes its tree root's tier/,
    );
    expect(await listNames(false)).not.toContain("Tiered child");
  });

  // r[verify collections.lifecycle.restore-under-active-parent+2]
  it("POST /:id/restore under an archived ancestor is 400 naming it, no ids, and the collection stays archived", async () => {
    const root = await create({ name: "Archived root" });
    const child = await create({ name: "Archived child", parentId: root.id });
    const grand = await create({ name: "Archived grand", parentId: child.id });
    expect((await json("POST", `/api/collections/${root.id}/archive`)).status).toBe(200);

    const res = await json("POST", `/api/collections/${grand.id}/restore`);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe(
      "“Archived grand” is inside the archived collection “Archived root”: restore “Archived root” to bring it back.",
    );
    for (const id of [root.id, child.id, grand.id]) expect(error).not.toContain(id);
    expect(await listNames(true)).toEqual(
      expect.arrayContaining(["Archived root", "Archived child", "Archived grand"]),
    );
  });

  // r[verify collections.lifecycle.restore-under-active-parent+2]
  it("POST /api/artefacts/:id/restore inside an archived tree is 400 naming its root, no ids, and the artefact stays archived", async () => {
    const root = await create({ name: "Deck root" });
    const child = await create({ name: "Deck child", parentId: root.id });
    const artefact = await artefactIn(child.id, "Launch deck");
    expect((await json("POST", `/api/collections/${root.id}/archive`)).status).toBe(200);

    const res = await json("POST", `/api/artefacts/${artefact.id}/restore`);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe(
      "“Launch deck” is inside the archived collection “Deck root”: restore “Deck root” to bring it back.",
    );
    for (const id of [root.id, child.id, artefact.id]) expect(error).not.toContain(id);
    const archived = (await (
      await json("GET", "/api/artefacts?archived=true")
    ).json()) as ArtefactListResponse;
    expect(archived.artefacts.map((a) => a.id)).toContain(artefact.id);
  });
});
