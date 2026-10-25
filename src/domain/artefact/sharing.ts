import {
  assertTierEditable,
  setDataVisibility,
  shareArtefact,
  unshareArtefact,
  type Artefact,
} from "./artefact";
import { grantAccess, revokeAccess } from "./access-list";
import { ArtefactNotFound, InvariantViolation } from "./errors";
import { setArtefactLinkGate, type LinkPasswordHasher } from "./link-gate";
import type { DataVisibility, Visibility } from "./visibility";

// S55 — set sharing: the owner's whole sharing set applied to one aggregate, so
// the command can persist it with a single `save` (hosting.sharing.atomic-save).
// It adds no rule about any field — each part goes through the transition that
// decides it today.

export interface SharingChange {
  // The target tier, always given.
  visibility: Visibility;
  // The full access list; undefined = unchanged (hosting.access-list.retained keeps it).
  members?: readonly string[];
  // Only with `public` (hosting.link-gate.public-only). undefined = keep; null = clear a half.
  linkGate?: { password?: string | null; expiresAt?: Date | null };
  dataVisibility?: DataVisibility;
}

export interface SharingContext {
  now: Date;
  // A freshly-minted, collision-checked slug, used only on a first share
  // (hosting.slug.minted-once-retained).
  newSlug?: string;
  // Hashes a password given in `linkGate`.
  hasher: LinkPasswordHasher;
}

// Fixed order: tier → link gate → access list → data visibility. Returns the
// new aggregate, or throws the first refusal; the input is never mutated, so
// nothing partial survives a throw.
// r[impl hosting.sharing.members-replace]
// r[impl hosting.sharing.applies-in-order]
export async function applySharing(
  a: Artefact,
  actorId: string,
  change: SharingChange,
  ctx: SharingContext,
): Promise<Artefact> {
  const { now } = ctx;
  if (actorId !== a.ownerId) throw new ArtefactNotFound(a.id); // hosting.authority.owner-only
  if (a.status === "archived") {
    throw new InvariantViolation("cannot change the sharing of an archived artefact"); // hosting.lifecycle.archived-frozen
  }
  if (change.linkGate !== undefined && change.visibility !== "public") {
    // hosting.link-gate.public-only
    throw new InvariantViolation("link protection can only be set on a public artefact");
  }

  let next = a;

  if (change.visibility !== a.visibility) {
    // A contained artefact's own tier is dormant and not editable.
    assertTierEditable(a);
    next =
      change.visibility === "private"
        ? unshareArtefact(next, { now })
        : shareArtefact(next, { tier: change.visibility, newSlug: ctx.newSlug, now });
  }

  if (change.linkGate !== undefined) {
    next = await setArtefactLinkGate(next, { requesterId: actorId, ...change.linkGate, now }, ctx.hasher);
  }

  if (change.members !== undefined) {
    const wanted = new Set(change.members);
    for (const id of next.sharedWith) if (!wanted.has(id)) next = revokeAccess(next, id, now);
    for (const id of wanted) next = grantAccess(next, id, now); // never the owner (hosting.access-list.owner-never-member)
  }

  if (change.dataVisibility !== undefined) {
    next = setDataVisibility(next, actorId, change.dataVisibility, { now });
  }

  return next;
}
