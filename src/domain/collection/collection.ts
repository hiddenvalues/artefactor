import { CollectionInvariantViolation } from "./errors";
import { DEFAULT_TENANT } from "../artefact/artefact";
import type { Status, Visibility } from "../artefact/visibility";

// Artefact Collections (ddd/artefact-collections.md) — a nestable folder node.
// The tree root's (visibility, sharedWith) governs the effective access of
// everything inside (CL4/CL5); a non-root's own access fields are carried but
// never consulted, exactly like `sharedWith` outside the `selected` tier.
export interface Collection {
  id: string;
  ownerId: string;
  // As on Artefact (AH17). Immutable; OSS: DEFAULT_TENANT.
  tenantId: string;
  name: string;
  // Nesting. null = top-level (a root). Immutable — v1 has no re-parenting
  // (CL3), which rules out cycles by construction.
  parentId: string | null;
  // The tree root: own id for a root, else the parent's rootId. Immutable and
  // therefore safe to denormalize — effective access resolves in two lookups
  // instead of a recursive walk (CL4).
  rootId: string;
  // Consulted only on a root (CL4).
  visibility: Visibility;
  // The `selected`-tier access list, AH13/14 semantics. Consulted only on a
  // root while `visibility === "selected"`.
  sharedWith: readonly string[];
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateCollectionInput {
  id: string;
  ownerId: string;
  name: string;
  // The parent node when nesting; null/omitted for a top-level collection.
  parent?: Collection | null;
  // Meaningful on roots only (CL4); a nested collection carries it unconsulted.
  visibility?: Visibility;
  tenantId?: string;
  now?: Date;
}

// Factory enforcing the create-time invariants (CL1–CL3). A new collection is
// always active; its shape (parentId/rootId) is fixed for life.
export function createCollection(input: CreateCollectionInput): Collection {
  if (!input.ownerId) {
    throw new CollectionInvariantViolation("ownerId is required"); // CL1
  }
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CollectionInvariantViolation("name must not be empty"); // CL2
  }

  const parent = input.parent ?? null;
  const tenantId = input.tenantId ?? DEFAULT_TENANT;
  if (parent) {
    if (parent.ownerId !== input.ownerId) {
      throw new CollectionInvariantViolation(
        "a collection tree never spans owners", // CL1
      );
    }
    if (parent.tenantId !== tenantId) {
      throw new CollectionInvariantViolation(
        "a collection tree never spans tenants", // CL1
      );
    }
    if (parent.status !== "active") {
      throw new CollectionInvariantViolation(
        "cannot create a collection under an archived collection", // CL3/CL7
      );
    }
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    ownerId: input.ownerId,
    tenantId,
    name,
    parentId: parent?.id ?? null,
    rootId: parent?.rootId ?? input.id, // CL3 — fixed for life
    visibility: input.visibility ?? "private",
    sharedWith: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

// Rename (CL2). Blocked while archived (CL7 — an archived collection is inert).
export function renameCollection(
  c: Collection,
  name: string,
  options?: { now?: Date },
): Collection {
  if (c.status === "archived") {
    throw new CollectionInvariantViolation("cannot rename an archived collection"); // CL7
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new CollectionInvariantViolation("name must not be empty"); // CL2
  }
  return { ...c, name: trimmed, updatedAt: options?.now ?? new Date() };
}

// Change the access tier of a tree (CL4). Roots only — a nested collection is
// uniformly "Inherited" and has no access of its own to change. Blocked while
// archived (CL7). Slug back-fill across the subtree (CL6/AH21) is the command's
// job — it needs the artefacts.
export function setCollectionAccess(
  c: Collection,
  visibility: Visibility,
  options?: { now?: Date },
): Collection {
  if (c.status === "archived") {
    throw new CollectionInvariantViolation(
      "cannot change access of an archived collection", // CL7
    );
  }
  if (c.parentId !== null) {
    throw new CollectionInvariantViolation(
      "access is set on the tree root — nested collections inherit it", // CL4
    );
  }
  if (c.visibility === visibility) return c;
  return { ...c, visibility, updatedAt: options?.now ?? new Date() };
}

// Grant / revoke on the `selected`-tier access list — the AH13/14 semantics,
// applied to a collection root (CL4). Set semantics; the owner is never a
// member; inert while archived.
export function grantCollectionAccess(
  c: Collection,
  userId: string,
  now?: Date,
): Collection {
  if (c.status === "archived") {
    throw new CollectionInvariantViolation(
      "cannot change access of an archived collection", // CL7
    );
  }
  if (c.parentId !== null) {
    throw new CollectionInvariantViolation(
      "access is set on the tree root — nested collections inherit it", // CL4
    );
  }
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
  if (c.status === "archived") {
    throw new CollectionInvariantViolation(
      "cannot change access of an archived collection", // CL7
    );
  }
  if (!c.sharedWith.includes(userId)) return c; // set semantics
  return {
    ...c,
    sharedWith: c.sharedWith.filter((id) => id !== userId),
    updatedAt: now ?? new Date(),
  };
}

// Archive / restore one node (CL7). The subtree cascade — applying these to
// every descendant and the artefacts inside — is the command's job.
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

// Permanent-delete guard (CL8) — archived-only, like AH11.
export function assertCollectionDeletable(c: Collection): void {
  if (c.status !== "archived") {
    throw new CollectionInvariantViolation(
      "only an archived collection can be deleted",
    );
  }
}
