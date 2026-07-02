import type { Artefact } from "../../domain/artefact/artefact";
import type { Visibility } from "../../domain/artefact/visibility";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

export interface EffectivelySharedArtefact {
  artefact: Artefact;
  // The tier the artefact is served under (AH20) — its own for a top-level
  // artefact, the tree root's for a contained one.
  effectiveVisibility: Visibility;
}

// S14 under collections (AH20/CL5): "Shared with you" lists **effectively**
// shared artefacts — *others'* artefacts the viewer can open. Three sources:
// others' top-level artefacts whose own tier grants the viewer (the repo query,
// dormancy excluded there); others' artefacts inside trees whose root grants
// the viewer; and — with contributors (S29/CL12) — others' artefacts inside the
// viewer's **own** trees. The viewer's own artefacts never appear (they live in
// "Your artefacts"), including ones they contributed into someone else's tree.
export async function listEffectivelyShared(
  viewerId: string,
  scope: TenantScope,
  deps: {
    artefactRepo: ArtefactRepository;
    collectionRepo: CollectionRepository;
  },
): Promise<EffectivelySharedArtefact[]> {
  const topLevel = (await deps.artefactRepo.listShared(viewerId, scope)).map(
    (artefact) => ({ artefact, effectiveVisibility: artefact.visibility }),
  );

  // Trees granting the viewer: shared-to-them roots plus their own roots (the
  // owner always views their tree — where contributors' artefacts live, CL13).
  const sharedRoots = await deps.collectionRepo.listSharedRoots(viewerId, scope);
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
