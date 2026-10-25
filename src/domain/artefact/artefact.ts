import { ArtefactNotFound, InvariantViolation } from "./errors";
import type { ArtefactKind } from "./kind";
import type { DataVisibility, Status, Visibility } from "./visibility";
import type { StoredPayload } from "./ports";
import { NO_LINK_GATE, clearedGate, type LinkGate } from "./link-gate";
import { changed, type OwnerChanges } from "./changed";

// The payload size cap (hosting.payload.size-bounds).
export const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// r[impl hosting.artefact.title-required]
// The trimmed title; an empty one is rejected. Create and edit both go through it.
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new InvariantViolation("title must not be empty");
  return trimmed;
}

// r[impl hosting.payload.size-bounds]
// A payload is non-empty and within the cap. Create and edit both go through it.
function assertPayloadSize(payload: StoredPayload): void {
  if (payload.bytes <= 0) throw new InvariantViolation("payload must not be empty");
  if (payload.bytes > MAX_PAYLOAD_BYTES) {
    throw new InvariantViolation("payload exceeds the 100 MB cap");
  }
}

// r[impl hosting.lifecycle.archived-frozen]
// An archived artefact can't change until it is restored: every mutation of its
// fields, tier or access list calls this first. `action` names it in the error
// ("cannot share an archived artefact").
export function assertNotArchived(a: Pick<Artefact, "status">, action: string): void {
  if (a.status === "archived") {
    throw new InvariantViolation(`cannot ${action} an archived artefact`);
  }
}

// S22 (hosting.tenant.invisible-to-oss) — the tenant an artefact belongs to. OSS is single-tenant
// *by being one deployment*, so every artefact carries this well-known default and it never
// discriminates; a multi-tenant superset stamps the creator's org instead and scopes queries by it.
// Behaviour-preserving here: all OSS rows share DEFAULT_TENANT.
export const DEFAULT_TENANT = "default";

export interface Artefact {
  id: string;
  ownerId: string;
  // S22, hosting.tenant.invisible-to-oss — the owning tenant. Immutable; set at create. OSS:
  // DEFAULT_TENANT.
  tenantId: string;
  title: string;
  kind: ArtefactKind;
  visibility: Visibility;
  // The users granted view access under the `selected` tier. A set — no
  // duplicates, never the owner (hosting.access-list.owner-managed-set). Every
  // transition carries it by spread, so it is retained across tier changes +
  // archive, and only the matrix's `selected` cell consults it. Empty ⇒ owner-only.
  // r[impl hosting.access-list.retained]
  sharedWith: readonly string[];
  publicSlug: string | null;
  // hosting.access.effective-from-tree-root — the collection the artefact lives in; null =
  // top-level. While set, the tree root's (visibility, sharedWith) governs effective access and the
  // artefact's own lie dormant (see ddd/artefact-collections.md, collections.access.contained-own-tier-dormant).
  collectionId: string | null;
  status: Status;
  payloadRef: string;
  payloadBytes: number;
  payloadHash: string;
  // hosting.uses-storage.chrome-only: whether the payload appears to use the localStorage
  // persistence API. Derived metadata, recomputed whenever the payload is set. Drives host chrome
  // (the S12 switcher) only — never access/serving.
  usesStorage: boolean;
  // S35: the `payloadHash` the recorded thumbnail was rendered from;
  // null until the first render lands. Derived host chrome — never access or
  // serving. Written only by the repository's `recordThumbnail` compare-and-set,
  // never by `save`, so edits leave it untouched and it goes stale instead.
  thumbnailHash: string | null;
  // S41 (hosting.data-visibility.owner-set) — whether a non-owner may load other authors' saved
  // data (data.visibility.narrows-reads). Owner-set, per artefact, never inherited from a collection; gates no viewing.
  dataVisibility: DataVisibility;
  // S32a (the hosting.link-gate.* requirements) — the owner-set password and/or expiry on the
  // public link. Lives only while the tier is `public`: leaving it clears the gate.
  linkGate: LinkGate;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  // S60 (hosting.save.no-lost-update) — the concurrency token: the stored revision this aggregate
  // was loaded at, 0 before its first save. Owned by the repository; no domain function changes it.
  revision: number;
}

export interface CreateArtefactInput {
  id: string;
  ownerId: string;
  title: string;
  kind: ArtefactKind;
  payload: StoredPayload;
  // S22, hosting.tenant.invisible-to-oss — the owning tenant. Optional so OSS callers omit it
  // (defaults to DEFAULT_TENANT); a multi-tenant superset passes the creator's active org.
  tenantId?: string;
  // Computed by the command from the raw payload bytes (hosting.uses-storage.chrome-only). Optional
  // so tests/fixtures can omit it; defaults to false.
  usesStorage?: boolean;
  now?: Date;
}

