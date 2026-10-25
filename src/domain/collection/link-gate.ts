import {
  changedLinkGate,
  clearedGate,
  type LinkPasswordHasher,
  type SetLinkGateInput,
} from "../artefact/link-gate";
import { assertCollectionActive, type Collection } from "./collection";
import { CollectionInvariantViolation, CollectionNotFound } from "./errors";

// S32b — Link controls on public collections: password + expiry. The S32a link
// gate on a public tree root, which every artefact in the tree follows
// (`effectiveLinkGate`). The gate's own rules (password length, future expiry,
// version bumps) are S32a's `changedLinkGate`; this file owns where a
// collection may carry one.

// r[impl collections.link-gate.public-root-only]
function assertCollectionGateEditable(c: Collection, requesterId: string): void {
  // Not found, never forbidden: collections.access.no-existence-leak.
  if (requesterId !== c.ownerId) throw new CollectionNotFound(c.id);
  assertCollectionActive(c, "cannot change the link protection of an archived collection");
  if (c.parentId !== null) {
    throw new CollectionInvariantViolation(
      "link protection is set on the tree root — nested collections inherit it",
    );
  }
  if (c.visibility !== "public") {
    throw new CollectionInvariantViolation("link protection can only be set on a public collection");
  }
}

// Set either half of a public root's gate.
export async function setCollectionLinkGate(
  c: Collection,
  input: SetLinkGateInput,
  hasher: LinkPasswordHasher,
): Promise<Collection> {
  assertCollectionGateEditable(c, input.requesterId);
  const linkGate = await changedLinkGate(
    c.linkGate,
    input,
    hasher,
    (m) => new CollectionInvariantViolation(m),
  );
  return { ...c, linkGate, updatedAt: input.now };
}

// Clear both halves; bumps `version`, voiding every pass for the tree.
export function clearCollectionLinkGate(
  c: Collection,
  input: { requesterId: string; now: Date },
): Collection {
  assertCollectionGateEditable(c, input.requesterId);
  return { ...c, linkGate: clearedGate(c.linkGate), updatedAt: input.now };
}
