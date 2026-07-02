import { InvariantViolation } from "./errors";
import type { ArtefactKind } from "./kind";
import type { Status, Visibility } from "./visibility";
import type { StoredPayload } from "./ports";

// Invariant AH2: payload size cap.
export const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// S22 (AH17) — the tenant an artefact belongs to. OSS is single-tenant *by being
// one deployment*, so every artefact carries this well-known default and it never
// discriminates; a multi-tenant superset stamps the creator's org instead and
// scopes queries by it. Behaviour-preserving here: all OSS rows share DEFAULT_TENANT.
export const DEFAULT_TENANT = "default";

export interface Artefact {
  id: string;
  ownerId: string;
  // S22/AH17 — the owning tenant. Immutable; set at create. OSS: DEFAULT_TENANT.
  tenantId: string;
  title: string;
  kind: ArtefactKind;
  visibility: Visibility;
  // The users granted view access under the `selected` tier (AH13/14). A set —
  // no duplicates, never the owner. Retained across tier changes + archive, and
  // only consulted while `visibility === "selected"`. Empty ⇒ owner-only.
  sharedWith: readonly string[];
  publicSlug: string | null;
  // AH20 — the collection the artefact lives in; null = top-level. While set,
  // the tree root's (visibility, sharedWith) governs effective access and the
  // artefact's own lie dormant (see ddd/artefact-collections.md, CL5).
  collectionId: string | null;
  status: Status;
  payloadRef: string;
  payloadBytes: number;
  payloadHash: string;
  // AH16: whether the payload appears to use the localStorage persistence API.
  // Derived metadata, recomputed whenever the payload is set. Drives host chrome
  // (the S12 switcher) only — never access/serving.
  usesStorage: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateArtefactInput {
  id: string;
  ownerId: string;
  title: string;
  kind: ArtefactKind;
  payload: StoredPayload;
  // S22/AH17 — the owning tenant. Optional so OSS callers omit it (defaults to
  // DEFAULT_TENANT); a multi-tenant superset passes the creator's active org.
  tenantId?: string;
  // Computed by the command from the raw payload bytes (AH16). Optional so
  // tests/fixtures can omit it; defaults to false.
  usesStorage?: boolean;
  now?: Date;
}

// Factory enforcing the create-time invariants from the Artefact Hosting spec.
// A new artefact is always active + private with no slug.
export function createArtefact(input: CreateArtefactInput): Artefact {
  if (!input.ownerId) {
    throw new InvariantViolation("ownerId is required"); // AH1
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new InvariantViolation("title must not be empty"); // AH3
  }
  if (input.payload.bytes <= 0) {
    throw new InvariantViolation("payload must not be empty"); // AH2
  }
  if (input.payload.bytes > MAX_PAYLOAD_BYTES) {
    throw new InvariantViolation("payload exceeds the 100 MB cap"); // AH2
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    ownerId: input.ownerId,
    tenantId: input.tenantId ?? DEFAULT_TENANT, // AH17
    title,
    kind: input.kind,
    visibility: "private",
    sharedWith: [],
    publicSlug: null,
    collectionId: null, // AH20 — new artefacts always start top-level
    status: "active",
    payloadRef: input.payload.ref,
    payloadBytes: input.payload.bytes,
    payloadHash: input.payload.hash,
    usesStorage: input.usesStorage ?? false,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

// The shareable visibility tiers (everything except `private`): `selected`,
// `authenticated`, `public`. All mint/retain a slug on first share (AH4/5/12).
export type ShareableTier = Exclude<Visibility, "private">;

export interface ShareOptions {
  tier: ShareableTier;
  // A freshly-minted, collision-checked slug — used only when the artefact has
  // no retained slug yet. Ignored once a slug exists (AH5: mint once, retain).
  newSlug?: string;
  now?: Date;
}

// Share / change tier (AH4, 5, 6). Raises visibility to a shareable tier; mints
// the slug the first time visibility leaves `private` and retains it thereafter.
// Blocked while archived (AH7). Owner authority (AH9) is enforced by the caller.
export function shareArtefact(a: Artefact, options: ShareOptions): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot share an archived artefact"); // AH7
  }
  const publicSlug = a.publicSlug ?? options.newSlug ?? null;
  if (publicSlug === null) {
    // A first-time share must supply a slug to mint (AH4).
    throw new InvariantViolation("a slug must be provided to share an artefact");
  }
  return {
    ...a,
    visibility: options.tier,
    publicSlug,
    updatedAt: options.now ?? new Date(),
  };
}

// Unshare (AH5): back to `private`, retaining the slug (the link 404s while
// private). Blocked while archived (AH7).
export function unshareArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot unshare an archived artefact"); // AH7
  }
  return {
    ...a,
    visibility: "private",
    publicSlug: a.publicSlug, // retained
    updatedAt: options?.now ?? new Date(),
  };
}

