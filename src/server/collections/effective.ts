import type { Artefact } from "../../domain/artefact/artefact";
import type { ViewableArtefact } from "../../domain/artefact/access";
import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { effectiveViewable } from "../../domain/collection/effective-access";

// Resolve an artefact's collection tree root — two lookups via the immutable
// rootId (CL4). Scoped by the artefact's own tenant: the serve path is
// slug-addressed and tenant-global (AH6), so the artefact, not the request,
// names the tenant its tree lives in.
export async function loadArtefactRoot(
  artefact: Artefact,
  collectionRepo: CollectionRepository,
): Promise<Collection | null> {
  if (artefact.collectionId === null) return null;
  const scope = { tenantId: artefact.tenantId };
  const direct = await collectionRepo.findById(artefact.collectionId, scope);
  if (!direct) return null;
  if (direct.parentId === null) return direct;
  return collectionRepo.findById(direct.rootId, scope);
}

// The viewer-facing slice the unchanged access matrix takes, with the
// collection inheritance resolved (CL5/AH20). If the chain cannot be resolved
// (a data anomaly the FKs should prevent), fail closed: treat as private —
// never let a dormant own-tier leak through.
export async function resolveEffectiveViewable(
  artefact: Artefact,
  collectionRepo: CollectionRepository,
): Promise<ViewableArtefact> {
  if (artefact.collectionId === null) return artefact;
  const root = await loadArtefactRoot(artefact, collectionRepo);
  if (root === null) {
    return {
      status: artefact.status,
      ownerId: artefact.ownerId,
      tenantId: artefact.tenantId,
      visibility: "private",
      sharedWith: [],
    };
  }
  return effectiveViewable(artefact, root);
}
