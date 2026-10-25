import { CollectionInvariantViolation, RestoreUnderArchivedCollection } from "./errors";
import { normalizeDescription } from "./description";
import { chainToRoot } from "./tree";
import { DEFAULT_TENANT } from "../artefact/artefact";
import { NO_LINK_GATE, clearedGate, type LinkGate } from "../artefact/link-gate";
import type { Status, Visibility } from "../artefact/visibility";

// Artefact Collections (ddd/artefact-collections.md) — a nestable folder node.
// The tree root's (visibility, sharedWith) governs the effective access of
// everything inside (collections.access.root-governs-tree); a non-root's own
// access fields are carried but never consulted, exactly like `sharedWith`
// outside the `selected` tier.
export interface Collection {
  id: string;
  ownerId: string;
  // As on Artefact (hosting.tenant.invisible-to-oss). Immutable; OSS: DEFAULT_TENANT.
  tenantId: string;
  name: string;
  // S74 — an optional plain-text blurb, trimmed; null = none
  // (collections.collection.description).
  description: string | null;
  // Nesting. null = top-level (a root). Immutable — v1 has no re-parenting
  // (collections.tree.shape-fixed), which rules out cycles by construction.
  parentId: string | null;
  // The tree root: own id for a root, else the parent's rootId. Immutable and
  // therefore safe to denormalize — effective access resolves in two lookups
  // instead of a recursive walk.
  rootId: string;
  // Consulted only on a root (collections.access.root-governs-tree).
  visibility: Visibility;
  // The `selected`-tier access list, hosting.access-list.retained,
  // hosting.access-list.owner-managed-set semantics. Consulted only on a root
  // while `visibility === "selected"`.
  sharedWith: readonly string[];
  // S44 — a root's retained address, minted on its first transition to a shared
  // tier and never cleared (as hosting.slug.minted-once-retained). Always null on
  // a non-root.
  publicSlug: string | null;
  // S32b — the link gate of a public root, which its whole tree follows
  // (`collections.link-gate.root-governs-tree`). Consulted only on a root.
  linkGate: LinkGate;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateCollectionInput {
  id: string;
  ownerId: string;
  name: string;
  description?: string | null;
  // The parent node when nesting; null/omitted for a top-level collection.
  parent?: Collection | null;
  // Roots only (collections.access.set-on-root-only): refused with a parent.
  visibility?: Visibility;
  tenantId?: string;
  now?: Date;
}

// r[impl collections.collection.name-required]
function requiredName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new CollectionInvariantViolation("name must not be empty");
  }
  return trimmed;
}

// An archived collection is inert: every change to it, and every change that
// would add to it, is refused.
// r[impl collections.lifecycle.archived-inert+3]
export function assertCollectionActive(c: Collection, refusal: string): void {
  if (c.status !== "active") throw new CollectionInvariantViolation(refusal);
}

// Access is decided at the tree root; a nested collection has none of its own,
// neither set later nor given at create.
// r[impl collections.access.set-on-root-only+2]
function assertRoot(
  parentId: string | null,
  refusal = "access is set on the tree root — nested collections inherit it",
): void {
  if (parentId !== null) throw new CollectionInvariantViolation(refusal);
}

