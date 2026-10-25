import type { Artefact } from "./artefact";
import { changed } from "./changed";
import {
  canViewArtefactUnder,
  type AccessPolicy,
  type ViewableArtefact,
} from "./access";
import { ArtefactNotFound, InvariantViolation } from "./errors";

// S32a — Link controls on public artefacts: password + expiry (the hosting.link-gate.*
// requirements).
//
// The link gate narrows the `public` cell's extra audience only: it is consulted
// after the access matrix has granted view, only on the effective `public` tier,
// and only for a viewer the public cell alone admits. It never widens access and
// never changes the tier, so the matrix stays single-sourced in `access.ts`.

export interface LinkGate {
  // scrypt hash of the owner-set password; null = no password. Never leaves the
  // repository layer into any summary, BFF or MCP result.
  passwordHash: string | null;
  // After this instant the gated audience is denied; null = never expires.
  expiresAt: Date | null;
  // Bumped on every password set/change/clear and whenever the tier leaves
  // `public` — voids every outstanding pass.
  version: number;
}

export const NO_LINK_GATE: LinkGate = Object.freeze({
  passwordHash: null,
  expiresAt: null,
  version: 0,
}) as LinkGate;

// What a verified pass proves: the gate version its password unlocked.
export interface LinkPass {
  version: number;
}

export type LinkGateVerdict = "open" | "expired" | "challenge";

export const LINK_PASSWORD_MIN = 8;
export const LINK_PASSWORD_MAX = 128;

// Port: password hashing, so the domain stays framework-free. Implemented in
// infra (scrypt).
export interface LinkPasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

// Pure. Expired wins over a challenge (even with a valid pass); a
// pass counts only at the gate's current version.
// r[impl hosting.link-gate.evaluation]
export function evaluateLinkGate(
  gate: LinkGate,
  now: Date,
  pass: LinkPass | null,
): LinkGateVerdict {
  if (gate.expiresAt !== null && now.getTime() >= gate.expiresAt.getTime()) {
    return "expired";
  }
  if (gate.passwordHash !== null && pass?.version !== gate.version) {
    return "challenge";
  }
  return "open";
}

export interface SetLinkGateInput {
  requesterId: string;
  // undefined = keep; null = clear; a string = set (hashed here).
  password?: string | null;
  // undefined = keep; null = clear; a Date = set (must lie in the future).
  expiresAt?: Date | null;
  now: Date;
}

// The guards shared by set and clear: owner-only (a non-owner is refused
// as not found, hosting.access.no-existence-leak, hosting.authority.owner-only), not archived
// (hosting.lifecycle.archived-not-served), top-level (hosting.access.effective-from-tree-root),
// tier `public`.
// r[impl hosting.link-gate.public-only]
function assertGateEditable(a: Artefact, requesterId: string): void {
  if (requesterId !== a.ownerId) throw new ArtefactNotFound(a.id);
  if (a.status === "archived") {
    throw new InvariantViolation("cannot change the link protection of an archived artefact");
  }
  if (a.collectionId !== null) {
    throw new InvariantViolation(
      "link protection is inherited from the collection — move the artefact to top level first",
    );
  }
  if (a.visibility !== "public") {
    throw new InvariantViolation("link protection can only be set on a public artefact");
  }
}

// hosting.link-gate.public-only — set either half of the gate while public. A password set, change
// or clear bumps `version`; an expiry-only change does not.
export async function setArtefactLinkGate(
  a: Artefact,
  input: SetLinkGateInput,
  hasher: LinkPasswordHasher,
): Promise<Artefact> {
  assertGateEditable(a, input.requesterId);
  const gate = await changedLinkGate(a.linkGate, input, hasher, (m) => new InvariantViolation(m));
  return changed(a, { linkGate: gate }, input.now);
}

