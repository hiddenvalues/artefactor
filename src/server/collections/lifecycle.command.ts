import {
  archiveCollection,
  assertCollectionDeletable,
  restoreCollection,
  type Collection,
} from "../../domain/collection/collection";
import { collectSubtree } from "../../domain/collection/tree";
import {
  archiveArtefact,
  restoreArtefact,
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

// Application commands for S26 — collection lifecycle cascades (CL7/CL8).
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
  // Foreign artefacts evicted to top level instead of being touched (CL14).
  evicted: number;
}

// Archive the subtree (CL7): every active descendant collection and every
// active artefact **of the collection owner's** within. Foreign artefacts —
// contributors' (CL12) — are first evicted to top level, whatever their status:
// no one's artefact is archived by another user's lifecycle (CL14). Returns the
// cascade counts for the toast copy ("archived with N artefacts").
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

  const contained = await deps.artefactRepo.listByCollectionIds(
    subtree.map((c) => c.id),
    input.scope,
    { includeArchived: true },
  );
  let evicted = 0;
  let archivedCount = 0;
  for (const artefact of contained) {
    if (artefact.ownerId !== target.ownerId) {
      await deps.artefactRepo.save(evictFromCollection(artefact, { now })); // CL14
      evicted += 1;
    } else if (artefact.status === "active") {
      await deps.artefactRepo.save(archiveArtefact(artefact, { now }));
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

// Restore the subtree (CL7): every archived descendant collection and every
// archived artefact within — including ones archived individually beforehand
// (the cascade does not track provenance; documented simplification).
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
  for (const node of subtree) {
    if (node.id === target.id) {
      await deps.collectionRepo.save(restoredRoot);
      continue;
    }
    if (node.status !== "archived") continue;
    await deps.collectionRepo.save(restoreCollection(node, { now }));
  }

  const artefacts = await deps.artefactRepo.listByCollectionIds(
    subtree.map((c) => c.id),
    input.scope,
    { includeArchived: true },
  );
  let restoredArtefacts = 0;
  for (const artefact of artefacts) {
    if (artefact.status !== "archived") continue;
    await deps.artefactRepo.save(restoreArtefact(artefact, { now }));
    restoredArtefacts += 1;
  }

  return {
    collection: restoredRoot,
    cascade: {
      collections: subtree.length - 1,
      artefacts: restoredArtefacts,
      // Evicted artefacts were never archived — restore has nothing to
      // re-attach (CL14, documented simplification).
      evicted: 0,
    },
  };
}

// Permanent delete (CL8) — archived-only, cascading to every descendant
// collection and every artefact in the subtree; each artefact is erased fully
// per AH11 (payload file, data entries, view entries) plus its bookmarks (BM4).
export interface DeleteCollectionDeps extends CollectionLifecycleDeps {
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  payloadStore: PayloadStore;
  bookmarkRepo: BookmarkRepository;
  // S35 — each erased artefact's thumbnail files go too (AH11).
  thumbnailStore: ThumbnailStore;
}

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

  const contained = await deps.artefactRepo.listByCollectionIds(
    subtree.map((c) => c.id),
    input.scope,
    { includeArchived: true },
  );
  let evicted = 0;
  let deleted = 0;
  for (const artefact of contained) {
    if (artefact.ownerId !== target.ownerId) {
      // Never delete another owner's work — evict it untouched (CL14). Without
      // this the row would fall to the collection_id FK cascade.
      await deps.artefactRepo.save(evictFromCollection(artefact));
      evicted += 1;
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
