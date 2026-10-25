import {
  archiveCollection,
  assertCollectionDeletable,
  assertRestorableIn,
  restoreCollection,
  type Collection,
} from "../../domain/collection/collection";
import { collectSubtree } from "../../domain/collection/tree";
import {
  archiveArtefact,
  restoreArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import { evictFromCollection } from "../../domain/collection/move-artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import type { PayloadStore, ThumbnailStore } from "../../domain/artefact/ports";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { loadOwnCollection } from "./get-own-collection";
import { cascadeTo } from "./cascade-artefact";

// Application commands for S26 — collection lifecycle cascades.
// Sequential best-effort like the S15 artefact delete, with the FK cascades as
// the DB-level backstop; each node/artefact moves through its own pure
// transition so the per-aggregate guards keep holding.

export interface CollectionLifecycleInput {
  collectionId: string;
  requesterId: string;
  scope: TenantScope;
}

export interface CollectionLifecycleDeps {
  collectionRepo: CollectionRepository;
  artefactRepo: ArtefactRepository;
  now?: () => Date;
}

export interface CascadeCounts {
  // Descendant collections affected (the node itself excluded).
  collections: number;
  // The owner's own artefacts affected across the subtree.
  artefacts: number;
  // Foreign artefacts evicted to top level instead of being touched.
  evicted: number;
}

// A contained artefact the collection owner doesn't own — a contributor's — is
// evicted to top level, untouched, whatever its status: no one's artefact is
// archived or deleted by another user's collection lifecycle. Returns null for
// the owner's own artefact, which the cascade then handles itself; otherwise
// whether the eviction was saved. The owner never changes, so the branch holds
// across a reload (S60).
// r[impl collections.lifecycle.cascades-evict-foreign]
async function evictIfForeign(
  repo: ArtefactRepository,
  artefact: Artefact,
  target: Collection,
  scope: TenantScope,
  subtreeIds: ReadonlySet<string>,
  now?: Date,
): Promise<boolean | null> {
  if (artefact.ownerId === target.ownerId) return null;
  return cascadeTo(repo, artefact, scope, subtreeIds, (a) =>
    evictFromCollection(a, now ? { now } : undefined),
  );
}

// Archive the subtree: every active descendant collection and every active
// artefact **of the collection owner's** within, after the foreign ones are
// evicted. Returns the cascade counts for the toast copy ("archived with N
// artefacts").
// r[impl collections.lifecycle.archive-cascades]
export async function archiveCollectionCommand(
  input: CollectionLifecycleInput,
  deps: CollectionLifecycleDeps,
): Promise<{ collection: Collection; cascade: CascadeCounts }> {
  const target = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const now = (deps.now ?? (() => new Date()))();

  const all = await deps.collectionRepo.listByOwner(target.ownerId, input.scope, {
    includeArchived: true,
  });
  const subtree = collectSubtree(all, target.id);

  let archivedRoot = target;
  for (const node of subtree) {
    if (node.status !== "active") continue; // already-archived descendants stay put
    const archived = archiveCollection(node, { now });
    await deps.collectionRepo.save(archived);
    if (node.id === target.id) archivedRoot = archived;
  }

  const subtreeIds = new Set(subtree.map((c) => c.id));
  const contained = await deps.artefactRepo.listByCollectionIds(
    [...subtreeIds],
    input.scope,
    { includeArchived: true },
  );
  let evicted = 0;
  let archivedCount = 0;
  // The status is decided on the reloaded copy inside `archive`, never on the listed one (S60).
  const archive = (a: Artefact) => (a.status === "active" ? archiveArtefact(a, { now }) : a);
  for (const artefact of contained) {
    const foreign = await evictIfForeign(
      deps.artefactRepo, artefact, target, input.scope, subtreeIds, now,
    );
    if (foreign !== null) {
      if (foreign) evicted += 1;
    } else if (await cascadeTo(deps.artefactRepo, artefact, input.scope, subtreeIds, archive)) {
      archivedCount += 1;
    }
  }

  return {
    collection: archivedRoot,
    cascade: {
      collections: subtree.length - 1,
      artefacts: archivedCount,
      evicted,
    },
  };
}

// Restore the subtree: every archived descendant collection and every
// archived artefact within — including ones archived individually beforehand
// (the cascade does not track provenance; documented simplification).
// r[impl collections.lifecycle.restore-cascades]
export async function restoreCollectionCommand(
  input: CollectionLifecycleInput,
  deps: CollectionLifecycleDeps,
): Promise<{ collection: Collection; cascade: CascadeCounts }> {
  const target = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const now = (deps.now ?? (() => new Date()))();

  const all = await deps.collectionRepo.listByOwner(target.ownerId, input.scope, {
    includeArchived: true,
  });
  const subtree = collectSubtree(all, target.id);

  let restoredRoot = restoreCollection(target, { now }); // guards non-archived
  assertRestorableIn(
    { kind: "collection", id: target.id, name: target.name, parentId: target.parentId },
    all,
  ); // before any save
  for (const node of subtree) {
    if (node.id === target.id) {
      await deps.collectionRepo.save(restoredRoot);
      continue;
    }
    if (node.status !== "archived") continue;
    await deps.collectionRepo.save(restoreCollection(node, { now }));
  }

  const subtreeIds = new Set(subtree.map((c) => c.id));
  const artefacts = await deps.artefactRepo.listByCollectionIds(
    [...subtreeIds],
    input.scope,
    { includeArchived: true },
  );
  let restoredArtefacts = 0;
  const restore = (a: Artefact) => (a.status === "archived" ? restoreArtefact(a, { now }) : a);
  // The status is decided on the reloaded copy inside `restore`, never on the listed one (S60).
  for (const artefact of artefacts) {
    if (await cascadeTo(deps.artefactRepo, artefact, input.scope, subtreeIds, restore)) {
      restoredArtefacts += 1;
    }
  }

  return {
    collection: restoredRoot,
    cascade: {
      collections: subtree.length - 1,
      artefacts: restoredArtefacts,
      // Evicted artefacts were never archived — restore has nothing to
      // re-attach (documented simplification).
      evicted: 0,
    },
  };
}

// Permanent delete — archived-only, cascading to every descendant collection
// and every artefact in the subtree; each artefact is erased fully per
// hosting.delete.removes-everything (payload file, data entries, view entries)
// plus its bookmarks (collections.bookmark.removed-with-target).
export interface DeleteCollectionDeps extends CollectionLifecycleDeps {
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  payloadStore: PayloadStore;
  bookmarkRepo: BookmarkRepository;
  // S35 — each erased artefact's thumbnail files go too (hosting.delete.removes-everything).
  thumbnailStore: ThumbnailStore;
}

// r[impl collections.lifecycle.delete-cascades]
export async function deleteCollectionCommand(
  input: CollectionLifecycleInput,
  deps: DeleteCollectionDeps,
): Promise<CascadeCounts> {
  const target = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  assertCollectionDeletable(target);

  const all = await deps.collectionRepo.listByOwner(target.ownerId, input.scope, {
    includeArchived: true,
  });
  const subtree = collectSubtree(all, target.id);

  const subtreeIds = new Set(subtree.map((c) => c.id));
  const contained = await deps.artefactRepo.listByCollectionIds(
    [...subtreeIds],
    input.scope,
    { includeArchived: true },
  );
  let evicted = 0;
  let deleted = 0;
  for (const artefact of contained) {
    // Never delete another owner's work. Without the eviction the row would
    // fall to the collection_id FK cascade.
    const foreign = await evictIfForeign(
      deps.artefactRepo, artefact, target, input.scope, subtreeIds,
    );
    if (foreign !== null) {
      if (foreign) evicted += 1;
      continue;
    }
    await deps.thumbnailStore.deleteAll(artefact.id); // derived data first (S35)
    await deps.payloadStore.delete(artefact.payloadRef);
    await deps.dataRepo.deleteByArtefact(artefact.id);
    await deps.viewRepo.deleteByArtefact(artefact.id);
    await deps.bookmarkRepo.deleteByArtefact(artefact.id);
    await deps.artefactRepo.delete(artefact.id);
    deleted += 1;
  }
  // Children before parents so the FK on parent_id never dangles mid-delete.
  for (const node of [...subtree].reverse()) {
    await deps.bookmarkRepo.deleteByCollection(node.id);
    await deps.collectionRepo.delete(node.id);
  }

  return { collections: subtree.length - 1, artefacts: deleted, evicted };
}