// Factory enforcing the create-time invariants from the Artefact Hosting spec.
// A new artefact is always active + private with no slug.
// r[impl hosting.artefact.owner-required]
// r[impl hosting.create.title-kind-payload]
export function createArtefact(input: CreateArtefactInput): Artefact {
  if (!input.ownerId) {
    throw new InvariantViolation("ownerId is required");
  }
  const title = requireTitle(input.title);
  assertPayloadSize(input.payload);

  const now = input.now ?? new Date();
  // r[impl hosting.create.active-private]
  return {
    id: input.id,
    ownerId: input.ownerId,
    // r[impl hosting.tenant.invisible-to-oss]
    tenantId: input.tenantId ?? DEFAULT_TENANT,
    title,
    kind: input.kind,
    visibility: "private",
    sharedWith: [],
    publicSlug: null,
    // New artefacts always start top-level (hosting.access.effective-from-tree-root).
    collectionId: null,
    status: "active",
    payloadRef: input.payload.ref,
    payloadBytes: input.payload.bytes,
    payloadHash: input.payload.hash,
    usesStorage: input.usesStorage ?? false,
    thumbnailHash: null, // hosting.thumbnail.stale-while-hash-differs — rendered after the create is persisted
    // r[impl hosting.data-visibility.new-default-own]
    dataVisibility: "own", // saved data private per viewer by default
    linkGate: NO_LINK_GATE, // hosting.link-gate.public-only — set only once public
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 0, // never saved
  };
}

// The shareable visibility tiers (everything except `private`): `selected`,
// `authenticated`, `public`. All mint/retain a slug on first share through
// `shareArtefact` — `selected` exactly like the other two.
// r[impl hosting.slug.selected-shared-tier]
export type ShareableTier = Exclude<Visibility, "private">;

export interface ShareOptions {
  tier: ShareableTier;
  // A freshly-minted, collision-checked slug — used only when the artefact has
  // no retained slug yet. Ignored once a slug exists (mint once, retain).
  newSlug?: string;
  now?: Date;
}

// Share / change tier. Raises visibility to a shareable tier; mints the slug the
// first time visibility leaves `private` and retains it thereafter (uniqueness is
// the caller's mint, hosting.slug.globally-unique). Blocked while archived. Owner
// authority (hosting.authority.owner-only) is enforced by the caller.
// r[impl hosting.share.sets-tier]
export function shareArtefact(a: Artefact, options: ShareOptions): Artefact {
  assertNotArchived(a, "share");
  // r[impl hosting.slug.minted-once-retained]
  const publicSlug = a.publicSlug ?? options.newSlug ?? null;
  // r[impl hosting.slug.shared-has-slug]
  if (publicSlug === null) {
    // A first-time share must supply a slug to mint.
    throw new InvariantViolation("a slug must be provided to share an artefact");
  }
  return changed(
    a,
    { visibility: options.tier, publicSlug, linkGate: leavingPublic(a, options.tier) },
    options.now,
  );
}

// Any tier change away from `public` clears
// the gate and bumps its version (voiding every pass); `public → public` keeps it.
// r[impl hosting.link-gate.cleared-leaving-public]
function leavingPublic(a: Artefact, tier: Visibility): LinkGate {
  return a.visibility === "public" && tier !== "public" ? clearedGate(a.linkGate) : a.linkGate;
}

// A contained artefact's own tier is dormant (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant) and not
// editable: access is changed on the collection, or the artefact moved out first. Shared by every
// path that sets the tier — set visibility and set sharing (S55).
// r[impl hosting.access.dormant-tier-frozen]
export function assertTierEditable(a: Artefact): void {
  if (a.collectionId !== null) {
    throw new InvariantViolation(
      "visibility is inherited from the collection — change it there, or move the artefact to top level",
    );
  }
}

// Unshare: back to `private`, retaining the slug (hosting.slug.minted-once-retained;
// the link 404s while private). Blocked while archived.
// r[impl hosting.unshare.sets-private]
export function unshareArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  assertNotArchived(a, "unshare");
  return changed(
    a,
    {
      visibility: "private",
      publicSlug: a.publicSlug, // retained
      linkGate: leavingPublic(a, "private"),
    },
    options?.now,
  );
}

