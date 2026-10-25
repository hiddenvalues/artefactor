import type { Artefact } from "../../domain/artefact/artefact";
import type { ViewableArtefact } from "../../domain/artefact/access";
import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { NO_LINK_GATE } from "../../domain/artefact/link-gate";
import {
  effectiveLinkGate,
  effectiveViewable,
  type EffectiveLinkGate,
} from "../../domain/collection/effective-access";

// Resolve an artefact's collection tree root — two lookups via the immutable
// rootId (collections.access.root-governs-tree). Scoped by the artefact's own tenant: the serve path is
// slug-addressed and tenant-global (hosting.slug.globally-unique), so the
// artefact, not the request, names the tenant its tree lives in.
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

// The viewer-facing slice the unchanged access matrix takes, with the collection inheritance
// resolved (hosting.access.effective-from-tree-root). If the chain cannot be resolved (a data
// anomaly the FKs should prevent), fail closed: treat as private — never let a dormant own-tier
// leak through (`resolveEffectiveRead`).
export async function resolveEffectiveViewable(
  artefact: Artefact,
  collectionRepo: CollectionRepository,
): Promise<ViewableArtefact> {
  return (await resolveEffectiveRead(artefact, collectionRepo)).viewable;
}

// What a read of the artefact is decided on: its effective access, and the
// link gate it follows with that gate's holder (S32b) — both from the one root
// lookup.
export interface EffectiveRead {
  viewable: ViewableArtefact;
  linkGate: EffectiveLinkGate;
}

export async function resolveEffectiveRead(
  artefact: Artefact,
  collectionRepo: CollectionRepository,
): Promise<EffectiveRead> {
  if (artefact.collectionId === null) {
    return { viewable: artefact, linkGate: effectiveLinkGate(artefact, null) };
  }
  const root = await loadArtefactRoot(artefact, collectionRepo);
  // r[impl collections.access.unresolvable-chain-fails-closed]
  if (root === null) {
    return {
      viewable: {
        status: artefact.status,
        ownerId: artefact.ownerId,
        tenantId: artefact.tenantId,
        visibility: "private",
        sharedWith: [],
      },
      // Private, so no gate is ever consulted; never the dormant own gate.
      linkGate: { holderId: artefact.id, gate: NO_LINK_GATE },
    };
  }
  return { viewable: effectiveViewable(artefact, root), linkGate: effectiveLinkGate(artefact, root) };
}
