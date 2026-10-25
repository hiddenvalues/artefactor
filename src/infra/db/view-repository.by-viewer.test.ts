import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact } from "../../domain/artefact/artefact";
import { recordView } from "../../domain/views/view-entry";
import type { ViewRepository } from "../../domain/views/view-repository";
import { InMemoryViewRepository } from "../../domain/views/in-memory-view-repository";

// S47 — `listByViewer` returns one viewer's own view entries, newest first, as
// one contract run against both ViewRepository adapters: the in-memory double
// every command test uses, and the Drizzle/SQLite adapter production uses (the
// EE Postgres mirror has its own).

const VIEWERS = ["s47-viewer-1", "s47-viewer-2"];
const T1 = new Date("2026-03-01T00:00:00Z");
const T2 = new Date("2026-03-02T00:00:00Z");
const T3 = new Date("2026-03-03T00:00:00Z");

async function drizzleRepo(artefactIds: string[]): Promise<ViewRepository> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { user } = await import("./schema");
  const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
  const { DrizzleViewRepository } = await import("./view-repository.drizzle");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  for (const id of VIEWERS) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com` }).onConflictDoNothing();
  }
  const artefacts = new DrizzleArtefactRepository(db);
  for (const id of artefactIds) {
    await artefacts.save(
      createArtefact({
        id,
        ownerId: VIEWERS[1]!,
        title: id,
        kind: "form",
        payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
        now: T1,
      }),
    );
  }
  return new DrizzleViewRepository(db);
}

const adapters: [string, (ids: string[]) => Promise<ViewRepository>][] = [
  ["in-memory", async () => new InMemoryViewRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("ViewRepository.listByViewer — %s (S47)", (name, make) => {
  let repo: ViewRepository;
  // Ids are unique per run so the shared SQLite file never collides.
  const run = `${name}-s47-${Date.now()}`;
  const [a1, a2, a3] = [`${run}-a1`, `${run}-a2`, `${run}-a3`];

  beforeAll(async () => {
    repo = await make([a1, a2, a3]);
    const view = (id: string, artefactId: string, viewerId: string, now: Date) =>
      repo.save(recordView({ id: `${run}-${id}`, artefactId, viewerId, now }));
    await view("1", a1, VIEWERS[0]!, T1);
    await view("2", a2, VIEWERS[0]!, T3);
    await view("3", a3, VIEWERS[0]!, T2);
    await view("4", a1, VIEWERS[1]!, T3);
  });

  // r[verify hosting.home.own-views]
  it("returns only that viewer's entries, newest first", async () => {
    expect(await repo.listByViewer(VIEWERS[0]!)).toEqual([
      { artefactId: a2, viewedAt: T3 },
      { artefactId: a3, viewedAt: T2 },
      { artefactId: a1, viewedAt: T1 },
    ]);
    expect(await repo.listByViewer(VIEWERS[1]!)).toEqual([{ artefactId: a1, viewedAt: T3 }]);
  });

  it("gives [] for a viewer with no entries", async () => {
    expect(await repo.listByViewer(`${run}-nobody`)).toEqual([]);
  });
});
