import type { Artefact } from "../../domain/artefact/artefact";
import type { Visibility } from "../../domain/artefact/visibility";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import { authorizeRead, memoizedPolicy } from "../link-gate/authorize";
import { listGrantedSharedRoots } from "./shared-collections.query";
import type { PassLookup } from "../link-gate/passes";

export interface EffectivelySharedArtefact {
  artefact: Artefact;
  // The tier the artefact is served under (hosting.access.effective-from-tree-root) — its own for a
  // top-level artefact, the tree root's for a contained one.
  effectiveVisibility: Visibility;
}

// S14 under collections (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant): "Shared with you" lists
// **effectively** shared artefacts — *others'* artefacts the viewer can open. Three sources:
// others' top-level artefacts whose own tier grants the viewer (the repo query, dormancy excluded
// there); others' artefacts inside trees whose root grants the viewer; and — with contributors
// (S29/collections.contributor.on-root-access-list) — others' artefacts inside the viewer's **own** trees. The viewer's own artefacts
// never appear (they live in "Your artefacts"), including ones they contributed into someone else's
// tree. The repo queries yield tier-based candidates only (SQL cannot ask the policy): each one is
// kept only when the one read decision grants it — the access policy, then the link gate with the
// request's passes — a top-level artefact by its own gate, a shared tree by its root's.
// r[impl hosting.shared.lists-effectively-shared]
// r[impl hosting.shared.others-viewable+2]
export async function listEffectivelyShared(
  viewerId: string,
  scope: TenantScope,
  deps: {
    artefactRepo: ArtefactRepository;
    collectionRepo: CollectionRepository;
    accessPolicy?: AccessPolicy;
  },
  options: { passes?: PassLookup } = {},
): Promise<EffectivelySharedArtefact[]> {
  // One policy answer per (viewer, tenant) for the whole listing.
  const decide = {
    collectionRepo: deps.collectionRepo,
    accessPolicy: memoizedPolicy(deps.accessPolicy ?? defaultAccessPolicy),
  };
  // The candidate rows ship with an empty grantee list (recipients never see it); each decision
  // re-loads the full aggregate, whose `sharedWith` the matrix's member cell reads.
  const topLevel: EffectivelySharedArtefact[] = [];
  for (const artefact of await deps.artefactRepo.listShared(viewerId, scope)) {
    const full = await deps.artefactRepo.findById(artefact.id, scope);
    if (!full) continue;
    const verdict = await authorizeRead(decide, full, viewerId, { passes: options.passes });
    if (verdict === "granted") {
      topLevel.push({ artefact, effectiveVisibility: artefact.visibility });
    }
  }

  // Trees granting the viewer: shared-to-them roots the read decision grants (one decision per
  // root, sharing this listing's policy answers), plus their own roots (the owner is never refused
  // — where contributors' artefacts live, collections.containment.co-owned). The roots stay
  // server-side: only their ids and tiers shape the result.
  const sharedRoots = await listGrantedSharedRoots(viewerId, scope, decide, options);
  const ownRoots = (
    await deps.collectionRepo.listByOwner(viewerId, scope)
  ).filter((c) => c.parentId === null);
  const roots = [...sharedRoots, ...ownRoots];
  if (roots.length === 0) return topLevel;

  const rootById = new Map(roots.map((r) => [r.id, r]));
  const trees = await deps.collectionRepo.listByRoots(
    roots.map((r) => r.id),
    scope,
  );
  const rootOfCollection = new Map(trees.map((t) => [t.id, t.rootId]));
  const inTrees = (
    await deps.artefactRepo.listByCollectionIds(
      trees.map((t) => t.id),
      scope,
    )
  )
    // "Shared with you" means others' work (S14) — the viewer's own artefacts,
    // including ones contributed into another owner's tree, are excluded.
    .filter((artefact) => artefact.ownerId !== viewerId)
    .map((artefact) => ({
      artefact,
      effectiveVisibility:
        rootById.get(rootOfCollection.get(artefact.collectionId ?? "") ?? "")
          ?.visibility ?? ("private" as Visibility),
    }));

  return [...topLevel, ...inTrees].sort(
    (a, b) => b.artefact.updatedAt.getTime() - a.artefact.updatedAt.getTime(),
  );
}
