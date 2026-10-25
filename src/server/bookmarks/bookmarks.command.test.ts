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

// Saves over whatever is stored: a save carries the stored revision (S60).
async function resave(repo: InMemoryArtefactRepository, a: Artefact): Promise<Artefact> {
  const stored = await repo.findById(a.id, SCOPE);
  return repo.save({ ...a, revision: stored?.revision ?? 0 });
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

describe("bookmarks (S27)", () => {
  // r[verify collections.bookmark.set-semantics]
  it("toggles idempotently and lists resolved targets with effective tiers", async () => {
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    );
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    ); // no-op
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

  // r[verify collections.bookmark.artefact-view-gated]
  it("allows bookmarking a shared artefact you can view", async () => {
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

  // r[verify collections.bookmark.artefact-view-gated]
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

  // r[verify collections.bookmark.collection-view-gated]
  it("bookmarks a nested collection of a tree whose root grants the viewer", async () => {
    const root = createCollection({ id: "team", ownerId: OWNER, name: "Team" });
    await deps.collectionRepo.save({ ...root, visibility: "authenticated" });
    const nested = createCollection({ id: "nested", ownerId: OWNER, name: "Nested", parent: root });
    await deps.collectionRepo.save(nested);
    await setCollectionBookmark(
      { collectionId: "nested", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const marks = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(marks.collections.map((c) => c.id)).toEqual(["nested"]);
  });

  // r[verify collections.bookmark.artefact-view-gated]
  // r[verify collections.bookmark.collection-view-gated]
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

  // r[verify collections.bookmark.hidden-not-pruned]
  // r[verify collections.bookmark.artefact-view-gated]
  it("hides lost-access targets at read time but keeps the row", async () => {
    await deps.artefactRepo.save(
      makeArtefact("a2", { visibility: "public", publicSlug: "s2" }),
    );
    await setArtefactBookmark(
      { artefactId: "a2", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    // Owner unshares — the viewer's pin hides but survives.
    await resave(deps.artefactRepo, makeArtefact("a2", { publicSlug: "s2" }));
    const hidden = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(hidden.artefacts).toEqual([]);
    // Removing while access is lost still works (removes are ungated).
    await setArtefactBookmark(
      { artefactId: "a2", requesterId: VIEWER, bookmarked: false, scope: SCOPE },
      deps,
    );
    // Re-share: a still-present pin would reappear; this one was removed.
    await resave(
      deps.artefactRepo,
      makeArtefact("a2", { visibility: "public", publicSlug: "s2" }),
    );
    const after = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, deps);
    expect(after.artefacts).toEqual([]);
  });

  // r[verify collections.bookmark.hidden-not-pruned]
  it("filters archived targets at read time; rows survive restore", async () => {
    await setArtefactBookmark(
      { artefactId: "a1", requesterId: OWNER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const a = await deps.artefactRepo.findById("a1", SCOPE);
    await resave(deps.artefactRepo, {
      ...a!,
      status: "archived",
      archivedAt: new Date(),
    });
    const archived = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(archived.artefacts).toEqual([]); // filtered while archived
    await resave(deps.artefactRepo, { ...a!, status: "active", archivedAt: null });
    const restored = await listBookmarks({ requesterId: OWNER, scope: SCOPE }, deps);
    expect(restored.artefacts.map((b) => b.artefact.id)).toEqual(["a1"]); // row survived
  });
});

describe("bookmark list follows the read authorization (S27, S32a)", () => {
  const PASSWORD_GATE = { passwordHash: "scrypt$hash", expiresAt: null, version: 1 };
  // A deployment whose `authenticated` tier doesn't admit the viewer (another organization in a
  // superset), so only the public cell admits them and the link gate applies to them
  // (hosting.link-gate.narrows-public-audience).
  const NOT_ADMITTED = { grantsAuthenticatedTier: () => false };
  const crossOrg = () => ({ ...deps, accessPolicy: NOT_ADMITTED });

  // A public artefact the viewer bookmarked while it was open, then changed by the owner.
  async function bookmarkedPublic(over: Partial<Artefact>): Promise<void> {
    await deps.artefactRepo.save(makeArtefact("p1", { visibility: "public", publicSlug: "sp1" }));
    await setArtefactBookmark(
      { artefactId: "p1", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      crossOrg(),
    );
    await resave(
      deps.artefactRepo,
      makeArtefact("p1", { visibility: "public", publicSlug: "sp1", ...over }),
    );
  }

  async function rowKept(): Promise<boolean> {
    return (await deps.bookmarkRepo.listByUser(VIEWER)).artefactIds.includes("p1");
  }

  // r[verify collections.bookmark.hidden-not-pruned]
  it("hides a password-gated artefact the viewer holds no pass for, keeping the row", async () => {
    await bookmarkedPublic({ linkGate: PASSWORD_GATE });
    const list = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, crossOrg());
    expect(list.artefacts).toEqual([]);
    expect(await rowKept()).toBe(true);
  });

  // r[verify collections.bookmark.hidden-not-pruned]
  it("hides an artefact whose link has expired, keeping the row", async () => {
    await bookmarkedPublic({
      linkGate: { passwordHash: null, expiresAt: new Date(Date.now() - 60_000), version: 0 },
    });
    const list = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, crossOrg());
    expect(list.artefacts).toEqual([]);
    expect(await rowKept()).toBe(true);
  });

  // r[verify collections.bookmark.hidden-not-pruned]
  it("lists a password-gated artefact the viewer holds a current pass for", async () => {
    await bookmarkedPublic({ linkGate: PASSWORD_GATE });
    const list = await listBookmarks(
      {
        requesterId: VIEWER,
        scope: SCOPE,
        passes: (holderId) => (holderId === "p1" ? { version: 1 } : null),
      },
      crossOrg(),
    );
    expect(list.artefacts.map((b) => b.artefact.id)).toEqual(["p1"]);
  });

  // r[verify collections.bookmark.hidden-not-pruned]
  it("hides an artefact the deployment's access policy no longer grants, keeping the row", async () => {
    await deps.artefactRepo.save(
      makeArtefact("t1", { visibility: "authenticated", publicSlug: "st1" }),
    );
    await setArtefactBookmark(
      { artefactId: "t1", requesterId: VIEWER, bookmarked: true, scope: SCOPE },
      deps,
    );
    const list = await listBookmarks({ requesterId: VIEWER, scope: SCOPE }, crossOrg());
    expect(list.artefacts).toEqual([]);
    expect((await deps.bookmarkRepo.listByUser(VIEWER)).artefactIds).toEqual(["t1"]);
  });
});
