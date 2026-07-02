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
// shared artefacts — others' top-level artefacts whose own tier grants the
// viewer (the repo query, dormancy excluded there), plus others' artefacts
// inside trees whose root grants the viewer. Collections themselves are never
// surfaced to non-owners (owner-only UI, CL10) — their artefacts appear
// individually, exactly like directly-shared ones.
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

  const roots = await deps.collectionRepo.listSharedRoots(viewerId, scope);
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
  ).map((artefact) => ({
    artefact,
    effectiveVisibility:
      rootById.get(rootOfCollection.get(artefact.collectionId ?? "") ?? "")
        ?.visibility ?? ("private" as Visibility),
  }));

  return [...topLevel, ...inTrees].sort(
    (a, b) => b.artefact.updatedAt.getTime() - a.artefact.updatedAt.getTime(),
  );
}
