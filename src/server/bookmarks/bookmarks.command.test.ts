import { beforeEach, describe, expect, it } from "vitest";
import {
  listBookmarks,
  setArtefactBookmark,
  setCollectionBookmark,
} from "./bookmarks.command";
import { createArtefact } from "../../domain/artefact/artefact";
import { createCollection } from "../../domain/collection/collection";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryBookmarkRepository } from "../../domain/bookmark/in-memory-bookmark-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";

const OWNER = "owner-1";

let deps: {
  artefactRepo: InMemoryArtefactRepository;
  collectionRepo: InMemoryCollectionRepository;
  bookmarkRepo: InMemoryBookmarkRepository;
};

beforeEach(async () => {
  deps = {
    artefactRepo: new InMemoryArtefactRepository(),
    collectionRepo: new InMemoryCollectionRepository(),
    bookmarkRepo: new InMemoryBookmarkRepository(),
  };
  await deps.artefactRepo.save(
    createArtefact({
      id: "a1",
      ownerId: OWNER,
      title: "Demo",
      kind: "prototype",
      payload: { ref: "r", bytes: 10, hash: "h" },
    }),
  );
  await deps.collectionRepo.save(
    createCollection({ id: "c1", ownerId: OWNER, name: "Product" }),
  );
});

describe("bookmarks (S27, BM1–BM3)", () => {
  it("toggles idempotently and lists resolved targets", async () => {
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    );
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    ); // BM1 — no-op
    await setCollectionBookmark(
      { collectionId: "c1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const marks = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(marks.artefacts.map((a) => a.id)).toEqual(["a1"]);
    expect(marks.collections.map((c) => c.id)).toEqual(["c1"]);

    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: false, scope: SCOPE },
      deps,
    );
    const after = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(after.artefacts).toEqual([]);
  });

  it("rejects bookmarking a non-owned target as not-found (BM2)", async () => {
    await expect(
      setArtefactBookmark(
        { artefactId: "a1", requesterId: "other", bookmarked: true, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    await expect(
      setCollectionBookmark(
        { collectionId: "c1", requesterId: "other", bookmarked: true, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });

  it("filters archived targets at read time; rows survive restore (BM3)", async () => {
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const a = await deps.artefactRepo.findById("a1", SCOPE);
    await deps.artefactRepo.save({
      ...a!,
      status: "archived",
      archivedAt: new Date(),
    });
    const archived = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(archived.artefacts).toEqual([]); // filtered while archived
    await deps.artefactRepo.save({ ...a!, status: "active", archivedAt: null });
    const restored = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(restored.artefacts.map((x) => x.id)).toEqual(["a1"]); // row survived
  });
});
