import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S79 — Database refuses a payload ref shared by two artefacts. The SQLite schema holds
// `hosting.payload.ref-unique-in-database` with a unique index on `artefact.payload_ref`, so a
// writer that copies another artefact's ref fails at its save. The Postgres mirror runs the same
// cases in `ee/infra/db/artefact-repository.payload-ref.pg.test.ts`; the migration onto a database
// that already holds a shared ref is tested in `migrate.test.ts` (and `migrate.pg.test.ts`).

const OWNER = "pr-owner";

function artefact(id: string, ref: string): Artefact {
  return createArtefact({
    id,
    ownerId: OWNER,
    title: `title-${id}`,
    kind: "form",
    payload: { ref, bytes: 10, hash: `hash-${id}` },
  });
}

describe("ArtefactRepository payload ref uniqueness — drizzle (S79)", () => {
  let repo: ArtefactRepository;
  const load = async (id: string) => (await repo.findById(id, SINGLETON_SCOPE))!;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("./client");
    const { user } = await import("./schema");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    await db.insert(user).values({ id: OWNER, name: OWNER, email: `${OWNER}@example.com` }).onConflictDoNothing();
    const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
    repo = new DrizzleArtefactRepository(db);
  });

  // r[verify hosting.payload.ref-unique-in-database]
  it("refuses a second artefact carrying an existing artefact's payload ref, leaving the first unchanged", async () => {
    const first = await repo.save(artefact("pr-first", "ref-pr-shared"));
    await expect(repo.save(artefact("pr-copy", "ref-pr-shared"))).rejects.toThrow(/UNIQUE constraint failed: artefact\.payload_ref/);
    expect(await load("pr-first")).toEqual(first);
    expect(await repo.findById("pr-copy", SINGLETON_SCOPE)).toBeNull();
  });

  // r[verify hosting.payload.ref-unique-in-database]
  it("refuses an update that points an artefact at another artefact's payload ref", async () => {
    const held = await repo.save(artefact("pr-held", "ref-pr-held"));
    const other = await repo.save(artefact("pr-other", "ref-pr-other"));
    await expect(repo.save({ ...other, payloadRef: held.payloadRef })).rejects.toThrow(
      /UNIQUE constraint failed: artefact\.payload_ref/,
    );
    expect((await load("pr-other")).payloadRef).toBe("ref-pr-other");
  });

  // r[verify hosting.payload.ref-unique-in-database]
  it("lets an edit replace an artefact's own ref with a fresh one", async () => {
    const a = await repo.save(artefact("pr-edit", "ref-pr-edit-old"));
    const saved = await repo.save({ ...a, payloadRef: "ref-pr-edit-new" });
    expect((await load("pr-edit")).payloadRef).toBe("ref-pr-edit-new");
    expect(saved.revision).toBe(a.revision + 1);
  });
});