export interface EditArtefactChanges {
  title?: string;
  kind?: ArtefactKind;
  // A newly-stored payload replacing the current one. The caller is responsible
  // for deleting the previous payload after a successful edit.
  payload?: StoredPayload;
  // Recomputed `usesStorage` (AH16), supplied by the command alongside a payload
  // replacement. Ignored when no payload is provided (title/kind-only edits).
  usesStorage?: boolean;
  now?: Date;
}

// Edit (S3): update any of title / kind / payload, bumping `updatedAt`. Only the
// provided fields change. Re-applies the same payload/title invariants as create
// (AH2, AH3) and is blocked while archived (AH7). Owner authority (AH8/9) is
// enforced by the caller.
export function editArtefact(a: Artefact, changes: EditArtefactChanges): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("cannot edit an archived artefact"); // AH7
  }

  const next: Artefact = { ...a, updatedAt: changes.now ?? new Date() };

  if (changes.title !== undefined) {
    const title = changes.title.trim();
    if (title.length === 0) {
      throw new InvariantViolation("title must not be empty"); // AH3
    }
    next.title = title;
  }

  if (changes.kind !== undefined) {
    next.kind = changes.kind;
  }

  if (changes.payload !== undefined) {
    if (changes.payload.bytes <= 0) {
      throw new InvariantViolation("payload must not be empty"); // AH2
    }
    if (changes.payload.bytes > MAX_PAYLOAD_BYTES) {
      throw new InvariantViolation("payload exceeds the 100 MB cap"); // AH2
    }
    next.payloadRef = changes.payload.ref;
    next.payloadBytes = changes.payload.bytes;
    next.payloadHash = changes.payload.hash;
    // Recompute on payload replacement only (AH16); a title/kind edit leaves it.
    next.usesStorage = changes.usesStorage ?? a.usesStorage;
  }

  return next;
}

// Archive (S7, AH7): soft-delete. The artefact becomes inert — not served, hidden
// from default listings — and `archivedAt` is stamped. Visibility is left intact
// so restore can return to the prior tier.
export function archiveArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  if (a.status === "archived") {
    throw new InvariantViolation("artefact is already archived");
  }
  const now = options?.now ?? new Date();
  return { ...a, status: "archived", archivedAt: now, updatedAt: now };
}

// Restore (S7, AH9): return an archived artefact to `active` at its prior
// visibility (retained through archival), clearing `archivedAt`.
export function restoreArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  if (a.status !== "archived") {
    throw new InvariantViolation("only an archived artefact can be restored");
  }
  const now = options?.now ?? new Date();
  return { ...a, status: "active", archivedAt: null, updatedAt: now };
}

// Permanent delete guard (AH11): only an archived artefact may be deleted. Unlike
// archive/restore this produces no new aggregate — deletion is a removal — so the
// rule is a pure guard the delete command calls before removing the row, its
// payload, and its data entries.
export function assertDeletable(a: Artefact): void {
  if (a.status !== "archived") {
    throw new InvariantViolation("only an archived artefact can be deleted");
  }
}
