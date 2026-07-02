import type { Collection } from "./collection";

// S28/S29 — who may read a collection tree, and who may contribute to it.
// Both decisions are made against the tree **root** (CL4): nested nodes carry
// no access of their own.

// Viewer-facing collection reads (CL11). Same matrix semantics as artefacts
// (AH8) with two collection-specific rules: reads are **signed-in only** (there
// are no collection slugs — anonymous access stays artefact-link-only) and an
// archived root grants no one (the owner reaches it via their archive view,
// never this gate).
export function canViewCollection(
  root: Collection,
  viewerId: string | null,
): boolean {
  if (viewerId === null) return false;
  if (root.status !== "active") return false;
  switch (root.visibility) {
    case "public":
    case "authenticated":
      return true;
    case "selected":
      return viewerId === root.ownerId || root.sharedWith.includes(viewerId);
    case "private":
      return viewerId === root.ownerId;
  }
}

// Contributors (CL12): the owner, or a user on the root's access list who can
// also view the tree. The list is the gate at every tier — under
// `authenticated`/`public` roots it *is* the contributor list (tiers keep pure
// view semantics; no drive-by additions), and under a `private` root it grants
// nothing (its members cannot even view).
export function canContributeToTree(
  root: Collection,
  userId: string | null,
): boolean {
  if (userId === null) return false;
  if (userId === root.ownerId) return canViewCollection(root, userId);
  return root.sharedWith.includes(userId) && canViewCollection(root, userId);
}
