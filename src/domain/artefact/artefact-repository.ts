import type { Artefact } from "./artefact";
import type { TenantScope } from "./tenant-scope";

// Options for owner-scoped listing ("Your artefacts", S10).
export interface ListByOwnerOptions {
  // Include archived artefacts. Defaults to false — archived artefacts are
  // hidden from the default "Your artefacts" listing (AH7).
  includeArchived?: boolean;
}

// S35 (AH26/AH17) — what the render sweep needs to (re)render one artefact's
// thumbnail, and nothing more.
export interface ThumbnailJob {
  id: string;
  payloadRef: string;
  payloadHash: string;
  thumbnailHash: string | null;
  // S37 (AH29) — bytes of the payload, so a job over the render input cap is
  // skipped before the payload is read.
  payloadSize: number;
}

// Port: persistence for the Artefact aggregate. The Drizzle adapter (infra/db)
// and the in-memory test double both implement this.
export interface ArtefactRepository {
  // Persists the aggregate, including its `selected`-tier access list
  // (`sharedWith`) — the adapter syncs the membership set as part of the save
  // (S16, AH13/14). Reads (`findById`/`findBySlug`/`listByOwner`) populate it.
  // `thumbnailHash` is never written by a save (AH26): a new row starts with
  // none, and an update leaves the stored value as it is.
  save(artefact: Artefact): Promise<void>;
  // S35 (AH26) — record a rendered thumbnail by compare-and-set: sets
  // `thumbnailHash = renderedHash` only while the artefact's current
  // `payloadHash` equals it, without bumping `updatedAt`. Returns whether it
  // applied (false for a superseded render or an unknown id).
  recordThumbnail(id: string, renderedHash: string): Promise<boolean>;
  // S35 (AH17 note) — a **system** read for the render sweep, tenant-agnostic
  // and never exposed through any API: up to `limit` active artefacts whose
  // thumbnail is missing or stale.
  listNeedingThumbnail(limit: number): Promise<ThumbnailJob[]>;
  // Permanently remove an artefact by id (AH11). Archived-only is enforced by
  // the delete command, not here. A no-op if the id does not exist.
  delete(id: string): Promise<void>;
  // Resolve one artefact by id within the caller's tenant scope (S22/AH17): a
  // row whose `tenantId` is outside the scope is invisible (returns null). OSS
  // passes `SINGLETON_SCOPE`, so this never discriminates (one tenant).
  findById(id: string, scope: TenantScope): Promise<Artefact | null>;
  // Resolve by slug — **not** scope-aware. A slug is a globally-unique capability
  // (AH6): it is the cross-tenant address for public/link serving and the
  // mint-time uniqueness check. The per-tier tenant decision for a slug-served
  // artefact is the `AccessPolicy`'s (S22 part B / ET3), not the scope's.
  findBySlug(slug: string): Promise<Artefact | null>;
  // Owner's artefacts within the tenant scope, most-recently-updated first.
  // Active-only by default. OSS passes `SINGLETON_SCOPE` (no-op filter); a
  // superset passes the caller's active org, so the dashboard shows that org's
  // artefacts only (ET2/ET4).
  listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]>;
  // Active artefacts shared *to* the viewer within the tenant scope — visibility
  // `authenticated` or `public`, plus `selected` artefacts the viewer is a member
  // of (S16) — most-recently-updated first. "Shared with you" (S14) means
  // *others'* artefacts, so the viewer's own are excluded (they live in "Your
  // artefacts"). Private never appears (AH8). Scoping to the active org makes
  // "Shared with you" org-scoped in a superset (ET3); OSS passes the singleton.
  // **Top-level artefacts only** (`collectionId = null`): an artefact inside a
  // collection has its own tier dormant (AH20/CL5) — the effectively-shared
  // composition adds those via `listByCollectionIds` + the shared roots.
  listShared(viewerId: string, scope: TenantScope): Promise<Artefact[]>;
  // Artefacts whose `collectionId` is in the given set, within the tenant scope.
  // Active-only by default; the cascade commands pass `includeArchived` (CL7/8).
  listByCollectionIds(
    collectionIds: readonly string[],
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]>;
}
