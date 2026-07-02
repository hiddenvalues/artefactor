import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { canContributeToTree } from "../../domain/collection/collection-access";

// S28 — the collection trees shared *to* a viewer (CL11): every node of every
// tree whose root grants them, with the per-tree contributor flag (CL12). The
// nodes are returned with **empty `sharedWith`** (recipients never see the
// grantee list); the contributor decision is made here against the fully-loaded
// root and shipped as a boolean instead.
export interface SharedCollectionNode {
  collection: Collection;
  canContribute: boolean;
}

export async function listSharedCollections(
  viewerId: string,
  scope: TenantScope,
  deps: { collectionRepo: CollectionRepository },
): Promise<SharedCollectionNode[]> {
  const roots = await deps.collectionRepo.listSharedRoots(viewerId, scope);
  if (roots.length === 0) return [];

  // listSharedRoots strips sharedWith (privacy) — re-load each root fully for
  // the contributor check only; the flag is what leaves the server.
  const contributeByRoot = new Map<string, boolean>();
  for (const r of roots) {
    const full = await deps.collectionRepo.findById(r.id, scope);
    contributeByRoot.set(r.id, full ? canContributeToTree(full, viewerId) : false);
  }

  const trees = await deps.collectionRepo.listByRoots(
    roots.map((r) => r.id),
    scope,
  );
  return trees.map((collection) => ({
    collection,
    canContribute: contributeByRoot.get(collection.rootId) ?? false,
  }));
}
