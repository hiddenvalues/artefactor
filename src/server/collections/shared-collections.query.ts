import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import { canContributeToTree } from "../../domain/collection/collection-access";
import { decideCollectionRead, memoizedPolicy } from "../link-gate/authorize";
import type { PassLookup } from "../link-gate/passes";

// S28 — the collection trees shared *to* a viewer (collections.read.follows-root): every node of every
// tree whose root the one read decision grants them — the access policy and the root's link gate,
// with the request's passes — with the per-tree contributor flag
// (collections.contributor.on-root-access-list). The nodes are returned with **empty `sharedWith`**
// (recipients never see the grantee list); the contributor decision is made here against the
// fully-loaded root and shipped as a boolean instead.
export interface SharedCollectionNode {
  collection: Collection;
  canContribute: boolean;
}

// The other owners' tree roots the one read decision grants the viewer (collections.read.follows-root):
// `listSharedRoots` yields the tier-based candidates (SQL cannot ask the policy), each re-loaded
// fully — the candidates ship with an empty `sharedWith`, which the matrix's member cell and the
// contributor rule read — then decided with the request's passes, asking the policy once per
// (viewer, tenant). Refused roots read as missing (collections.access.no-existence-leak). The
// returned roots carry their full `sharedWith`: never ship them to the viewer as they are.
export async function listGrantedSharedRoots(
  viewerId: string,
  scope: TenantScope,
  deps: { collectionRepo: CollectionRepository; accessPolicy?: AccessPolicy },
  options: { passes?: PassLookup } = {},
): Promise<Collection[]> {
  const decide = {
    collectionRepo: deps.collectionRepo,
    accessPolicy: memoizedPolicy(deps.accessPolicy ?? defaultAccessPolicy),
  };
  const granted: Collection[] = [];
  for (const candidate of await deps.collectionRepo.listSharedRoots(viewerId, scope)) {
    const root = await deps.collectionRepo.findById(candidate.id, scope);
    if (!root) continue;
    const decision = await decideCollectionRead(decide, root, viewerId, {
      scope,
      passes: options.passes,
    });
    if (decision.granted) granted.push(root);
  }
  return granted;
}

export async function listSharedCollections(
  viewerId: string,
  scope: TenantScope,
  deps: { collectionRepo: CollectionRepository; accessPolicy?: AccessPolicy },
  options: { passes?: PassLookup } = {},
): Promise<SharedCollectionNode[]> {
  // The flag is decided on the fully-loaded root; only the flag leaves the server.
  const contributeByRoot = new Map<string, boolean>();
  for (const root of await listGrantedSharedRoots(viewerId, scope, deps, options)) {
    contributeByRoot.set(root.id, canContributeToTree(root, viewerId, true));
  }
  if (contributeByRoot.size === 0) return [];

  const trees = await deps.collectionRepo.listByRoots([...contributeByRoot.keys()], scope);
  return trees.map((collection) => ({
    collection,
    canContribute: contributeByRoot.get(collection.rootId) ?? false,
  }));
}
