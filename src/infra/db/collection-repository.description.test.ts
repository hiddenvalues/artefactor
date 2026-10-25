import { beforeAll, describe, expect, it } from "vitest";
import { createCollection, type Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S74 — a collection's `description` round-trips through both
// CollectionRepository adapters, a value, null and the 280-character limit alike.

const OWNER = "cdesc-owner";

function described(id: string, description: string | null): Collection {
  return createCollection({ id, ownerId: OWNER, name: id, description });
}

async function drizzleRepo(): Promise<CollectionRepository> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "CDesc", email: "cdesc-owner@example.com" })
    .onConflictDoNothing();
  const { DrizzleCollectionRepository } = await import("./collection-repository.drizzle");
  return new DrizzleCollectionRepository(db);
}

const adapters: [string, () => Promise<CollectionRepository>][] = [
  ["in-memory", async () => new InMemoryCollectionRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("CollectionRepository description — %s (S74)", (name, make) => {
  let repo: CollectionRepository;
  const id = (s: string) => `${name}-cdesc-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  // r[verify collections.collection.description+2]
  it("round-trips a description, null and 280 characters", async () => {
    const long = "x".repeat(280);
    await repo.save(described(id("some"), "Guides for new users"));
    await repo.save(described(id("none"), null));
    await repo.save(described(id("long"), long));
    const read = async (s: string) => (await repo.findById(id(s), SINGLETON_SCOPE))!.description;
    expect(await read("some")).toBe("Guides for new users");
    expect(await read("none")).toBeNull();
    expect(await read("long")).toBe(long);
  });
});
