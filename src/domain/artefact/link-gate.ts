import type { Artefact } from "./artefact";
import {
  canViewArtefactUnder,
  type AccessPolicy,
  type ViewableArtefact,
} from "./access";
import { ArtefactNotFound, InvariantViolation } from "./errors";

// S32a — Link controls on public artefacts: password + expiry (AH22–AH24, AH31).
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

// AH22/AH23 — pure. Expired wins over a challenge (even with a valid pass); a
// pass counts only at the gate's current version.
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

// AH31 guards shared by set and clear: owner-only (a non-owner is refused as
// not found, AH8/AH9), not archived (AH7), top-level (AH20), tier `public`.
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

// AH31 — set either half of the gate while public. A password set, change or
// clear bumps `version`; an expiry-only change does not.
export async function setArtefactLinkGate(
  a: Artefact,
  input: SetLinkGateInput,
  hasher: LinkPasswordHasher,
): Promise<Artefact> {
  assertGateEditable(a, input.requesterId);
  const gate: LinkGate = { ...a.linkGate };

  if (input.expiresAt !== undefined) {
    if (input.expiresAt !== null && input.expiresAt.getTime() <= input.now.getTime()) {
      throw new InvariantViolation("the link expiry must lie in the future"); // AH23
    }
    gate.expiresAt = input.expiresAt;
  }

  if (input.password !== undefined) {
    if (input.password !== null) {
      const length = [...input.password].length;
      if (length < LINK_PASSWORD_MIN || length > LINK_PASSWORD_MAX) {
        throw new InvariantViolation(
          `the link password must be ${LINK_PASSWORD_MIN}–${LINK_PASSWORD_MAX} characters`,
        );
      }
      gate.passwordHash = await hasher.hash(input.password);
    } else {
      gate.passwordHash = null;
    }
    gate.version = a.linkGate.version + 1;
  }

  return { ...a, linkGate: gate, updatedAt: input.now };
}

// AH31 — clear both halves while public; bumps `version` (voids every pass).
export function clearArtefactLinkGate(
  a: Artefact,
  input: { requesterId: string; now: Date },
): Artefact {
  assertGateEditable(a, input.requesterId);
  return { ...a, linkGate: clearedGate(a.linkGate), updatedAt: input.now };
}

// AH31 — what the gate becomes when the tier leaves `public`, or on a clear.
export function clearedGate(gate: LinkGate): LinkGate {
  return { passwordHash: null, expiresAt: null, version: gate.version + 1 };
}

export type ArtefactReadVerdict = "granted" | "not-found" | "sign-in" | "challenge";

export interface ArtefactReadInput {
  // The artefact itself — its owner and its own gate.
  artefact: Pick<Artefact, "ownerId" | "collectionId" | "linkGate">;
  // Its effective access (AH20): its own when top-level, its tree root's when
  // contained. The matrix decides on this.
  effective: ViewableArtefact;
  viewerId: string | null;
  // The pass the request carries for this artefact, if any.
  pass: LinkPass | null;
  now: Date;
}

// AH22–AH24 — the one read authorization: the matrix under the policy first
// (AH8/AH18), then — only on the effective `public` tier, only for a viewer the
// public cell alone admits — the gate. `expired` maps to the private outcome
// (anonymous → sign-in, signed-in → not-found), so no probe the matrix denies
// can tell a gated artefact from a missing one.
export async function authorizeArtefactRead(
  input: ArtefactReadInput,
  policy: AccessPolicy,
): Promise<ArtefactReadVerdict> {
  const { artefact, effective, viewerId } = input;
  const denied: ArtefactReadVerdict = viewerId === null ? "sign-in" : "not-found";

  if (!(await canViewArtefactUnder(policy, effective, viewerId))) return denied;
  if (viewerId === artefact.ownerId) return "granted"; // AH9 — never gated
  // A contained artefact's own gate is dormant (AH20); a non-public effective
  // tier has no gate (AH31).
  if (artefact.collectionId !== null || effective.visibility !== "public") return "granted";
  // A signed-in viewer the `authenticated` tier would admit is not the public
  // cell's extra audience (AH22).
  if (viewerId !== null && (await policy.grantsAuthenticatedTier(viewerId, effective.tenantId))) {
    return "granted";
  }

  switch (evaluateLinkGate(artefact.linkGate, input.now, input.pass)) {
    case "open":
      return "granted";
    case "expired":
      return denied; // AH23
    case "challenge":
      return "challenge";
  }
}
