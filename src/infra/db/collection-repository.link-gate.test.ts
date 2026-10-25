import { beforeAll, describe, expect, it } from "vitest";
import { createCollection, type Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S32b — a root's `linkGate` round-trips through both CollectionRepository
// adapters, and a row written before the columns existed reads ungated.

const OWNER = "clg-owner";
const EXPIRES = new Date("2030-01-02T03:04:05.678Z");

function root(id: string, linkGate?: Collection["linkGate"]): Collection {
  const c = createCollection({ id, ownerId: OWNER, name: id, visibility: "public" });
  return linkGate ? { ...c, linkGate } : c;
}

async function migratedDb() {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, sqlite } = await import("./client");
  const { user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "CLG", email: "clg-owner@example.com" })
    .onConflictDoNothing();
  return { db, sqlite };
}

async function drizzleRepo(): Promise<CollectionRepository> {
  const { db } = await migratedDb();
  const { DrizzleCollectionRepository } = await import("./collection-repository.drizzle");
  return new DrizzleCollectionRepository(db);
}

const adapters: [string, () => Promise<CollectionRepository>][] = [
  ["in-memory", async () => new InMemoryCollectionRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("CollectionRepository linkGate — %s (S32b)", (name, make) => {
  let repo: CollectionRepository;
  const id = (s: string) => `${name}-clg-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  it("round-trips the empty gate of a new collection", async () => {
    await repo.save(root(id("none")));
    expect((await repo.findById(id("none"), SINGLETON_SCOPE))!.linkGate).toEqual({
      passwordHash: null,
      expiresAt: null,
      version: 0,
    });
  });

  it("round-trips a password hash, an expiry and a version, and a later clear", async () => {
    const gate = { passwordHash: "scrypt$abc$def", expiresAt: EXPIRES, version: 7 };
    await repo.save(root(id("set"), gate));
    expect((await repo.findById(id("set"), SINGLETON_SCOPE))!.linkGate).toEqual(gate);
    await repo.save(root(id("set"), { passwordHash: null, expiresAt: null, version: 8 }));
    expect((await repo.findById(id("set"), SINGLETON_SCOPE))!.linkGate).toEqual({
      passwordHash: null,
      expiresAt: null,
      version: 8,
    });
  });
});

describe("SQLite migration — collection link gate columns (S32b)", () => {
  // r[verify hosting.link-gate.migrated-roots-ungated]
  it("reads a row that predates the columns as ungated", async () => {
    const { sqlite, db } = await migratedDb();
    const { DrizzleCollectionRepository } = await import("./collection-repository.drizzle");
    sqlite
      .prepare(
        `INSERT INTO collection (id, owner_id, name, root_id, visibility, created_at, updated_at)
         VALUES ('legacy-clg', ?, 'Legacy', 'legacy-clg', 'public', 0, 0)`,
      )
      .run(OWNER);
    const found = await new DrizzleCollectionRepository(db).findById("legacy-clg", SINGLETON_SCOPE);
    expect(found!.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 0 });
  });
});
