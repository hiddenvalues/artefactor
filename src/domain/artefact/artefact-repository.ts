import type { Artefact } from "./artefact";
import type { TenantScope } from "./tenant-scope";

// Options for owner-scoped listing ("Your artefacts", S10).
// r[impl hosting.lifecycle.archived-hidden-from-listings]
export interface ListByOwnerOptions {
  // Include archived artefacts. Defaults to false — archived artefacts are hidden
  // from the default "Your artefacts" listing
  // (hosting.lifecycle.archived-hidden-from-listings).
  includeArchived?: boolean;
}

// S35 (hosting.thumbnail.sweep-is-system-read) — what the render sweep needs to (re)render one
// artefact's thumbnail, and nothing more.
export interface ThumbnailJob {
  id: string;
  payloadRef: string;
  payloadHash: string;
  thumbnailHash: string | null;
  // S37 (hosting.renderer.input-cap) — bytes of the payload, so a job over the render input cap is
  // skipped before the payload is read.
  payloadSize: number;
}

// Port: persistence for the Artefact aggregate. The Drizzle adapter (infra/db)
// and the in-memory test double both implement this.
export interface ArtefactRepository {
  // Persists the aggregate, including its `selected`-tier access list
  // (`sharedWith`) — the adapter syncs the membership set as part of the save
  // (S16, hosting.access-list.retained, hosting.access-list.owner-managed-set).
  // Reads (`findById`/`findBySlug`/`listByOwner`) populate it. `thumbnailHash` is
  // never written by a save (hosting.thumbnail.recorded-by-compare-and-set): a new row
  // starts with none, and an update leaves the stored value as it is.
  //
  // S60 (hosting.save.no-lost-update) — a compare-and-set on `revision`, not an upsert. It applies
  // only while the stored revision equals `artefact.revision`, and stores it incremented by one; a
  // revision-0 aggregate is inserted at revision 1. Otherwise — a newer stored revision, a row that
  // is gone, or a revision-0 id that already exists — it writes nothing, neither the row nor the
  // access list, and throws `ArtefactConflict`. Returns the persisted aggregate at its new revision.
  save(artefact: Artefact): Promise<Artefact>;
  // S35 (hosting.thumbnail.recorded-by-compare-and-set) — record a rendered thumbnail
  // by compare-and-set: sets `thumbnailHash = renderedHash` only while the artefact's
  // current `payloadHash` equals it, without bumping `updatedAt`. Returns whether it
  // applied (false for a superseded render or an unknown id).
  recordThumbnail(id: string, renderedHash: string): Promise<boolean>;
  // S35 — a **system** read for the render sweep, tenant-agnostic and never exposed through any
  // API: up to `limit` active artefacts whose thumbnail is missing or stale.
  // r[impl hosting.thumbnail.sweep-is-system-read]
  listNeedingThumbnail(limit: number): Promise<ThumbnailJob[]>;
  // Permanently remove an artefact by id (hosting.delete.removes-everything).
  // Archived-only is enforced by the delete command, not here. A no-op if the id
  // does not exist.
  delete(id: string): Promise<void>;
  // Resolve one artefact by id within the caller's tenant scope (S22,
  // hosting.tenant.invisible-to-oss): a row whose `tenantId` is outside the scope is invisible
  // (returns null). OSS passes `SINGLETON_SCOPE`, so this never discriminates (one tenant).
  findById(id: string, scope: TenantScope): Promise<Artefact | null>;
  // Resolve by slug — **not** scope-aware. A slug is a globally-unique capability
  // (hosting.slug.globally-unique): it is the cross-tenant address for public/link serving and the
  // mint-time uniqueness check. The per-tier tenant decision for a slug-served
  // artefact is the `AccessPolicy`'s (S22 part B / ET3), not the scope's.
  findBySlug(slug: string): Promise<Artefact | null>;
  // Owner's artefacts within the tenant scope, most-recently-updated first.
  // Active-only by default. OSS passes `SINGLETON_SCOPE` (no-op filter); a
  // superset passes the caller's active org, so the dashboard shows that org's
  // artefacts only (ET2/ET4).
  // r[impl hosting.listing.own-only]
  listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]>;
  // Active artefacts shared *to* the viewer within the tenant scope — visibility `authenticated` or
  // `public`, plus `selected` artefacts the viewer is a member of (S16) — most-recently-updated
  // first. "Shared with you" (S14) means *others'* artefacts, so the viewer's own are excluded
  // (they live in "Your artefacts"). Private never appears (hosting.access.matrix). Scoping to the
  // active org makes "Shared with you" org-scoped in a superset (ET3); OSS passes the singleton.
  // **Top-level artefacts only** (`collectionId = null`): an artefact inside a collection has its
  // own tier dormant (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant) — the effectively-shared
  // composition adds those via `listByCollectionIds` + the shared roots.
  // r[impl hosting.shared.others-viewable]
  listShared(viewerId: string, scope: TenantScope): Promise<Artefact[]>;
  // Artefacts whose `collectionId` is in the given set, within the tenant scope.
  // Active-only by default; the cascade commands pass `includeArchived` (collections.lifecycle.archive-cascades, collections.lifecycle.delete-cascades).
  // Like `listShared`, it carries an empty `sharedWith`: a copy read here is never saved — a
  // command reloads it with `findById` first (S60), or the save would clear its access list.
  listByCollectionIds(
    collectionIds: readonly string[],
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]>;
}