// The gate after a set (hosting.link-gate.password-rules), shared by both holders — a top-level
// artefact (S32a) and a collection root (S32b): an expiry must lie in the future
// (hosting.link-gate.expiry-in-future), a password is 8–128 characters and is hashed here; `null`
// clears a half. A password set, change or clear bumps `version`; an expiry-only change does not.
// `fail` builds the holder's own invariant error.
export async function changedLinkGate(
  current: LinkGate,
  input: Pick<SetLinkGateInput, "password" | "expiresAt" | "now">,
  hasher: LinkPasswordHasher,
  fail: (message: string) => Error,
): Promise<LinkGate> {
  const gate: LinkGate = { ...current };

  if (input.expiresAt !== undefined) {
    // r[impl hosting.link-gate.expiry-in-future]
    if (input.expiresAt !== null && input.expiresAt.getTime() <= input.now.getTime()) {
      throw fail("the link expiry must lie in the future");
    }
    gate.expiresAt = input.expiresAt;
  }

  if (input.password !== undefined) {
    if (input.password !== null) {
      const length = [...input.password].length;
      // r[impl hosting.link-gate.password-rules]
      if (length < LINK_PASSWORD_MIN || length > LINK_PASSWORD_MAX) {
        throw fail(`the link password must be ${LINK_PASSWORD_MIN}–${LINK_PASSWORD_MAX} characters`);
      }
      gate.passwordHash = await hasher.hash(input.password);
    } else {
      gate.passwordHash = null;
    }
    // r[impl hosting.link-gate.password-change-voids-pass]
    gate.version = current.version + 1;
  }

  return gate;
}

// hosting.link-gate.public-only — clear both halves while public; bumps `version` (voids every
// pass). An unset gate has no pass to void, so clearing it is a no-op
// (hosting.artefact.updated-at-bumped).
export function clearArtefactLinkGate(
  a: Artefact,
  input: { requesterId: string; now: Date },
): Artefact {
  assertGateEditable(a, input.requesterId);
  if (a.linkGate.passwordHash === null && a.linkGate.expiresAt === null) return a;
  return changed(a, { linkGate: clearedGate(a.linkGate) }, input.now);
}

// hosting.link-gate.cleared-leaving-public — what the gate becomes when the tier leaves `public`,
// or on a clear.
export function clearedGate(gate: LinkGate): LinkGate {
  return { passwordHash: null, expiresAt: null, version: gate.version + 1 };
}

// hosting.link-gate.expiry-reads-as-private — a public top-level artefact whose own link has
// expired: what the owner's preview warns about (the owner themself is never gated).
export function isLinkExpired(
  a: Pick<Artefact, "visibility" | "collectionId" | "linkGate">,
  now: Date,
): boolean {
  return (
    a.visibility === "public" &&
    a.collectionId === null &&
    evaluateLinkGate(a.linkGate, now, null) === "expired"
  );
}

export type ArtefactReadVerdict = "granted" | "not-found" | "sign-in" | "challenge";

export interface ArtefactReadInput {
  // The artefact itself — its owner.
  artefact: Pick<Artefact, "ownerId">;
  // Its effective access (hosting.access.effective-from-tree-root): its own when top-level, its
  // tree root's when contained. The matrix decides on this.
  effective: ViewableArtefact;
  // Its effective gate (S32b, `effectiveLinkGate`): its own when top-level, its
  // tree root's when contained — a contained artefact's own gate is dormant.
  gate: LinkGate;
  viewerId: string | null;
  // The pass the request carries for this artefact, if any.
  pass: LinkPass | null;
  now: Date;
}

// The one read authorization: the matrix under the policy
// first (hosting.access.matrix, hosting.access.policy-decided), then — only on the effective
// `public` tier, only for a viewer the public cell alone admits — the gate. `expired` maps to the
// private outcome (anonymous → sign-in, signed-in → not-found), so no probe the matrix denies can
// tell a gated artefact from a missing one.
// r[impl hosting.link-gate.narrows-public-audience]
export async function authorizeArtefactRead(
  input: ArtefactReadInput,
  policy: AccessPolicy,
): Promise<ArtefactReadVerdict> {
  const { artefact, effective, viewerId } = input;
  const denied: ArtefactReadVerdict = viewerId === null ? "sign-in" : "not-found";

  // r[impl hosting.link-gate.no-existence-leak]
  if (!(await canViewArtefactUnder(policy, effective, viewerId))) return denied;
  if (viewerId === artefact.ownerId) return "granted"; // hosting.authority.owner-only — never gated
  // A non-public effective tier has no gate (hosting.link-gate.public-only).
  if (effective.visibility !== "public") return "granted";
  // A signed-in viewer the `authenticated` tier would admit is not the public
  // cell's extra audience (hosting.link-gate.narrows-public-audience).
  if (viewerId !== null && (await policy.grantsAuthenticatedTier(viewerId, effective.tenantId))) {
    return "granted";
  }

  switch (evaluateLinkGate(input.gate, input.now, input.pass)) {
    case "open":
      return "granted";
    // r[impl hosting.link-gate.expiry-reads-as-private]
    case "expired":
      return denied;
    case "challenge":
      return "challenge";
  }
}
