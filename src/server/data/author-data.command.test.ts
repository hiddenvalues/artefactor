import { beforeEach, describe, expect, it } from "vitest";
import { getAuthorDataEntry, listDataAuthors } from "./author-data.command";
import { putOwnDataEntry, type DataAccessDeps } from "./own-data.command";
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

const OWNER = "owner-1";
const OTHER = "user-2";

describe("author-data commands — host data-context switcher (S12)", () => {
  let artefactRepo: InMemoryArtefactRepository;
  let dataRepo: InMemoryDataRepository;
  let deps: DataAccessDeps & { newId: () => string };

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

  it("lists every author who has an entry, with freshness (AD4)", async () => {
    await seed("authenticated");
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"v":1}', deps);
    await putOwnDataEntry({ ref: "slug1", authorId: OTHER, scope: SCOPE }, '{"v":2}', deps);

    const authors = await listDataAuthors("slug1", OWNER, SCOPE, deps);
    expect(authors.map((a) => a.authorId).sort()).toEqual([OWNER, OTHER].sort());
    expect(authors.every((a) => a.updatedAt instanceof Date)).toBe(true);
  });

  it("loads another author's blob for a viewer with read access (AD4)", async () => {
    await seed("authenticated");
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"who":"owner"}', deps);
    // A different signed-in viewer can load the owner's entry (read-only seed).
    const entry = await getAuthorDataEntry("slug1", OTHER, OWNER, SCOPE, deps);
    expect(entry?.blob).toBe('{"who":"owner"}');
  });

  it("returns null when the requested author has no entry", async () => {
    await seed("authenticated");
    expect(await getAuthorDataEntry("slug1", OWNER, OTHER, SCOPE, deps)).toBeNull();
  });

  it("lets an unauthenticated viewer read a public artefact's authors (AD4)", async () => {
    await seed("public");
    await putOwnDataEntry({ ref: "slug1", authorId: OWNER, scope: SCOPE }, '{"v":1}', deps);
    const authors = await listDataAuthors("slug1", null, SCOPE, deps);
    expect(authors.map((a) => a.authorId)).toEqual([OWNER]);
    expect((await getAuthorDataEntry("slug1", null, OWNER, SCOPE, deps))?.blob).toBe(
      '{"v":1}',
    );
  });

  it("hides an authenticated artefact's authors from the anonymous (AD4)", async () => {
    await seed("authenticated");
    await expect(listDataAuthors("slug1", null, SCOPE, deps)).rejects.toBeInstanceOf(
      ArtefactNotFound,
    );
    await expect(
      getAuthorDataEntry("slug1", null, OWNER, SCOPE, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("hides a private artefact's authors from a non-owner (AD4/AH8)", async () => {
    const shared = await seed("public");
    await artefactRepo.save({ ...shared, visibility: "private" });
    await expect(
      listDataAuthors("slug1", OTHER, SCOPE, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    // Owner still reaches it.
    await expect(listDataAuthors("slug1", OWNER, SCOPE, deps)).resolves.toBeDefined();
  });

  it("is not-found for an archived artefact (AD6)", async () => {
    const shared = await seed("authenticated");
    await artefactRepo.save(archiveArtefact(shared));
    await expect(
      listDataAuthors("slug1", OWNER, SCOPE, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    await expect(
      getAuthorDataEntry("slug1", OWNER, OWNER, SCOPE, deps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });
});
