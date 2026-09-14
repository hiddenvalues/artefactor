import { beforeEach, describe, expect, it } from "vitest";
import {
  createCollectionCommand,
  editCollectionCommand,
  grantCollectionAccessCommand,
  listOwnCollections,
} from "./collections.command";
import {
  ejectArtefactCommand,
  moveArtefactCommand,
} from "./move-artefact.command";
import { listSharedCollections } from "./shared-collections.query";
import {
  archiveCollectionCommand,
  deleteCollectionCommand,
  restoreCollectionCommand,
} from "./lifecycle.command";
import { listEffectivelyShared } from "./shared.query";
import { resolveEffectiveViewable } from "./effective";
import { canViewArtefact } from "../../domain/artefact/access";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryBookmarkRepository } from "../../domain/bookmark/in-memory-bookmark-repository";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { InMemoryViewRepository } from "../../domain/views/in-memory-view-repository";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import {
  CollectionInvariantViolation,
  CollectionNotFound,
} from "../../domain/collection/errors";
import type { Collection } from "../../domain/collection/collection";

const OWNER = "owner-1";
const VIEWER = "viewer-2";

class FakePayloadStore implements PayloadStore {
  deleted: string[] = [];
  async put(): Promise<StoredPayload> {
    return { ref: "r", bytes: 0, hash: "h" };
  }
  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async delete(ref: string): Promise<void> {
    this.deleted.push(ref);
  }
}

let artefactRepo: InMemoryArtefactRepository;
let collectionRepo: InMemoryCollectionRepository;
let bookmarkRepo: InMemoryBookmarkRepository;
let dataRepo: InMemoryDataRepository;
let viewRepo: InMemoryViewRepository;
let payloadStore: FakePayloadStore;
let slugCounter: number;

beforeEach(() => {
  artefactRepo = new InMemoryArtefactRepository();
  collectionRepo = new InMemoryCollectionRepository();
  bookmarkRepo = new InMemoryBookmarkRepository();
  dataRepo = new InMemoryDataRepository();
  viewRepo = new InMemoryViewRepository();
  payloadStore = new FakePayloadStore();
  slugCounter = 0;
});

const generateSlug = () => `slug-${++slugCounter}`;

function baseArtefact(id: string, over: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id,
      ownerId: OWNER,
      title: `Artefact ${id}`,
      kind: "prototype",
      payload: { ref: `ref-${id}`, bytes: 10, hash: "h" },
    }),
    ...over,
  };
}

async function makeCollection(
  name: string,
  over: { parentId?: string; visibility?: Collection["visibility"] } = {},
): Promise<Collection> {
  return createCollectionCommand(
    { requesterId: OWNER, name, scope: SCOPE, ...over },
    { collectionRepo, newId: () => `col-${name}` },
  );
}

