import { beforeEach, describe, expect, it } from "vitest";
import {
  listBookmarks,
  setArtefactBookmark,
  setCollectionBookmark,
} from "./bookmarks.command";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { createCollection } from "../../domain/collection/collection";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryBookmarkRepository } from "../../domain/bookmark/in-memory-bookmark-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";

const OWNER = "owner-1";
const VIEWER = "viewer-2";

let deps: {
  artefactRepo: InMemoryArtefactRepository;
  collectionRepo: InMemoryCollectionRepository;
  bookmarkRepo: InMemoryBookmarkRepository;
};

function makeArtefact(id: string, over: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id,
      ownerId: OWNER,
      title: `Artefact ${id}`,
      kind: "prototype",
      payload: { ref: "r", bytes: 10, hash: "h" },
    }),
    ...over,
  };
}

beforeEach(async () => {
  deps = {
    artefactRepo: new InMemoryArtefactRepository(),
    collectionRepo: new InMemoryCollectionRepository(),
    bookmarkRepo: new InMemoryBookmarkRepository(),
  };
  await deps.artefactRepo.save(makeArtefact("a1"));
  await deps.collectionRepo.save(
    createCollection({ id: "c1", ownerId: OWNER, name: "Product" }),
  );
});

describe("bookmarks (S27, BM1–BM3)", () => {
  it("toggles idempotently and lists resolved targets with effective tiers", async () => {
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
    expect(marks.artefacts.map((b) => b.artefact.id)).toEqual(["a1"]);
    expect(marks.artefacts[0]?.effectiveVisibility).toBe("private");
    expect(marks.collections.map((c) => c.id)).toEqual(["c1"]);

    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: false, scope: SCOPE },
      deps,
    );
    const after = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(after.artefacts).toEqual([]);
  });

  it("allows bookmarking a shared artefact you can view (BM2)", async () => {
    await deps.artefactRepo.save(
      makeArtefact("a2", { visibility: "authenticated", publicSlug: "s2" }),
    );
    await setArtefactBookmark(
      { artefactId: "a2", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const marks = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(marks.artefacts.map((b) => b.artefact.id)).toEqual(["a2"]);
    expect(marks.artefacts[0]?.effectiveVisibility).toBe("authenticated");
  });

  it("bookmarks follow the *effective* tier — a shared tree grants, dormancy denies", async () => {
    const root = createCollection({ id: "root", ownerId: OWNER, name: "Shared" });
    await deps.collectionRepo.save({ ...root, visibility: "authenticated" });
    // Own tier private, but the tree is shared → viewable → bookmarkable.
    await deps.artefactRepo.save(
      makeArtefact("in-tree", { collectionId: "root", publicSlug: "s3" }),
    );
    await setArtefactBookmark(
      { artefactId: "in-tree", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    // Own tier public but inside a private tree → dormant → not viewable.
    const hidden = createCollection({ id: "hidden", ownerId: OWNER, name: "Hidden" });
    await deps.collectionRepo.save(hidden);
    await deps.artefactRepo.save(
      makeArtefact("dormant", {
        collectionId: "hidden",
        visibility: "public",
        publicSlug: "s4",
      }),
    );
    await expect(
      setArtefactBookmark(
        { artefactId: "dormant", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("rejects bookmarking a non-viewable artefact / non-owned collection as not-found", async () => {
    await expect(
      setArtefactBookmark(
        { artefactId: "a1", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound); // a1 is private to OWNER
    await expect(
      setCollectionBookmark(
        { collectionId: "c1", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });

  it("hides lost-access targets at read time but keeps the row (BM3)", async () => {
    await deps.artefactRepo.save(
      makeArtefact("a2", { visibility: "public", publicSlug: "s2" }),
    );
    await setArtefactBookmark(
      { artefactId: "a2", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    // Owner unshares — the viewer's pin hides but survives.
    await deps.artefactRepo.save(makeArtefact("a2", { publicSlug: "s2" }));
    const hidden = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(hidden.artefacts).toEqual([]);
    // Removing while access is lost still works (removes are ungated).
    await setArtefactBookmark(
      { artefactId: "a2", requesterId: VIEWER, bookmarked: false, scope: SCOPE },
      deps,
    );
    // Re-share: a still-present pin would reappear; this one was removed.
    await deps.artefactRepo.save(
      makeArtefact("a2", { visibility: "public", publicSlug: "s2" }),
    );
    const after = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(after.artefacts).toEqual([]);
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
    expect(restored.artefacts.map((b) => b.artefact.id)).toEqual(["a1"]); // row survived
  });
});
