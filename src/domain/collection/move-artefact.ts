import type { Artefact } from "../artefact/artefact";
import { InvariantViolation } from "../artefact/errors";
import { CollectionInvariantViolation } from "./errors";
import type { Collection } from "./collection";

// Move an artefact into a collection, or back to top level (null). The one
// mutable edge of the containment model (collections themselves never re-parent,
// CL3). The artefact's own visibility/sharedWith are untouched — they lie
// dormant while contained (CL5/AH20) and resurface on the way out. Slug minting
// on an effective share (CL6/AH21) and the placement *authority* — own
// collection, or contributor of the target's root (CL1/CL12) — are the
// command's job; the tenant and archived guards are here.
export function moveArtefactToCollection(
  a: Artefact,
  collection: Collection | null,
  options?: { now?: Date },
): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot move an archived artefact"); // AH7
  }
  if (collection) {
    if (collection.tenantId !== a.tenantId) {
      throw new CollectionInvariantViolation(
        "an artefact may only be placed in a collection of its tenant", // CL1
      );
    }
    if (collection.status !== "active") {
      throw new CollectionInvariantViolation(
        "cannot move an artefact into an archived collection", // CL7
      );
    }
  }
  const collectionId = collection?.id ?? null;
  if (collectionId === a.collectionId) return a; // no-op move
  return { ...a, collectionId, updatedAt: options?.now ?? new Date() };
}

// Containment termination (CL13/CL14) — ejection by the collection owner, and
// the evict step of the lifecycle cascades. Deliberately guard-free: unlike a
// user move it must work on an **archived** artefact (evicting foreign
// artefacts while archiving a tree) and it never increases exposure — the
// artefact falls back to its dormant own tier.
export function evictFromCollection(
  a: Artefact,
  options?: { now?: Date },
): Artefact {
  if (a.collectionId === null) return a;
  return { ...a, collectionId: null, updatedAt: options?.now ?? new Date() };
}
