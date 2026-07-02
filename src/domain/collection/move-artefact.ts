import type { Artefact } from "../artefact/artefact";
import { InvariantViolation } from "../artefact/errors";
import { CollectionInvariantViolation } from "./errors";
import type { Collection } from "./collection";

// Move an artefact into a collection, or back to top level (null). The one
// mutable edge of the containment model (collections themselves never re-parent,
// CL3). The artefact's own visibility/sharedWith are untouched — they lie
// dormant while contained (CL5/AH20) and resurface on the way out. Slug minting
// on an effective share (CL6/AH21) is the command's job (it needs a collision
// check); the archived guards are here.
export function moveArtefactToCollection(
  a: Artefact,
  collection: Collection | null,
  options?: { now?: Date },
): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot move an archived artefact"); // AH7
  }
  if (collection) {
    if (collection.ownerId !== a.ownerId) {
      throw new CollectionInvariantViolation(
        "an artefact may only be placed in its owner's collection", // CL1
      );
    }
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