export interface EditArtefactChanges {
  title?: string;
  kind?: ArtefactKind;
  // A newly-stored payload replacing the current one. The caller is responsible
  // for deleting the previous payload after a successful edit.
  payload?: StoredPayload;
  // Recomputed `usesStorage` (hosting.uses-storage.chrome-only), supplied by the command alongside
  // a payload replacement. Ignored when no payload is provided (title/kind-only edits).
  usesStorage?: boolean;
  now?: Date;
}

// Edit (S3): update any of title / kind / payload, bumping `updatedAt` when a field
// changes (an edit that changes none returns the artefact itself). Only the
// provided fields change. Re-applies the same payload/title invariants as create
// and is blocked while archived. Owner authority (hosting.authority.owner-only)
// is enforced by the caller.
// r[impl hosting.edit.fields-and-timestamp+2]
export function editArtefact(a: Artefact, changes: EditArtefactChanges): Artefact {
  assertNotArchived(a, "edit");

  const next: OwnerChanges = {};

  if (changes.title !== undefined) {
    next.title = requireTitle(changes.title);
  }

  if (changes.kind !== undefined) {
    next.kind = changes.kind;
  }

  if (changes.payload !== undefined) {
    assertPayloadSize(changes.payload);
    next.payloadRef = changes.payload.ref;
    next.payloadBytes = changes.payload.bytes;
    next.payloadHash = changes.payload.hash;
    // Recompute on payload replacement only (hosting.uses-storage.chrome-only); a title/kind edit
    // leaves it.
    next.usesStorage = changes.usesStorage ?? a.usesStorage;
  }

  return changed(a, next, changes.now);
}

// S41 (hosting.data-visibility.owner-set): the owner chooses whether viewers may load each other's
// saved data (data.visibility.narrows-reads). Owner-only — a non-owner is refused as not found
// (hosting.access.no-existence-leak, hosting.authority.owner-only) — and blocked while archived
// (hosting.lifecycle.archived-frozen). Setting the current value is a no-op.
// r[impl hosting.data-visibility.owner-set]
export function setDataVisibility(
  a: Artefact,
  actorId: string,
  dataVisibility: DataVisibility,
  options?: { now?: Date },
): Artefact {
  if (actorId !== a.ownerId) throw new ArtefactNotFound(a.id); // hosting.access.no-existence-leak, hosting.authority.owner-only
  assertNotArchived(a, "change the data visibility of");
  if (a.dataVisibility === dataVisibility) return a;
  return changed(a, { dataVisibility }, options?.now);
}

// S35: the thumbnail is stale — missing, or rendered from an earlier
// payload — while its hash differs from the current payload's.
// r[impl hosting.thumbnail.stale-while-hash-differs]
export function isThumbnailStale(a: Artefact): boolean {
  return a.thumbnailHash !== a.payloadHash;
}

// S37 (hosting.renderer.input-cap): the largest payload ever sent to the isolated renderer. A bigger
// one is never rendered and keeps the kind placeholder; the renderer role
// refuses it too.
export const MAX_RENDER_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB

// Archive (S7): soft-delete. The artefact becomes inert — not served, hidden
// from default listings — and `archivedAt` is stamped. Visibility is left intact
// so restore can return to the prior tier.
// r[impl hosting.lifecycle.archive-stamps-archived-at]
export function archiveArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  // r[impl hosting.lifecycle.archive-active-only]
  if (a.status === "archived") {
    throw new InvariantViolation("artefact is already archived");
  }
  const now = options?.now ?? new Date();
  return changed(a, { status: "archived", archivedAt: now }, now);
}

// Restore (S7): return an archived artefact to `active` at its prior visibility
// (retained through archival), clearing `archivedAt`. Owner authority
// (hosting.authority.owner-only) is enforced by the command.
// r[impl hosting.restore.prior-visibility]
export function restoreArtefact(a: Artefact, options?: { now?: Date }): Artefact {
  // r[impl hosting.lifecycle.restore-archived-only]
  if (a.status !== "archived") {
    throw new InvariantViolation("only an archived artefact can be restored");
  }
  return changed(a, { status: "active", archivedAt: null }, options?.now);
}

// Permanent delete guard: only an archived artefact may be deleted. Unlike
// archive/restore this produces no new aggregate — deletion is a removal — so the
// rule is a pure guard the delete command calls before removing the row, its
// payload, and its data entries. Owner-only is the command's owner load.
// r[impl hosting.delete.archived-only]
export function assertDeletable(a: Artefact): void {
  if (a.status !== "archived") {
    throw new InvariantViolation("only an archived artefact can be deleted");
  }
}
