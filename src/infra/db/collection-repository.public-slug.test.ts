import { beforeAll, describe, expect, it } from "vitest";
import { createCollection, type Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S44 — a root's `publicSlug` round-trips through both CollectionRepository
// adapters, and `findBySlug` is tenant-global (like the artefact one,
// hosting.slug.globally-unique).

const OWNER = "cps-owner";

function root(id: string, publicSlug: string | null, tenantId?: string): Collection {
  return {
    ...createCollection({ id, ownerId: OWNER, name: id, visibility: "public", tenantId }),
    publicSlug,
  };
}

async function drizzleRepo(): Promise<CollectionRepository> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "CPS", email: "cps-owner@example.com" })
    .onConflictDoNothing();
  const { DrizzleCollectionRepository } = await import("./collection-repository.drizzle");
  return new DrizzleCollectionRepository(db);
}

const adapters: [string, () => Promise<CollectionRepository>][] = [
  ["in-memory", async () => new InMemoryCollectionRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("CollectionRepository publicSlug — %s (S44)", (name, make) => {
  let repo: CollectionRepository;
  const id = (s: string) => `${name}-cps-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  it("round-trips a slug, and null", async () => {
    await repo.save(root(id("slugged"), id("slug")));
    await repo.save(root(id("bare"), null));
    expect((await repo.findById(id("slugged"), SINGLETON_SCOPE))!.publicSlug).toBe(id("slug"));
    expect((await repo.findById(id("bare"), SINGLETON_SCOPE))!.publicSlug).toBeNull();
  });

  it("findBySlug finds a root in another tenant, and null for an unknown slug", async () => {
    await repo.save(root(id("elsewhere"), id("far"), "other-tenant"));
    const found = await repo.findBySlug(id("far"));
    expect(found?.id).toBe(id("elsewhere"));
    expect(found?.tenantId).toBe("other-tenant");
    expect(await repo.findBySlug(id("nope"))).toBeNull();
  });
});

describe("collection.public_slug unique index — drizzle (S44)", () => {
  it("rejects a duplicate slug", async () => {
    const repo = await drizzleRepo();
    await repo.save(root("dup-a", "dup-slug"));
    await expect(repo.save(root("dup-b", "dup-slug"))).rejects.toThrow();
  });
});
