import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveArtefact,
  createArtefact,
  editArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S35 (AH26) — the thumbnail compare-and-set and the render sweep's system read,
// as one contract run against both ArtefactRepository adapters: the in-memory
// double every command test uses, and the Drizzle/SQLite adapter production uses.

const OWNER = "thumb-owner";
const CREATED = new Date("2026-01-01T00:00:00Z");

function artefact(id: string, hash = `hash-${id}`): Artefact {
  return createArtefact({
    id,
    ownerId: OWNER,
    title: id,
    kind: "prototype",
    payload: { ref: `ref-${id}`, bytes: 10, hash },
    now: CREATED,
  });
}

async function drizzleRepo(): Promise<ArtefactRepository> {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./client");
  const { user } = await import("./schema");
  const { DrizzleArtefactRepository } = await import("./artefact-repository.drizzle");
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await db
    .insert(user)
    .values({ id: OWNER, name: "Thumb", email: "thumb-owner@example.com" })
    .onConflictDoNothing();
  return new DrizzleArtefactRepository(db);
}

const adapters: [string, () => Promise<ArtefactRepository>][] = [
  ["in-memory", async () => new InMemoryArtefactRepository()],
  ["drizzle", drizzleRepo],
];

describe.each(adapters)("ArtefactRepository thumbnails — %s (S35)", (name, make) => {
  let repo: ArtefactRepository;
  // Ids are unique per adapter so the shared SQLite file never collides.
  const id = (s: string) => `${name}-${s}`;

  beforeAll(async () => {
    repo = await make();
  });

  it("a freshly saved artefact has no thumbnail", async () => {
    await repo.save(artefact(id("fresh")));
    const found = await repo.findById(id("fresh"), SINGLETON_SCOPE);
    expect(found!.thumbnailHash).toBeNull();
  });

  it("records a thumbnail only when the hash matches the current payload", async () => {
    await repo.save(artefact(id("cas"), "h1"));

    expect(await repo.recordThumbnail(id("cas"), "stale")).toBe(false);
    expect((await repo.findById(id("cas"), SINGLETON_SCOPE))!.thumbnailHash).toBeNull();

    expect(await repo.recordThumbnail(id("cas"), "h1")).toBe(true);
    expect((await repo.findById(id("cas"), SINGLETON_SCOPE))!.thumbnailHash).toBe("h1");
  });

  it("does not change updatedAt when recording", async () => {
    await repo.save(artefact(id("stamp"), "h1"));
    await repo.recordThumbnail(id("stamp"), "h1");
    const found = await repo.findById(id("stamp"), SINGLETON_SCOPE);
    expect(found!.updatedAt).toEqual(CREATED);
  });

  it("returns false for an unknown artefact", async () => {
    expect(await repo.recordThumbnail(id("missing"), "h1")).toBe(false);
  });

  it("a save after a record never reverts thumbnailHash", async () => {
    await repo.save(artefact(id("revert"), "h1"));
    // The aggregate a concurrent edit loaded *before* the record landed.
    const loadedBefore = (await repo.findById(id("revert"), SINGLETON_SCOPE))!;
    await repo.recordThumbnail(id("revert"), "h1");

    await repo.save(editArtefact(loadedBefore, { title: "Renamed" }));

    const found = await repo.findById(id("revert"), SINGLETON_SCOPE);
    expect(found!.title).toBe("Renamed");
    expect(found!.thumbnailHash).toBe("h1");
  });

  it("an aggregate carrying a thumbnailHash cannot write it through save", async () => {
    await repo.save({ ...artefact(id("forged"), "h1"), thumbnailHash: "h1" });
    const found = await repo.findById(id("forged"), SINGLETON_SCOPE);
    expect(found!.thumbnailHash).toBeNull();
  });

  it("lists active artefacts whose thumbnail is missing or stale, never fresh or archived ones", async () => {
    await repo.save(artefact(id("need-null"), "n1"));

    await repo.save(artefact(id("need-stale"), "s1"));
    await repo.recordThumbnail(id("need-stale"), "s1");
    const recorded = (await repo.findById(id("need-stale"), SINGLETON_SCOPE))!;
    await repo.save(
      editArtefact(recorded, { payload: { ref: "ref-s2", bytes: 10, hash: "s2" } }),
    );

    await repo.save(artefact(id("need-fresh"), "f1"));
    await repo.recordThumbnail(id("need-fresh"), "f1");

    await repo.save(archiveArtefact(artefact(id("need-archived"), "a1")));

    const jobs = await repo.listNeedingThumbnail(1000);
    const mine = jobs.filter((j) => j.id.startsWith(id("need-")));
    expect(mine.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: id("need-null"), payloadRef: `ref-${id("need-null")}`, payloadHash: "n1", thumbnailHash: null },
      { id: id("need-stale"), payloadRef: "ref-s2", payloadHash: "s2", thumbnailHash: "s1" },
    ]);
  });

  it("honours the limit", async () => {
    await repo.save(artefact(id("limit-1")));
    await repo.save(artefact(id("limit-2")));
    expect(await repo.listNeedingThumbnail(1)).toHaveLength(1);
  });
});
