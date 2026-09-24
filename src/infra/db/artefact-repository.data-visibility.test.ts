import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact, setDataVisibility } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S41 (AH30) — `dataVisibility` round-trips through both ArtefactRepository
// adapters, and a row written before the column existed reads `shared`.

const OWNER = "dv-owner";

function artefact(id: string) {
  return createArtefact({
    id,
    ownerId: OWNER,
    title: id,
    kind: "form",
    payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
  });
}

async function migratedDb() {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, sqlite } = await import("./client");
  const { user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "DV", email: "dv-owner@example.com" })
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

describe.each(adapters)("ArtefactRepository dataVisibility — %s (S41)", (name, make) => {
  let repo: ArtefactRepository;
  const id = (s: string) => `${name}-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  it("round-trips a new artefact's own-only default", async () => {
    await repo.save(artefact(id("own")));
    expect((await repo.findById(id("own"), SINGLETON_SCOPE))!.dataVisibility).toBe("own");
  });

  it("round-trips a flip to shared", async () => {
    const a = artefact(id("shared"));
    await repo.save(a);
    await repo.save(setDataVisibility(a, OWNER, "shared"));
    expect((await repo.findById(id("shared"), SINGLETON_SCOPE))!.dataVisibility).toBe(
      "shared",
    );
  });
});

describe("SQLite migration — data_visibility (S41)", () => {
  it("reads a row that predates the column as shared", async () => {
    const { sqlite } = await migratedDb();
    const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
    const { db } = await import("./client");
    // A pre-S41 writer names no data_visibility: the column default fills it,
    // exactly as ADD COLUMN … DEFAULT fills every existing row.
    sqlite
      .prepare(
        `INSERT INTO artefact (id, owner_id, title, kind, payload_ref, payload_bytes, payload_hash, created_at, updated_at)
         VALUES ('legacy-dv', ?, 'Legacy', 'form', 'r', 1, 'h', 0, 0)`,
      )
      .run(OWNER);
    const found = await new DrizzleArtefactRepository(db).findById(
      "legacy-dv",
      SINGLETON_SCOPE,
    );
    expect(found!.dataVisibility).toBe("shared");
  });
});
