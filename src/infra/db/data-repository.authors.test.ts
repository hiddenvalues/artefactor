import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact } from "../../domain/artefact/artefact";
import { upsertDataEntry } from "../../domain/data/data-entry";
import type { DataRepository } from "../../domain/data/data-repository";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";

// S40 — `listAuthorsByArtefact` reports each author's stored byte length and
// version pin without loading a blob, as one contract run against both
// DataRepository adapters: the in-memory double every command test uses, and
// the Drizzle/SQLite adapter production uses (the EE Postgres mirror has its own).

const AUTHORS = ["s40-author-a", "s40-author-b", "s40-author-c"];
const T1 = new Date("2026-03-01T00:00:00Z");
const T2 = new Date("2026-03-02T00:00:00Z");

// Ten, 300 and a multi-byte blob: "åäö" is 3 characters but 6 UTF-8 bytes.
const TEN = '{"a":"12"}';
const THREE_HUNDRED = JSON.stringify({ a: "x".repeat(292) });
const MULTI_BYTE = '{"k":"åäö"}';

async function drizzleRepo(artefactIds: string[]): Promise<DataRepository> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { user } = await import("./schema");
  const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
  const { DrizzleDataRepository } = await import("./data-repository.drizzle");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  for (const id of AUTHORS) {
    await db
      .insert(user)
      .values({ id, name: id, email: `${id}@example.com` })
      .onConflictDoNothing();
  }
  const artefacts = new DrizzleArtefactRepository(db);
  for (const id of artefactIds) {
    await artefacts.save(
      createArtefact({
        id,
        ownerId: AUTHORS[0]!,
        title: id,
        kind: "form",
        payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
        now: T1,
      }),
    );
  }
  return new DrizzleDataRepository(db);
}

const adapters: [string, (ids: string[]) => Promise<DataRepository>][] = [
  ["in-memory", async () => new InMemoryDataRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("DataRepository author refs — %s (S40)", (name, make) => {
  let repo: DataRepository;
  // Ids are unique per adapter so the shared SQLite file never collides.
  const artefact = `${name}-s40-${Date.now()}`;
  const empty = `${artefact}-empty`;

  beforeAll(async () => {
    repo = await make([artefact, empty]);
    const entry = (id: string, authorId: string, blob: string, pin: string | null, now: Date) =>
      repo.save(
        upsertDataEntry({ id: `${artefact}-${id}`, artefactId: artefact, authorId, blob, authoredAgainstVersion: pin, now }),
      );
    await entry("a", AUTHORS[0]!, TEN, "hash-v1", T1);
    await entry("b", AUTHORS[1]!, THREE_HUNDRED, null, T2);
    await entry("c", AUTHORS[2]!, MULTI_BYTE, "hash-v2", T2);
  });

  it("reports each author's stored UTF-8 byte length and version pin", async () => {
    const refs = await repo.listAuthorsByArtefact(artefact);
    const byAuthor = new Map(refs.map((r) => [r.authorId, r]));

    expect(refs).toHaveLength(3);
    expect(byAuthor.get(AUTHORS[0]!)).toEqual({
      authorId: AUTHORS[0],
      updatedAt: T1,
      bytes: 10,
      authoredAgainstVersion: "hash-v1",
    });
    expect(byAuthor.get(AUTHORS[1]!)).toMatchObject({ bytes: 300, authoredAgainstVersion: null });
    // Bytes, not characters: 11 characters, 14 bytes.
    expect(MULTI_BYTE).toHaveLength(11);
    expect(byAuthor.get(AUTHORS[2]!)).toMatchObject({ bytes: 14, authoredAgainstVersion: "hash-v2" });
  });

  it("an artefact without entries lists no authors", async () => {
    expect(await repo.listAuthorsByArtefact(empty)).toEqual([]);
  });
});