describe("create / edit collection commands (S25)", () => {
  it("creates roots and children, stamping the scope tenant", async () => {
    const root = await makeCollection("Product");
    expect(root.rootId).toBe(root.id);
    expect(root.tenantId).toBe(SCOPE.tenantId);
    const child = await makeCollection("Q4", { parentId: root.id });
    expect(child.parentId).toBe(root.id);
    expect(child.rootId).toBe(root.id);
  });

  it("treats an unknown or non-owned parent as not-found (CL10)", async () => {
    await expect(
      createCollectionCommand(
        { requesterId: OWNER, name: "X", parentId: "ghost", scope: SCOPE },
        { collectionRepo },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
    const foreign = await createCollectionCommand(
      { requesterId: "other", name: "Theirs", scope: SCOPE },
      { collectionRepo, newId: () => "col-theirs" },
    );
    await expect(
      createCollectionCommand(
        { requesterId: OWNER, name: "X", parentId: foreign.id, scope: SCOPE },
        { collectionRepo },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });

  it("renames and changes tier; non-owner edits are not-found", async () => {
    const root = await makeCollection("Product");
    const edited = await editCollectionCommand(
      {
        collectionId: root.id,
        requesterId: OWNER,
        name: "Growth",
        visibility: "authenticated",
        scope: SCOPE,
      },
      { collectionRepo, artefactRepo, generateSlug },
    );
    expect(edited.name).toBe("Growth");
    expect(edited.visibility).toBe("authenticated");
    await expect(
      editCollectionCommand(
        { collectionId: root.id, requesterId: "intruder", name: "X", scope: SCOPE },
        { collectionRepo, artefactRepo, generateSlug },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });

  it("changing a root to a shared tier back-fills slugs across the subtree (CL6/AH21)", async () => {
    const root = await makeCollection("Product");
    const child = await makeCollection("Q4", { parentId: root.id });
    await artefactRepo.save(baseArtefact("a1", { collectionId: root.id }));
    // a2 is newer, so listings put it first: the slugs must not depend on that order.
    await artefactRepo.save(
      baseArtefact("a2", { collectionId: child.id, updatedAt: new Date(Date.now() + 1) }),
    );
    await artefactRepo.save(
      baseArtefact("a3", { collectionId: child.id, publicSlug: "kept" }),
    );
    await artefactRepo.save(baseArtefact("a4")); // top-level — untouched

    await editCollectionCommand(
      {
        collectionId: root.id,
        requesterId: OWNER,
        visibility: "authenticated",
        scope: SCOPE,
      },
      { collectionRepo, artefactRepo, generateSlug },
    );

    const minted = [
      (await artefactRepo.findById("a1", SCOPE))?.publicSlug,
      (await artefactRepo.findById("a2", SCOPE))?.publicSlug,
    ];
    expect([...minted].sort()).toEqual(["slug-1", "slug-2"]); // one distinct slug each
    expect((await artefactRepo.findById("a3", SCOPE))?.publicSlug).toBe("kept"); // AH5
    expect((await artefactRepo.findById("a4", SCOPE))?.publicSlug).toBeNull();
  });
});

describe("moveArtefactCommand (S25, CL6)", () => {
  it("moves in and out, minting a slug when the tree root is shared", async () => {
    const root = await makeCollection("Product", { visibility: "authenticated" });
    const child = await makeCollection("Q4", { parentId: root.id });
    await artefactRepo.save(baseArtefact("a1"));

    const moved = await moveArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, collectionId: child.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    expect(moved.collectionId).toBe(child.id);
    expect(moved.publicSlug).toBe("slug-1"); // effectively shared → addressable
    expect(moved.visibility).toBe("private"); // own tier dormant, untouched

    const back = await moveArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, collectionId: null, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    expect(back.collectionId).toBeNull();
    expect(back.publicSlug).toBe("slug-1"); // retained (AH5)
  });

  it("does not mint when the tree is private", async () => {
    const root = await makeCollection("Private stuff");
    await artefactRepo.save(baseArtefact("a1"));
    const moved = await moveArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, collectionId: root.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    expect(moved.publicSlug).toBeNull();
  });

  it("rejects a non-owned, non-contributable target collection as not-found", async () => {
    const foreign = await createCollectionCommand(
      { requesterId: "other", name: "Theirs", scope: SCOPE },
      { collectionRepo, newId: () => "col-theirs" },
    );
    await artefactRepo.save(baseArtefact("a1"));
    await expect(
      moveArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, collectionId: foreign.id, scope: SCOPE },
        { artefactRepo, collectionRepo, generateSlug },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });
});

describe("contributors (S29, CL12/CL13/CL14)", () => {
  // A tree owned by OWNER, shared `authenticated`, with VIEWER on the access
  // list (= contributor) — plus a VIEWER-owned artefact to contribute.
  async function seedContributable() {
    const root = await makeCollection("Team", { visibility: "authenticated" });
    await grantCollectionAccessCommand(
      { collectionId: root.id, requesterId: OWNER, userId: VIEWER, scope: SCOPE },
      { collectionRepo },
    );
    await artefactRepo.save(baseArtefact("mine", { ownerId: VIEWER }));
    return (await collectionRepo.findById(root.id, SCOPE))!;
  }

  it("a listed member moves their own artefact in (slug minted per CL6)", async () => {
    const root = await seedContributable();
    const moved = await moveArtefactCommand(
      { artefactId: "mine", requesterId: VIEWER, collectionId: root.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    expect(moved.collectionId).toBe(root.id);
    expect(moved.publicSlug).toBe("slug-1");
    expect(moved.ownerId).toBe(VIEWER); // stays theirs
  });

  it("an unlisted signed-in viewer cannot move in (uniform 404)", async () => {
    const root = await makeCollection("Team", { visibility: "authenticated" });
    await artefactRepo.save(baseArtefact("mine", { ownerId: "stranger" }));
    await expect(
      moveArtefactCommand(
        { artefactId: "mine", requesterId: "stranger", collectionId: root.id, scope: SCOPE },
        { artefactRepo, collectionRepo, generateSlug },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound);
  });

  it("the collection owner ejects a foreign artefact; a non-owner cannot", async () => {
    const root = await seedContributable();
    await moveArtefactCommand(
      { artefactId: "mine", requesterId: VIEWER, collectionId: root.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    await expect(
      ejectArtefactCommand(
        { collectionId: root.id, artefactId: "mine", requesterId: VIEWER, scope: SCOPE },
        { artefactRepo, collectionRepo },
      ),
    ).rejects.toBeInstanceOf(CollectionNotFound); // not their collection
    const evicted = await ejectArtefactCommand(
      { collectionId: root.id, artefactId: "mine", requesterId: OWNER, scope: SCOPE },
      { artefactRepo, collectionRepo },
    );
    expect(evicted.collectionId).toBeNull();
    expect(evicted.visibility).toBe("private"); // dormant tier resurfaces
    expect(evicted.status).toBe("active"); // untouched
  });

  it("archive cascade evicts foreign artefacts instead of archiving them (CL14)", async () => {
    const root = await seedContributable();
    await moveArtefactCommand(
      { artefactId: "mine", requesterId: VIEWER, collectionId: root.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    await artefactRepo.save(baseArtefact("owners-own", { collectionId: root.id }));
    const { cascade } = await archiveCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    expect(cascade).toEqual({ collections: 0, artefacts: 1, evicted: 1 });
    const mine = await artefactRepo.findById("mine", SCOPE);
    expect(mine?.status).toBe("active"); // never archived by someone else
    expect(mine?.collectionId).toBeNull(); // evicted
    expect((await artefactRepo.findById("owners-own", SCOPE))?.status).toBe("archived");
  });

  it("delete cascade evicts foreign artefacts instead of erasing them (CL14)", async () => {
    const root = await seedContributable();
    await moveArtefactCommand(
      { artefactId: "mine", requesterId: VIEWER, collectionId: root.id, scope: SCOPE },
      { artefactRepo, collectionRepo, generateSlug },
    );
    await artefactRepo.save(baseArtefact("owners-own", { collectionId: root.id }));
    await archiveCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    const counts = await deleteCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo, dataRepo, viewRepo, payloadStore, bookmarkRepo },
    );
    expect(counts).toEqual({ collections: 0, artefacts: 1, evicted: 0 });
    // ("mine" was already evicted by the archive cascade above.)
    const mine = await artefactRepo.findById("mine", SCOPE);
    expect(mine).not.toBeNull();
    expect(mine?.collectionId).toBeNull();
    expect(await artefactRepo.findById("owners-own", SCOPE)).toBeNull();
    expect(payloadStore.deleted).toEqual(["ref-owners-own"]);
  });

  it("the shared-collections read reports contributor-ness without the grantee list", async () => {
    const root = await seedContributable();
    const asMember = await listSharedCollections(VIEWER, SCOPE, { collectionRepo });
    expect(asMember.map((n) => n.collection.id)).toEqual([root.id]);
    expect(asMember[0]?.canContribute).toBe(true);
    expect(asMember[0]?.collection.sharedWith).toEqual([]); // privacy
    const asStranger = await listSharedCollections("stranger", SCOPE, { collectionRepo });
    expect(asStranger[0]?.canContribute).toBe(false); // views, can't contribute
  });
});

describe("effective access + shared composition (AH20/CL5)", () => {
  it("resolveEffectiveViewable substitutes the root's tier", async () => {
    const root = await makeCollection("Shared", { visibility: "authenticated" });
    const child = await makeCollection("Nested", { parentId: root.id });
    const a = baseArtefact("a1", { collectionId: child.id });
    await artefactRepo.save(a);
    const eff = await resolveEffectiveViewable(a, collectionRepo);
    expect(canViewArtefact(eff, VIEWER)).toBe(true);
    expect(canViewArtefact(eff, null)).toBe(false);
  });

  it("fails closed when the chain cannot be resolved", async () => {
    const a = baseArtefact("a1", {
      collectionId: "ghost",
      visibility: "public",
      publicSlug: "s",
    });
    const eff = await resolveEffectiveViewable(a, collectionRepo);
    expect(canViewArtefact(eff, VIEWER)).toBe(false);
    expect(canViewArtefact(eff, OWNER)).toBe(true);
  });

  it("listEffectivelyShared adds tree artefacts and drops dormant-tier ones", async () => {
    const shared = await makeCollection("Shared", { visibility: "authenticated" });
    const hidden = await makeCollection("Hidden"); // private root
    await artefactRepo.save(baseArtefact("a1", { collectionId: shared.id, publicSlug: "s1" }));
    await artefactRepo.save(
      // Own tier public but inside a private tree → dormant, must NOT appear.
      baseArtefact("a2", {
        collectionId: hidden.id,
        visibility: "public",
        publicSlug: "s2",
      }),
    );
    await artefactRepo.save(
      baseArtefact("a3", { visibility: "authenticated", publicSlug: "s3" }),
    );

    const result = await listEffectivelyShared(VIEWER, SCOPE, {
      artefactRepo,
      collectionRepo,
    });
    expect(result.map((e) => e.artefact.id).sort()).toEqual(["a1", "a3"]);
    expect(
      result.find((e) => e.artefact.id === "a1")?.effectiveVisibility,
    ).toBe("authenticated"); // the root's tier, not the artefact's own
    // The owner's own artefacts never show in their "Shared with you".
    const own = await listEffectivelyShared(OWNER, SCOPE, {
      artefactRepo,
      collectionRepo,
    });
    expect(own).toEqual([]);
  });

  it("a selected root shares the tree with exactly its members", async () => {
    const root = await makeCollection("Selected");
    await editCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, visibility: "selected", scope: SCOPE },
      { collectionRepo, artefactRepo, generateSlug },
    );
    await grantCollectionAccessCommand(
      { collectionId: root.id, requesterId: OWNER, userId: VIEWER, scope: SCOPE },
      { collectionRepo },
    );
    await artefactRepo.save(baseArtefact("a1", { collectionId: root.id, publicSlug: "s" }));

    const member = await listEffectivelyShared(VIEWER, SCOPE, { artefactRepo, collectionRepo });
    expect(member.map((e) => e.artefact.id)).toEqual(["a1"]);
    const stranger = await listEffectivelyShared("stranger", SCOPE, { artefactRepo, collectionRepo });
    expect(stranger).toEqual([]);
  });
});

describe("collection lifecycle cascades (S26, CL7/CL8)", () => {
  async function seedTree() {
    const root = await makeCollection("Root", { visibility: "authenticated" });
    const child = await makeCollection("Child", { parentId: root.id });
    await artefactRepo.save(baseArtefact("a1", { collectionId: root.id, publicSlug: "s1" }));
    await artefactRepo.save(baseArtefact("a2", { collectionId: child.id, publicSlug: "s2" }));
    await artefactRepo.save(baseArtefact("loose"));
    return { root, child };
  }

  it("archive cascades to descendant collections and artefacts, with counts", async () => {
    const { root, child } = await seedTree();
    const { cascade } = await archiveCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    expect(cascade).toEqual({ collections: 1, artefacts: 2, evicted: 0 });
    expect((await collectionRepo.findById(child.id, SCOPE))?.status).toBe("archived");
    expect((await artefactRepo.findById("a2", SCOPE))?.status).toBe("archived");
    expect((await artefactRepo.findById("loose", SCOPE))?.status).toBe("active");
  });

  it("restore brings the subtree back, including previously-archived artefacts", async () => {
    const { root, child } = await seedTree();
    // Archive one artefact individually first — restore does not track provenance.
    const a2 = await artefactRepo.findById("a2", SCOPE);
    await artefactRepo.save({ ...a2!, status: "archived", archivedAt: new Date() });
    await archiveCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    const { cascade } = await restoreCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    expect(cascade.artefacts).toBe(2);
    expect((await collectionRepo.findById(child.id, SCOPE))?.status).toBe("active");
    expect((await artefactRepo.findById("a2", SCOPE))?.status).toBe("active");
  });

  it("archiving a sub-collection leaves the rest of the tree active", async () => {
    const { root, child } = await seedTree();
    const { cascade } = await archiveCollectionCommand(
      { collectionId: child.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    expect(cascade).toEqual({ collections: 0, artefacts: 1, evicted: 0 });
    expect((await collectionRepo.findById(root.id, SCOPE))?.status).toBe("active");
    expect((await artefactRepo.findById("a1", SCOPE))?.status).toBe("active");
  });

  it("delete is archived-only and erases the subtree fully (CL8)", async () => {
    const { root, child } = await seedTree();
    const deps = {
      collectionRepo,
      artefactRepo,
      dataRepo,
      viewRepo,
      payloadStore,
      bookmarkRepo,
    };
    await expect(
      deleteCollectionCommand(
        { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
        deps,
      ),
    ).rejects.toBeInstanceOf(CollectionInvariantViolation);

    await bookmarkRepo.addCollection(OWNER, child.id);
    await bookmarkRepo.addArtefact(OWNER, "a2");
    const now = new Date();
    await dataRepo.save({
      id: "d1", artefactId: "a2", authorId: OWNER, blob: "[1]", authoredAgainstVersion: null,
      createdAt: now, updatedAt: now,
    });

    await archiveCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      { collectionRepo, artefactRepo },
    );
    const counts = await deleteCollectionCommand(
      { collectionId: root.id, requesterId: OWNER, scope: SCOPE },
      deps,
    );
    expect(counts).toEqual({ collections: 1, artefacts: 2, evicted: 0 });
    expect(await collectionRepo.findById(root.id, SCOPE)).toBeNull();
    expect(await collectionRepo.findById(child.id, SCOPE)).toBeNull();
    expect(await artefactRepo.findById("a1", SCOPE)).toBeNull();
    expect(await artefactRepo.findById("a2", SCOPE)).toBeNull();
    expect(payloadStore.deleted.sort()).toEqual(["ref-a1", "ref-a2"]);
    expect(await dataRepo.findByArtefactAndAuthor("a2", OWNER)).toBeNull();
    const marks = await bookmarkRepo.listByUser(OWNER);
    expect(marks).toEqual({ artefactIds: [], collectionIds: [] });
    // The loose artefact and the owner's list are untouched.
    expect(await artefactRepo.findById("loose", SCOPE)).not.toBeNull();
    expect(await listOwnCollections({ requesterId: OWNER, scope: SCOPE }, { collectionRepo })).toEqual([]);
  });
});
