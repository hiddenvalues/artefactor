import type { Artefact } from "./artefact";

// The fields the access matrix depends on — a viewer-facing slice of the aggregate. Keeping the
// input narrow makes the rule easy to reason about and reuse (slug serving in S6, "Shared with you"
// in S14, data access in S11/S12). `tenantId` is carried for the AccessPolicy (S22,
// hosting.access.policy-decided): the one policy-decided cell asks whether a viewer holds the
// `authenticated` tier *of this tenant*. `dataVisibility` is left out: it decides whose data a viewer
// loads, never whether they may view.
// r[impl hosting.data-visibility.never-gates-viewing]
export type ViewableArtefact = Pick<
  Artefact,
  "visibility" | "status" | "ownerId" | "sharedWith" | "tenantId"
>;

// S22 part B (hosting.access.policy-decided) — the access-policy port. The matrix below is fixed;
// the single overridable cell is "does a signed-in non-owner hold the `authenticated` tier?". OSS
// answers yes for anyone signed in (login-wide); a multi-tenant superset answers yes only for
// co-members of the artefact's tenant. By construction the policy can never touch
// `public`/`selected`/`private` semantics, anonymous denial, the owner's own view, or
// archived-is-inert — hosting.lifecycle.archived-not-served, hosting.access.matrix,
// hosting.authority.owner-only hold under any policy.
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

// The access matrix for serving an artefact (hosting.access.matrix), gated by
// archived-is-inert (hosting.lifecycle.archived-not-served). `viewerId` is the
// authenticated user id, or null when unauthenticated.
//
//   visibility     | owner | member | other signed-in | unauthenticated
//   -------------- | ----- | ------ | --------------- | ---------------
//   private        |  yes  |   —    |       no        |       no
//   selected       |  yes  |  yes   |       no        |       no
//   authenticated  |  yes  |  yes   |     policy      |       no
//   public         |  yes  |  yes   |       yes       |       yes
//
// A `selected` artefact is visible to the owner and to any user in `sharedWith`
// (hosting.access.matrix, hosting.access-list.retained); everyone else —
// signed-in or anonymous — gets a deny (the route turns it into a 404, or a
// sign-in redirect for the anonymous). An archived artefact is never served
// — it returns false to everyone, owner included (the owner reaches it only via
// the "Your artefacts" archived filter). The "policy" cell is the one hosting.access.policy-decided
// delegates: OSS default = yes.
// r[impl hosting.access.matrix]
function matrixVerdict(
  artefact: ViewableArtefact,
  viewerId: string | null,
): boolean | "authenticated-tier" {
  // r[impl hosting.lifecycle.archived-not-served]
  if (artefact.status !== "active") return false;

  switch (artefact.visibility) {
    case "public":
      return true;
    case "authenticated":
      if (viewerId === null) return false; // anonymous: fixed deny (hosting.access.matrix)
      if (viewerId === artefact.ownerId) return true; // owner: fixed (hosting.authority.owner-only)
      // r[impl hosting.access.policy-decided]
      return "authenticated-tier"; // the one policy-decided cell
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

// The matrix under an injected policy (S22, hosting.access.policy-decided) — what the server read
// gates consult. Async because a superset's policy resolves org membership from a store; the OSS
// default resolves inline and behaves exactly like `canViewArtefact`.
export async function canViewArtefactUnder(
  policy: AccessPolicy,
  artefact: ViewableArtefact,
  viewerId: string | null,
): Promise<boolean> {
  const verdict = matrixVerdict(artefact, viewerId);
  // r[impl hosting.access.policy-asked-last]
  if (verdict === "authenticated-tier") {
    // The verdict only arises for a signed-in non-owner (see matrixVerdict).
    return policy.grantsAuthenticatedTier(viewerId as string, artefact.tenantId);
  }
  return verdict;
}

// S41 (data.visibility.narrows-reads) — whose saved data a viewer may load, evaluated only AFTER the
// matrix above admits the viewer, so it only ever narrows data.read.follows-artefact-access. The viewer's own
// entry and the owner's reach are the same under both settings; under `own` a
// non-owner (or the anonymous, who have no entry of their own) may load no other
// author's. The single predicate behind all four enforcement points: the author
// list, the author read, the frame-token mint and the frame redeem.
// r[impl data.visibility.narrows-reads]
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
