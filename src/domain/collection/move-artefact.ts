import type { Artefact } from "../artefact/artefact";
import { changed } from "../artefact/changed";
import { InvariantViolation } from "../artefact/errors";
import { CollectionInvariantViolation } from "./errors";
import { assertCollectionActive, type Collection } from "./collection";

// Move an artefact into a collection, or back to top level (null). The one mutable edge of the
// containment model (collections themselves never re-parent, collections.tree.shape-fixed). The
// artefact's own visibility/sharedWith are untouched — they lie dormant while contained
// (collections.access.contained-own-tier-dormant) and resurface on the way out. Slug minting on an
// effective share (hosting.slug.minted-on-move-into-shared-tree) and the placement *authority* —
// own collection, or contributor of the target's root
// (hosting.collection.move-into-own-or-contributed) — are the command's job; the tenant and
// archived guards are here.
export function moveArtefactToCollection(
  a: Artefact,
  collection: Collection | null,
  options?: { now?: Date },
): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot move an archived artefact"); // hosting.lifecycle.archived-frozen
  }
  if (collection) {
    // r[impl hosting.collection.same-tenant]
    if (collection.tenantId !== a.tenantId) {
      throw new CollectionInvariantViolation(
        "an artefact may only be placed in a collection of its tenant",
      );
    }
    assertCollectionActive(collection, "cannot move an artefact into an archived collection");
  }
  const collectionId = collection?.id ?? null;
  if (collectionId === a.collectionId) return a; // no-op move
  return changed(a, { collectionId }, options?.now);
}

// Containment termination — ejection by the collection owner
// (collections.containment.co-owned), and the evict step of the lifecycle
// cascades (collections.lifecycle.cascades-evict-foreign). Deliberately guard-free: unlike a
// user move it must work on an **archived** artefact (evicting foreign
// artefacts while archiving a tree) and it never increases exposure — the
// artefact falls back to its dormant own tier.
export function evictFromCollection(
  a: Artefact,
  options?: { now?: Date },
): Artefact {
  if (a.collectionId === null) return a;
  return changed(a, { collectionId: null }, options?.now);
}
