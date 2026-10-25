import { beforeAll, describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactConflict } from "../../domain/artefact/errors";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S60 — Save concurrency: a save never overwrites a newer artefact. Both ArtefactRepository
// adapters hold `hosting.save.no-lost-update`: a save is a compare-and-set on `revision`, and a
// losing save writes neither the row nor the access list. The Postgres mirror runs the same cases
// in `ee/infra/db/artefact-repository.save-concurrency.pg.test.ts`.

const OWNER = "sc-owner";
const M1 = "sc-member-1";
const M2 = "sc-member-2";

function artefact(id: string, overrides: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id,
      ownerId: OWNER,
      title: `title-${id}`,
      kind: "form",
      payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
    }),
    ...overrides,
  };
}

interface Harness {
  repo: ArtefactRepository;
  // Makes a collection id an artefact may point at (the SQLite FK needs the row).
  addCollection: (id: string) => Promise<void>;
}

async function drizzleHarness(): Promise<Harness> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { collection, user } = await import("./schema");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  for (const id of [OWNER, M1, M2]) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com` }).onConflictDoNothing();
  }
  const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
  return {
    repo: new DrizzleArtefactRepository(db),
    addCollection: async (id) => {
      await db.insert(collection).values({ id, ownerId: OWNER, name: id, rootId: id, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
    },
  };
}

const adapters: [string, () => Promise<Harness>][] = [
  ["in-memory", async () => ({ repo: new InMemoryArtefactRepository(), addCollection: async () => {} })],
  ["drizzle", drizzleHarness],
];

describe.each(adapters)("ArtefactRepository save concurrency — %s (S60)", (name, make) => {
  let h: Harness;
  const id = (s: string) => `${name}-sc-${s}`;
  const load = async (artefactId: string) => (await h.repo.findById(artefactId, SINGLETON_SCOPE))!;

  beforeAll(async () => {
    h = await make();
  });

  // r[verify hosting.save.no-lost-update]
  it("inserts a never-saved aggregate at revision 1", async () => {
    const a = artefact(id("new"));
    expect(a.revision).toBe(0);
    const saved = await h.repo.save(a);
    expect(saved.revision).toBe(1);
    expect((await load(a.id)).revision).toBe(1);
  });

  // r[verify hosting.save.no-lost-update]
  it("refuses a revision-0 save whose id already exists, leaving the row unchanged", async () => {
    await h.repo.save(artefact(id("dup")));
    await expect(h.repo.save(artefact(id("dup"), { title: "other" }))).rejects.toBeInstanceOf(
      ArtefactConflict,
    );
    const stored = await load(id("dup"));
    expect(stored.title).toBe(`title-${id("dup")}`);
    expect(stored.revision).toBe(1);
  });

  // r[verify hosting.save.no-lost-update]
  it("refuses the second of two saves loaded at the same revision", async () => {
    await h.repo.save(
      artefact(id("race"), { visibility: "authenticated", publicSlug: `slug-${id("race")}` }),
    );
    const first = await load(id("race"));
    const second = await load(id("race"));
    expect(first.revision).toBe(1);

    await h.repo.save({ ...first, visibility: "private" });
    await expect(h.repo.save({ ...second, title: "new title" })).rejects.toBeInstanceOf(
      ArtefactConflict,
    );

    const stored = await load(id("race"));
    expect(stored.visibility).toBe("private");
    expect(stored.title).toBe(`title-${id("race")}`);
    expect(stored.revision).toBe(2);
  });

  // r[verify hosting.save.no-lost-update]
  it("leaves the access list as it was when a save conflicts", async () => {
    await h.repo.save(artefact(id("acl"), { visibility: "selected", sharedWith: [M1] }));
    const stale = await load(id("acl"));
    await h.repo.save({ ...(await load(id("acl"))), title: "bumped" });

    await expect(h.repo.save({ ...stale, sharedWith: [M2] })).rejects.toBeInstanceOf(
      ArtefactConflict,
    );
    expect((await load(id("acl"))).sharedWith).toEqual([M1]);
  });

  // r[verify hosting.save.no-lost-update]
  it("refuses a save whose row is gone, re-creating nothing", async () => {
    await h.repo.save(artefact(id("gone")));
    const loaded = await load(id("gone"));
    await h.repo.delete(id("gone"));
    await expect(h.repo.save({ ...loaded, title: "back" })).rejects.toBeInstanceOf(ArtefactConflict);
    expect(await h.repo.findById(id("gone"), SINGLETON_SCOPE)).toBeNull();
  });

  // r[verify hosting.save.no-lost-update]
  it("keeps the revision through recordThumbnail, so a save loaded before the render applies", async () => {
    await h.repo.save(artefact(id("thumb")));
    const loaded = await load(id("thumb"));
    expect(await h.repo.recordThumbnail(id("thumb"), `hash-${id("thumb")}`)).toBe(true);
    expect((await load(id("thumb"))).revision).toBe(1);

    const saved = await h.repo.save({ ...loaded, title: "after render" });
    expect(saved.revision).toBe(2);
    expect((await load(id("thumb"))).thumbnailHash).toBe(`hash-${id("thumb")}`);
  });

  // r[verify hosting.save.no-lost-update]
  it("returns the stored revision from every read", async () => {
    const col = id("col");
    await h.addCollection(col);
    const slug = `slug-${id("reads")}`;
    await h.repo.save(
      artefact(id("reads"), { visibility: "public", publicSlug: slug, collectionId: col }),
    );
    await h.repo.save({ ...(await load(id("reads"))), title: "twice" });

    expect((await load(id("reads"))).revision).toBe(2);
    expect((await h.repo.findBySlug(slug))!.revision).toBe(2);
    const owned = await h.repo.listByOwner(OWNER, SINGLETON_SCOPE);
    expect(owned.find((a) => a.id === id("reads"))!.revision).toBe(2);
    const contained = await h.repo.listByCollectionIds([col], SINGLETON_SCOPE);
    expect(contained.find((a) => a.id === id("reads"))!.revision).toBe(2);
  });
});

// The atomic seam: the guarded write and the access-list sync run through the runner the adapter
// is given, on the executor it hands over (a transaction on Postgres). SQLite's default runs them
// on the plain client, one after the other.
describe("DrizzleArtefactRepository atomic seam (S60)", () => {
  async function seamHarness() {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("./client");
    const { user } = await import("./schema");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    for (const u of [OWNER, M1, M2]) {
      await db.insert(user).values({ id: u, name: u, email: `${u}@example.com` }).onConflictDoNothing();
    }
    const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
    const log = { runs: 0, writes: [] as string[] };
    // Hands the runner's callback an executor that records every write it is asked for.
    const executor = new Proxy(db, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (prop === "insert" || prop === "update" || prop === "delete") {
          return (...args: unknown[]) => {
            log.writes.push(prop);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repo = new DrizzleArtefactRepository(db, async (fn) => {
      log.runs += 1;
      return fn(executor);
    });
    return { repo, log };
  }

  // r[verify hosting.save.no-lost-update]
  it("runs the compare-and-set and the access-list sync inside the runner, on its executor", async () => {
    const { repo, log } = await seamHarness();
    await repo.save(artefact("seam-a", { visibility: "selected", sharedWith: [M1] }));
    expect(log).toEqual({ runs: 1, writes: ["insert", "insert"] });

    const loaded = (await repo.findById("seam-a", SINGLETON_SCOPE))!;
    log.writes = [];
    await repo.save({ ...loaded, sharedWith: [M2] });
    expect(log.runs).toBe(2);
    expect(log.writes).toEqual(["update", "delete", "insert"]);
  });

  // r[verify hosting.save.no-lost-update]
  it("throws a conflict from inside the runner, before the sync writes anything", async () => {
    const { repo, log } = await seamHarness();
    await repo.save(artefact("seam-b", { visibility: "selected", sharedWith: [M1] }));
    const stale = (await repo.findById("seam-b", SINGLETON_SCOPE))!;
    await repo.save({ ...stale, title: "first" });
    log.writes = [];
    log.runs = 0;
    await expect(repo.save({ ...stale, sharedWith: [M2] })).rejects.toBeInstanceOf(ArtefactConflict);
    expect(log).toEqual({ runs: 1, writes: ["update"] });
  });
});
