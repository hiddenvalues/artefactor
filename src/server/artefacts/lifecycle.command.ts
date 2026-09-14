import {
  archiveArtefact,
  assertDeletable,
  restoreArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { PayloadStore, ThumbnailStore } from "../../domain/artefact/ports";
import { loadOwnActiveArtefact, loadOwnArtefact } from "./get-own-artefact";

// Application commands for S7 — Archive / restore. Owner-only lifecycle moves;
// the pure domain transitions enforce the status guards.
export interface LifecycleInput {
  artefactId: string;
  requesterId: string;
  scope: TenantScope; // the caller's tenant scope (S22/AH17)
}

export interface LifecycleDeps {
  repo: ArtefactRepository;
  now?: () => Date;
}

// Permanent delete (S15, AH11) needs to remove the payload file, the data
// entries, and the view entries (S21/VT5) alongside the aggregate row, so it
// carries extra ports.
export interface DeleteArtefactDeps {
  repo: ArtefactRepository;
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  // S27 (BM4) — permanent delete also removes every user's bookmark of it.
  bookmarkRepo: BookmarkRepository;
  payloadStore: PayloadStore;
  // S35 (AH11 amendment) — permanent delete also removes the thumbnail files.
  thumbnailStore: ThumbnailStore;
}

// Archive an active artefact the caller owns (AH7). Non-owner / unknown /
// already-archived → not-found (loadOwnActiveArtefact excludes non-active).
export async function archiveArtefactCommand(
  input: LifecycleInput,
  deps: LifecycleDeps,
): Promise<Artefact> {
  const existing = await loadOwnActiveArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const archived = archiveArtefact(existing, { now: deps.now?.() });
  await deps.repo.save(archived);
  return archived;
}

// Restore an archived artefact the caller owns (AH9). Loads regardless of status
// (non-owner / unknown → not-found); `restoreArtefact` rejects a non-archived one.
export async function restoreArtefactCommand(
  input: LifecycleInput,
  deps: LifecycleDeps,
): Promise<Artefact> {
  const existing = await loadOwnArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const restored = restoreArtefact(existing, { now: deps.now?.() });
  await deps.repo.save(restored);
  return restored;
}

// Permanently delete an archived artefact the caller owns (S15, AH11). Loads
// regardless of status (non-owner / unknown → not-found, so existence doesn't
// leak); `assertDeletable` rejects a non-archived one (→ InvariantViolation).
// Removes the payload file, data entries, and view entries before the row so
// nothing is orphaned (the FK cascades are a DB-level backstop).
export async function deleteArtefactCommand(
  input: LifecycleInput,
  deps: DeleteArtefactDeps,
): Promise<void> {
  const existing = await loadOwnArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  assertDeletable(existing);
  await deps.payloadStore.delete(existing.payloadRef);
  await deps.thumbnailStore.deleteAll(existing.id); // AH11 (S35)
  await deps.dataRepo.deleteByArtefact(existing.id);
  await deps.viewRepo.deleteByArtefact(existing.id);
  await deps.bookmarkRepo.deleteByArtefact(existing.id); // BM4
  await deps.repo.delete(existing.id);
}
