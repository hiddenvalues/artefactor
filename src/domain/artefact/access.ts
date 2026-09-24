import type { Artefact } from "./artefact";

// The fields the access matrix depends on — a viewer-facing slice of the
// aggregate. Keeping the input narrow makes the rule easy to reason about and
// reuse (slug serving in S6, "Shared with you" in S14, data access in S11/S12).
// `tenantId` is carried for the AccessPolicy (S22/AH18): the one policy-decided
// cell asks whether a viewer holds the `authenticated` tier *of this tenant*.
export type ViewableArtefact = Pick<
  Artefact,
  "visibility" | "status" | "ownerId" | "sharedWith" | "tenantId"
>;

// S22 part B (AH18) — the access-policy port. The matrix below is fixed; the
// single overridable cell is "does a signed-in non-owner hold the
// `authenticated` tier?". OSS answers yes for anyone signed in (login-wide); a
// multi-tenant superset answers yes only for co-members of the artefact's
// tenant (ET3/T3). By construction the policy can never touch `public`/
// `selected`/`private` semantics, anonymous denial, the owner's own view, or
// archived-is-inert — AH7/AH8/AH9 hold under any policy.
export interface AccessPolicy {
  grantsAuthenticatedTier(
    viewerId: string,
    tenantId: string,
  ): boolean | Promise<boolean>;
}

// The OSS default policy: the `authenticated` tier means any signed-in user.
// With it, `canViewArtefactUnder` is byte-identical to `canViewArtefact`.
export const defaultAccessPolicy: AccessPolicy = {
  grantsAuthenticatedTier: () => true,
};

// The access matrix for serving an artefact (AH8), gated by archived-is-inert
// (AH7). `viewerId` is the authenticated user id, or null when unauthenticated.
//
//   visibility     | owner | member | other signed-in | unauthenticated
//   -------------- | ----- | ------ | --------------- | ---------------
//   private        |  yes  |   —    |       no        |       no
//   selected       |  yes  |  yes   |       no        |       no
//   authenticated  |  yes  |  yes   |     policy      |       no
//   public         |  yes  |  yes   |       yes       |       yes
//
// A `selected` artefact is visible to the owner and to any user in `sharedWith`
// (AH8/13); everyone else — signed-in or anonymous — gets a flat deny.
// An archived artefact is never served — it returns false to everyone, owner
// included (the owner reaches it only via the "Your artefacts" archived filter).
// The "policy" cell is the one AH18 delegates: OSS default = yes.
function matrixVerdict(
  artefact: ViewableArtefact,
  viewerId: string | null,
): boolean | "authenticated-tier" {
  if (artefact.status !== "active") return false; // AH7

  switch (artefact.visibility) {
    case "public":
      return true;
    case "authenticated":
      if (viewerId === null) return false; // anonymous: fixed deny (AH8)
      if (viewerId === artefact.ownerId) return true; // owner: fixed (AH9)
      return "authenticated-tier"; // the one policy-decided cell (AH18)
    case "selected":
      return (
        viewerId !== null &&
        (viewerId === artefact.ownerId ||
          artefact.sharedWith.includes(viewerId))
      );
    case "private":
      return viewerId !== null && viewerId === artefact.ownerId;
  }
}

// The matrix under the OSS default policy — the synchronous form domain logic
// and tests use directly. Kept alongside the port so the matrix has exactly one
// source (both gates share `matrixVerdict`).
export function canViewArtefact(
  artefact: ViewableArtefact,
  viewerId: string | null,
): boolean {
  return matrixVerdict(artefact, viewerId) !== false;
}

// The matrix under an injected policy (S22/AH18) — what the server read gates
// consult. Async because a superset's policy resolves org membership from a
// store; the OSS default resolves inline and behaves exactly like
// `canViewArtefact`.
export async function canViewArtefactUnder(
  policy: AccessPolicy,
  artefact: ViewableArtefact,
  viewerId: string | null,
): Promise<boolean> {
  const verdict = matrixVerdict(artefact, viewerId);
  if (verdict === "authenticated-tier") {
    // The verdict only arises for a signed-in non-owner (see matrixVerdict).
    return policy.grantsAuthenticatedTier(viewerId as string, artefact.tenantId);
  }
  return verdict;
}

// S41 (AD11) — whose saved data a viewer may load, evaluated only AFTER the
// matrix above admits the viewer, so it only ever narrows AD4. The viewer's own
// entry and the owner's reach are the same under both settings; under `own` a
// non-owner (or the anonymous, who have no entry of their own) may load no other
// author's. The single predicate behind all four enforcement points: the author
// list, the author read, the frame-token mint and the frame redeem.
export function canLoadAuthorData(
  artefact: Pick<Artefact, "ownerId" | "dataVisibility">,
  viewerId: string | null,
  authorId: string,
): boolean {
  return (
    (viewerId !== null && authorId === viewerId) ||
    viewerId === artefact.ownerId ||
    artefact.dataVisibility === "shared"
  );
}
