import {
  archiveArtefact,
  assertDeletable,
  restoreArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { assertRestorableIn } from "../../domain/collection/collection";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { PayloadStore, ThumbnailStore } from "../../domain/artefact/ports";
import { loadOwnActiveArtefact, loadOwnArtefact } from "./get-own-artefact";
import { mutateArtefact } from "./mutate-artefact";

// Application commands for S7 — Archive / restore. Owner-only lifecycle moves;
// the pure domain transitions enforce the status guards.
export interface LifecycleInput {
  artefactId: string;
  requesterId: string;
  scope: TenantScope; // the caller's tenant scope (S22, hosting.tenant.invisible-to-oss)
}

export interface LifecycleDeps {
  repo: ArtefactRepository;
  now?: () => Date;
}

// Permanent delete (S15, hosting.delete.removes-everything) needs to remove the
// payload file, the data entries, and the view entries (S21,
// views.lifecycle.removed-with-artefact) alongside the aggregate row, so it
// carries extra ports.
export interface DeleteArtefactDeps {
  repo: ArtefactRepository;
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  // S27 (collections.bookmark.removed-with-target) — permanent delete also removes every user's bookmark of it.
  bookmarkRepo: BookmarkRepository;
  payloadStore: PayloadStore;
  // S35 (the thumbnail clause of hosting.delete.removes-everything) — permanent
  // delete also removes the thumbnail files.
  thumbnailStore: ThumbnailStore;
}

// Archive an active artefact the caller owns (hosting.lifecycle.archive-stamps-archived-at).
// Non-owner / unknown / already-archived → not-found (loadOwnActiveArtefact
// excludes non-active).
export async function archiveArtefactCommand(
  input: LifecycleInput,
  deps: LifecycleDeps,
): Promise<Artefact> {
  const now = deps.now?.();
  return mutateArtefact(deps.repo, {
    load: () =>
      loadOwnActiveArtefact(deps.repo, {
        id: input.artefactId,
        ownerId: input.requesterId,
        scope: input.scope,
      }),
    apply: (existing) => archiveArtefact(existing, { now }),
  });
}

// Restore needs the owner's collection tree: an artefact under an archived
// collection is restored only with it (collections.lifecycle.restore-under-active-parent).
export interface RestoreArtefactDeps extends LifecycleDeps {
  collectionRepo: CollectionRepository;
}

// Restore an archived artefact the caller owns (hosting.authority.owner-only).
// Loads regardless of status (non-owner / unknown → not-found); `restoreArtefact`
// rejects a non-archived one, then an archived collection in its chain refuses
// it, before any save. The owner's tree is enough: a foreign artefact never
// sits in an archived tree (collections.lifecycle.cascades-evict-foreign).
export async function restoreArtefactCommand(
  input: LifecycleInput,
  deps: RestoreArtefactDeps,
): Promise<Artefact> {
  const now = deps.now?.();
  return mutateArtefact(deps.repo, {
    load: () =>
      loadOwnArtefact(deps.repo, {
        id: input.artefactId,
        ownerId: input.requesterId,
        scope: input.scope,
      }),
    apply: async (existing) => {
      const restored = restoreArtefact(existing, { now });
      if (existing.collectionId !== null) {
        const tree = await deps.collectionRepo.listByOwner(existing.ownerId, input.scope, {
          includeArchived: true,
        });
        assertRestorableIn(
          {
            kind: "artefact",
            id: existing.id,
            name: existing.title,
            parentId: existing.collectionId,
          },
          tree,
        );
      }
      return restored;
    },
  });
}

// Permanently delete an archived artefact the caller owns (S15,
// hosting.delete.archived-only). Loads regardless of status (non-owner / unknown
// → not-found, so existence doesn't leak); `assertDeletable` rejects a
// non-archived one (→ InvariantViolation). Removes the payload file, data
// entries, and view entries before the row so nothing is orphaned (the FK
// cascades are a DB-level backstop).
// r[impl hosting.delete.removes-everything+2]
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
  // Derived thumbnails first (hosting.delete.removes-everything, S35): if their
  // cleanup fails, the artefact is still whole — a missing thumbnail is
  // recoverable, a missing payload not.
  await deps.thumbnailStore.deleteAll(existing.id);
  await deps.payloadStore.delete(existing.payloadRef);
  // r[impl data.entry.lifecycle-bound]
  await deps.dataRepo.deleteByArtefact(existing.id);
  // r[impl views.lifecycle.removed-with-artefact]
  await deps.viewRepo.deleteByArtefact(existing.id);
  await deps.bookmarkRepo.deleteByArtefact(existing.id); // collections.bookmark.removed-with-target
  await deps.repo.delete(existing.id);
}
