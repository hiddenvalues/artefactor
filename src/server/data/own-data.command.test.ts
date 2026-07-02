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
  type Artefact,
} from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { InvalidBlob } from "../../domain/data/errors";

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
});
