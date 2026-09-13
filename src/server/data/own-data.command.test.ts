import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteOwnDataEntry,
  getOwnDataEntry,
  putOwnDataEntry,
  type OwnDataDeps,
} from "./own-data.command";
import {
  createArtefact,
  shareArtefact,
  archiveArtefact,
  editArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { DataConflict, InvalidBlob } from "../../domain/data/errors";

const OWNER = "owner-1";

describe("own-data commands (S11)", () => {
  let artefactRepo: InMemoryArtefactRepository;
  let dataRepo: InMemoryDataRepository;
  let deps: OwnDataDeps;

  // Seed an artefact owned by OWNER, shared at `tier` so it carries a slug.
  async function seed(
    tier: "authenticated" | "public" = "public",
    over: Partial<Artefact> = {},
  ) {
    const a = shareArtefact(
      createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Form",
        kind: "form",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
      { tier, newSlug: "slug1" },
    );
    await artefactRepo.save({ ...a, ...over });
    return a;
  }

  beforeEach(() => {
    artefactRepo = new InMemoryArtefactRepository();
    dataRepo = new InMemoryDataRepository();
    let n = 0;
    deps = {
      artefactRepo,
      collectionRepo: new InMemoryCollectionRepository(),
      dataRepo,
      newId: () => `d${++n}`,
    };
  });

  it("upserts and reads back the caller's own blob (AD1)", async () => {
    await seed();
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"v":1}', deps);
    const got = await getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps);
    expect(got?.blob).toBe('{"v":1}');

    // Second write upserts the same entry.
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"v":2}', deps);
    expect((await getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps))?.blob).toBe(
      '{"v":2}',
    );
  });

  it("keeps each author's entry separate on a shared artefact (AD2)", async () => {
    await seed("authenticated");
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"who":"owner"}', deps);
    await putOwnDataEntry({ ref: "slug1", authorId: "user-2", scope: SCOPE }, '{"who":"two"}', deps);
    expect((await getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps))?.blob).toBe(
      '{"who":"owner"}',
    );
    expect((await getOwnDataEntry({ ref: "slug1", authorId: "user-2", scope: SCOPE }, deps))?.blob).toBe(
      '{"who":"two"}',
    );
  });

  it("returns null when the caller has no entry yet", async () => {
    await seed();
    expect(await getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps)).toBeNull();
  });

  it("rejects an invalid blob (AD8)", async () => {
    await seed();
    await expect(
      putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, "not json", deps),
    ).rejects.toBeInstanceOf(InvalidBlob);
  });

  it("is not-found for an archived artefact (AD6)", async () => {
    const shared = await seed();
    await artefactRepo.save(archiveArtefact(shared));
    await expect(
      putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, "{}", deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    await expect(
      getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("is not-found when a non-owner targets a private artefact (AD4/AH8)", async () => {
    // Shared then unshared → private but slug retained.
    const shared = await seed("public");
    await artefactRepo.save({ ...shared, visibility: "private" });
    await expect(
      putOwnDataEntry({ ref: "slug1", authorId: "intruder", scope: SCOPE }, "{}", deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    // The owner can still write their own.
    await expect(
      putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, "{}", deps),
    ).resolves.toBeDefined();
  });

  it("is not-found for an unknown slug", async () => {
    await expect(
      getOwnDataEntry({ ref: "nope", authorId: OWNER, scope: SCOPE }, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("addresses a never-shared private artefact by its id (id alias)", async () => {
    // No slug — addressable only by id; only the owner may view it.
    await artefactRepo.save(
      createArtefact({
        id: "never-shared",
        ownerId: OWNER,
        title: "Private",
        kind: "form",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
    );
    await putOwnDataEntry({ ref: "never-shared", authorId: OWNER, scope: SCOPE }, '{"v":1}', deps);
    expect(
      (await getOwnDataEntry({ ref: "never-shared", authorId: OWNER, scope: SCOPE }, deps))?.blob,
    ).toBe('{"v":1}');
    // A non-owner cannot reach it even with the id.
    await expect(
      getOwnDataEntry({ ref: "never-shared", authorId: "intruder", scope: SCOPE }, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("deletes the caller's entry", async () => {
    await seed();
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, "{}", deps);
    await deleteOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps);
    expect(await getOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, deps)).toBeNull();
  });

  describe("optimistic pin — ifUnmodifiedSince (S31)", () => {
    const REF = { ref: "slug1", authorId: OWNER, scope: SCOPE };
    const T0 = new Date("2026-09-12T10:00:00.000Z");
    const T1 = new Date("2026-09-12T10:05:00.000Z");
    const T2 = new Date("2026-09-12T10:10:00.000Z");
    const at = (d: Date): OwnDataDeps => ({ ...deps, now: () => d });

    it("writes when the entry is unmodified since the pin", async () => {
      await seed();
      await putOwnDataEntry(REF, '{"v":1}', at(T0));
      const saved = await putOwnDataEntry(REF, '{"v":2}', at(T1), {
        ifUnmodifiedSince: T0,
      });
      expect(saved.updatedAt).toEqual(T1);
      expect((await getOwnDataEntry(REF, deps))?.blob).toBe('{"v":2}');
    });

    it("throws DataConflict and writes nothing when the entry changed since the pin", async () => {
      await seed();
      await putOwnDataEntry(REF, '{"v":1}', at(T0));
      // The user's open tab saves after the agent read at T0.
      await putOwnDataEntry(REF, '{"v":"tab"}', at(T1));
      await expect(
        putOwnDataEntry(REF, '{"v":"agent"}', at(T2), { ifUnmodifiedSince: T0 }),
      ).rejects.toBeInstanceOf(DataConflict);
      const kept = await getOwnDataEntry(REF, deps);
      expect(kept?.blob).toBe('{"v":"tab"}');
      expect(kept?.updatedAt).toEqual(T1);
    });

    it("a null pin means 'expected no entry' — conflicts if one was created since", async () => {
      await seed();
      // The read was empty; the user then starts saving before the agent writes.
      await putOwnDataEntry(REF, '{"v":"tab"}', at(T1));
      await expect(
        putOwnDataEntry(REF, '{"v":"agent"}', at(T2), { ifUnmodifiedSince: null }),
      ).rejects.toBeInstanceOf(DataConflict);
      expect((await getOwnDataEntry(REF, deps))?.blob).toBe('{"v":"tab"}');
    });

    it("a null pin creates the entry when there still is none", async () => {
      await seed();
      await putOwnDataEntry(REF, '{"v":1}', at(T0), { ifUnmodifiedSince: null });
      expect((await getOwnDataEntry(REF, deps))?.blob).toBe('{"v":1}');
    });

    it("no pin writes unconditionally (the PUT …/data/me behaviour)", async () => {
      await seed();
      await putOwnDataEntry(REF, '{"v":1}', at(T1));
      await putOwnDataEntry(REF, '{"v":2}', at(T2));
      expect((await getOwnDataEntry(REF, deps))?.blob).toBe('{"v":2}');
    });
  });

  // S19a (AD9) — every write stamps the payload hash it was written against.
  // Advisory only: the pin never decides whether a read or write is allowed.
  describe("payload version pin — authoredAgainstVersion (S19a/AD9)", () => {
    const REF = { ref: "slug1", authorId: OWNER, scope: SCOPE };

    // Replace the artefact's payload in place (S3), as an edit would.
    async function editPayload(hash: string) {
      const current = (await artefactRepo.findById("a1", SCOPE))!;
      await artefactRepo.save(
        editArtefact(current, { payload: { ref: `r-${hash}`, bytes: 10, hash } }),
      );
    }

    it("a fresh write records the artefact's current payload hash", async () => {
      await seed();
      const saved = await putOwnDataEntry(REF, '{"v":1}', deps);
      expect(saved.authoredAgainstVersion).toBe("h");
      expect((await getOwnDataEntry(REF, deps))?.authoredAgainstVersion).toBe("h");
    });

    it("an entry written before a payload edit reads back a pin ≠ the new hash", async () => {
      await seed();
      await putOwnDataEntry(REF, '{"v":1}', deps);
      await editPayload("h2");
      const stale = await getOwnDataEntry(REF, deps);
      expect(stale?.authoredAgainstVersion).toBe("h");
      expect(stale?.authoredAgainstVersion).not.toBe("h2");

      // The next write re-stamps against the live payload.
      await putOwnDataEntry(REF, '{"v":2}', deps);
      expect((await getOwnDataEntry(REF, deps))?.authoredAgainstVersion).toBe("h2");
    });

    it("an entry predating the pin reads null, and is still readable and writable", async () => {
      await seed();
      await dataRepo.save({
        id: "legacy",
        artefactId: "a1",
        authorId: OWNER,
        blob: '{"old":1}',
        authoredAgainstVersion: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const legacy = await getOwnDataEntry(REF, deps);
      expect(legacy?.blob).toBe('{"old":1}');
      expect(legacy?.authoredAgainstVersion).toBeNull();

      const saved = await putOwnDataEntry(REF, '{"new":1}', deps);
      expect(saved.id).toBe("legacy");
      expect(saved.authoredAgainstVersion).toBe("h");
    });

    it("never gates access: a stale pin doesn't block the owner, a matching one doesn't admit a non-viewer (AD3–AD5)", async () => {
      const shared = await seed("public");
      await putOwnDataEntry(REF, '{"v":1}', deps);
      await putOwnDataEntry({ ...REF, authorId: "user-2" }, '{"v":1}', deps);
      await editPayload("h2");

      // Stale pins: both authors still read and write their own entry.
      await expect(getOwnDataEntry(REF, deps)).resolves.not.toBeNull();
      await expect(putOwnDataEntry(REF, '{"v":2}', deps)).resolves.toBeDefined();
      await expect(
        putOwnDataEntry({ ...REF, authorId: "user-2" }, '{"v":2}', deps),
      ).resolves.toBeDefined();

      // Unshare → private. user-2's pin now matches the live payload, but that
      // doesn't reach past the access matrix.
      const current = (await artefactRepo.findById("a1", SCOPE))!;
      await artefactRepo.save({ ...current, visibility: "private", publicSlug: shared.publicSlug });
      await expect(
        getOwnDataEntry({ ...REF, authorId: "user-2" }, deps),
      ).rejects.toBeInstanceOf(ArtefactNotFound);
      await expect(
        putOwnDataEntry({ ...REF, authorId: "user-2" }, "{}", deps),
      ).rejects.toBeInstanceOf(ArtefactNotFound);
    });
  });
});