// Factory enforcing the create-time invariants. A new collection is always
// active; its shape (parentId/rootId) is fixed for life.
// r[impl collections.tree.shape-fixed]
export function createCollection(input: CreateCollectionInput): Collection {
  if (!input.ownerId) {
    throw new CollectionInvariantViolation("ownerId is required");
  }
  const name = requiredName(input.name);
  const description = normalizeDescription(input.description);

  const parent = input.parent ?? null;
  const tenantId = input.tenantId ?? DEFAULT_TENANT;
  if (parent) {
    // r[impl collections.tree.single-owner]
    if (parent.ownerId !== input.ownerId) {
      throw new CollectionInvariantViolation(
        "a collection tree never spans owners",
      );
    }
    if (parent.tenantId !== tenantId) {
      throw new CollectionInvariantViolation(
        "a collection tree never spans tenants",
      );
    }
    assertCollectionActive(parent, "cannot create a collection under an archived collection");
  }
  if (input.visibility !== undefined) {
    assertRoot(
      parent?.id ?? null,
      "a nested collection takes its tree root's tier — omit visibility, or set the root's",
    );
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    ownerId: input.ownerId,
    tenantId,
    name,
    description,
    parentId: parent?.id ?? null,
    rootId: parent?.rootId ?? input.id, // fixed for life
    visibility: input.visibility ?? "private",
    sharedWith: [],
    publicSlug: null,
    linkGate: NO_LINK_GATE,
    status: "active",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

// Rename. Blocked while archived.
export function renameCollection(
  c: Collection,
  name: string,
  options?: { now?: Date },
): Collection {
  assertCollectionActive(c, "cannot rename an archived collection");
  return { ...c, name: requiredName(name), updatedAt: options?.now ?? new Date() };
}

// S74 — set or clear the description. Blocked while archived.
export function describeCollection(
  c: Collection,
  description: string | null,
  options?: { now?: Date },
): Collection {
  assertCollectionActive(c, "cannot edit an archived collection");
  return {
    ...c,
    description: normalizeDescription(description),
    updatedAt: options?.now ?? new Date(),
  };
}

// Change the access tier of a tree. Roots only — a nested collection is uniformly "Inherited" and
// has no access of its own to change. Blocked while archived. Slug back-fill across the subtree
// (hosting.slug.minted-on-root-share) is the command's job — it needs the artefacts.
export function setCollectionAccess(
  c: Collection,
  visibility: Visibility,
  options?: { now?: Date },
): Collection {
  assertCollectionActive(c, "cannot change access of an archived collection");
  assertRoot(c.parentId);
  if (c.visibility === visibility) return c;
  // r[impl collections.link-gate.cleared-leaving-public]
  const linkGate = visibility === "public" ? c.linkGate : clearedGate(c.linkGate);
  return { ...c, visibility, linkGate, updatedAt: options?.now ?? new Date() };
}

// S44 — give a root its slug. The command generates and collision-checks it;
// a non-root is reached through its root and never has one, and a minted slug
// is retained (`setCollectionAccess` leaves it untouched).
export function assignCollectionSlug(c: Collection, slug: string): Collection {
  if (c.parentId !== null) {
    throw new CollectionInvariantViolation("only a root collection has a slug");
  }
  if (c.publicSlug !== null) {
    throw new CollectionInvariantViolation("a collection slug is minted once and retained");
  }
  return { ...c, publicSlug: slug };
}

// Grant / revoke on the `selected`-tier access list — the
// hosting.access-list.retained, hosting.access-list.owner-managed-set semantics,
// applied to a collection root. Set semantics; the owner is never a member;
// inert while archived.
export function grantCollectionAccess(
  c: Collection,
  userId: string,
  now?: Date,
): Collection {
  assertCollectionActive(c, "cannot change access of an archived collection");
  assertRoot(c.parentId);
  if (userId === c.ownerId) {
    throw new CollectionInvariantViolation("the owner always has access");
  }
  if (c.sharedWith.includes(userId)) return c; // set semantics
  return {
    ...c,
    sharedWith: [...c.sharedWith, userId],
    updatedAt: now ?? new Date(),
  };
}

export function revokeCollectionAccess(
  c: Collection,
  userId: string,
  now?: Date,
): Collection {
  assertCollectionActive(c, "cannot change access of an archived collection");
  if (!c.sharedWith.includes(userId)) return c; // set semantics
  return {
    ...c,
    sharedWith: c.sharedWith.filter((id) => id !== userId),
    updatedAt: now ?? new Date(),
  };
}

// Archive / restore one node. The subtree cascade — applying these to every
// descendant and the artefacts inside — is the command's job.
export function archiveCollection(
  c: Collection,
  options?: { now?: Date },
): Collection {
  if (c.status === "archived") {
    throw new CollectionInvariantViolation("collection is already archived");
  }
  const now = options?.now ?? new Date();
  return { ...c, status: "archived", archivedAt: now, updatedAt: now };
}

export function restoreCollection(
  c: Collection,
  options?: { now?: Date },
): Collection {
  if (c.status !== "archived") {
    throw new CollectionInvariantViolation(
      "only an archived collection can be restored",
    );
  }
  const now = options?.now ?? new Date();
  return { ...c, status: "active", archivedAt: null, updatedAt: now };
}

// What a restore is checked for: a collection (its chain starts at its parent)
// or an artefact (its chain starts at its own collection), named for the refusal.
export interface RestoreTarget {
  kind: "collection" | "artefact";
  id: string;
  name: string;
  parentId: string | null;
}

// An item under an archived collection is restored only with it: alone it
// would sit active inside an inert tree. `tree` is the owner's collections,
// archived ones included; the refusal names the topmost archived collection.
// r[impl collections.lifecycle.restore-under-active-parent+2]
export function assertRestorableIn(
  target: RestoreTarget,
  tree: readonly Collection[],
): void {
  if (target.parentId === null) return;
  const archived = chainToRoot(tree, target.parentId)
    .reverse()
    .find((c) => c.status === "archived");
  if (archived) {
    throw new RestoreUnderArchivedCollection(
      { kind: target.kind, id: target.id, name: target.name },
      { id: archived.id, name: archived.name },
    );
  }
}

// Permanent-delete guard — archived-only, like hosting.delete.archived-only.
// r[impl collections.lifecycle.delete-archived-only]
export function assertCollectionDeletable(c: Collection): void {
  if (c.status !== "archived") {
    throw new CollectionInvariantViolation(
      "only an archived collection can be deleted",
    );
  }
}
