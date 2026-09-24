import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S32a (AH31) — `linkGate` round-trips through both ArtefactRepository adapters,
// and a row written before the columns existed reads null / null / 0.

const OWNER = "lg-owner";
const EXPIRES = new Date("2030-01-02T03:04:05.678Z");

function artefact(id: string, linkGate?: Artefact["linkGate"]): Artefact {
  const a = createArtefact({
    id,
    ownerId: OWNER,
    title: id,
    kind: "prototype",
    payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
  });
  return linkGate
    ? { ...a, visibility: "public", publicSlug: `slug-${id}`, linkGate }
    : a;
}

async function migratedDb() {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, sqlite } = await import("./client");
  const { user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "LG", email: "lg-owner@example.com" })
    .onConflictDoNothing();
  return { db, sqlite };
}

async function drizzleRepo(): Promise<ArtefactRepository> {
  const { db } = await migratedDb();
  const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
  return new DrizzleArtefactRepository(db);
}

const adapters: [string, () => Promise<ArtefactRepository>][] = [
  ["in-memory", async () => new InMemoryArtefactRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("ArtefactRepository linkGate — %s (S32a)", (name, make) => {
  let repo: ArtefactRepository;
  const id = (s: string) => `${name}-lg-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  it("round-trips the empty gate of a new artefact", async () => {
    await repo.save(artefact(id("none")));
    expect((await repo.findById(id("none"), SINGLETON_SCOPE))!.linkGate).toEqual({
      passwordHash: null,
      expiresAt: null,
      version: 0,
    });
  });

  it("round-trips a password hash, an expiry and a version, by id and by slug", async () => {
    const gate = { passwordHash: "scrypt$abc$def", expiresAt: EXPIRES, version: 7 };
    await repo.save(artefact(id("set"), gate));
    expect((await repo.findById(id("set"), SINGLETON_SCOPE))!.linkGate).toEqual(gate);
    expect((await repo.findBySlug(`slug-${id("set")}`))!.linkGate).toEqual(gate);
  });

  it("round-trips a cleared gate on update", async () => {
    await repo.save(artefact(id("clear"), { passwordHash: "h", expiresAt: EXPIRES, version: 1 }));
    await repo.save(artefact(id("clear"), { passwordHash: null, expiresAt: null, version: 2 }));
    expect((await repo.findById(id("clear"), SINGLETON_SCOPE))!.linkGate).toEqual({
      passwordHash: null,
      expiresAt: null,
      version: 2,
    });
  });
});

describe("SQLite migration — link gate columns (S32a)", () => {
  it("reads a row that predates the columns as null / null / 0", async () => {
    const { sqlite } = await migratedDb();
    const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
    const { db } = await import("./client");
    sqlite
      .prepare(
        `INSERT INTO artefact (id, owner_id, title, kind, payload_ref, payload_bytes, payload_hash, created_at, updated_at)
         VALUES ('legacy-lg', ?, 'Legacy', 'form', 'r', 1, 'h', 0, 0)`,
      )
      .run(OWNER);
    const found = await new DrizzleArtefactRepository(db).findById("legacy-lg", SINGLETON_SCOPE);
    expect(found!.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 0 });
  });
});
