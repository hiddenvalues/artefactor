import type { AccessPolicy } from "../artefact/access";
import { authorizeArtefactRead, type LinkPass } from "../artefact/link-gate";
import type { Collection } from "./collection";

// S28/S29 — who may read a collection tree, and who may contribute to it.
// Both decisions are made against the tree **root**
// (collections.access.root-governs-tree): nested nodes carry no access of their
// own.

// Viewer-facing collection reads: the one read decision artefact reads make
// (authorizeArtefactRead — the matrix under the AccessPolicy, then the link gate
// for the public cell's extra audience), with the root standing in for the
// artefact and holding the gate (S32b). Two collection-specific rules: reads are
// **signed-in only** (the one anonymous read, S44's projection of a public root by
// its slug, is its own query, `readPublicCollectionTree`), and every outcome but
// `granted` — a challenge included — reads as missing
// (collections.access.no-existence-leak). An archived root grants no one through
// the matrix's archived-is-inert rule (the owner reaches it via their archive
// view, never this gate).
// r[impl collections.read.follows-root+2]
export async function authorizeCollectionRead(
  input: { root: Collection; viewerId: string | null; pass: LinkPass | null; now: Date },
  policy: AccessPolicy,
): Promise<boolean> {
  const { root, viewerId } = input;
  if (viewerId === null) return false;
  const verdict = await authorizeArtefactRead(
    { artefact: root, effective: root, gate: root.linkGate, viewerId, pass: input.pass, now: input.now },
    policy,
  );
  return verdict === "granted";
}

// Contributors: the owner, or a user on the root's access list whom the read
// decision above also grants the tree (`canRead`, the caller's verdict, so the
// contributor rule cannot drift from reading). The list is the gate at every
// tier — under `authenticated`/`public` roots it *is* the contributor list
// (tiers keep pure view semantics; no drive-by additions), and under a `private`
// root it grants nothing (its members cannot even read).
// r[impl collections.contributor.on-root-access-list+2]
export function canContributeToTree(
  root: Collection,
  userId: string | null,
  canRead: boolean,
): boolean {
  if (userId === null || !canRead) return false;
  return userId === root.ownerId || root.sharedWith.includes(userId);
}
