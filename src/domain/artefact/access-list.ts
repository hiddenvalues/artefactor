import { InvariantViolation } from "./errors";
import { assertNotArchived, type Artefact } from "./artefact";
import { changed } from "./changed";

// Pure transitions for the `selected`-tier access list. The list is a **set** of
// user ids: granting an existing member or revoking a non-member is a no-op
// (returns the artefact unchanged). The owner is never a member — they always
// have access — so granting the owner is rejected. The list cannot be changed
// while archived (hosting.lifecycle.archived-frozen). Owner authority
// (hosting.authority.owner-only) is enforced by the command.
//
// These operate on the full aggregate (not just the id list) so the command can
// `save` the result; `updatedAt` is bumped only when the set actually changes.

// Grant view access to a specific registered user.
// r[impl hosting.access-list.owner-managed-set]
export function grantAccess(
  a: Artefact,
  userId: string,
  now?: Date,
): Artefact {
  assertNotArchived(a, "change access of");
  // r[impl hosting.access-list.owner-never-member]
  if (userId === a.ownerId) {
    throw new InvariantViolation("the owner always has access");
  }
  if (a.sharedWith.includes(userId)) return a; // set semantics — already a member
  return changed(a, { sharedWith: [...a.sharedWith, userId] }, now);
}

// Revoke a user's access. A no-op if they were never a member.
export function revokeAccess(
  a: Artefact,
  userId: string,
  now?: Date,
): Artefact {
  assertNotArchived(a, "change access of");
  if (!a.sharedWith.includes(userId)) return a; // set semantics — not a member
  return changed(a, { sharedWith: a.sharedWith.filter((id) => id !== userId) }, now);
}
