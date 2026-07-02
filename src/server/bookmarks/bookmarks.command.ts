import type { Artefact } from "../../domain/artefact/artefact";
import type { Collection } from "../../domain/collection/collection";
import type { Visibility } from "../../domain/artefact/visibility";
import { canViewArtefact } from "../../domain/artefact/access";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { resolveEffectiveViewable } from "../collections/effective";

// Application commands for S27 — Bookmarks (BM1–BM4). Per-user pins with set
// semantics covering **anything the user can view** (BM2): adding is gated on
// the effective access matrix (a non-viewable target answers uniform not-found,
// AH8), while removing one's own bookmark row is always allowed — it is the
// user's own data, and access may already have lapsed. Collections are
// owner-only objects in v1 (CL10), so their gate stays ownership.

export interface BookmarkDeps {
  bookmarkRepo: BookmarkRepository;
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
}

// A bookmarked artefact resolved for the sidebar list, with the tier it is
// effectively served under (AH20) so the summary mapper needs no re-resolution.
export interface BookmarkedArtefact {
  artefact: Artefact;
  effectiveVisibility: Visibility;
}

async function assertViewableArtefact(
  artefactId: string,
  userId: string,
  scope: TenantScope,
  deps: BookmarkDeps,
): Promise<void> {
  const artefact = await deps.artefactRepo.findById(artefactId, scope);
  if (
    !artefact ||
    !canViewArtefact(
      await resolveEffectiveViewable(artefact, deps.collectionRepo),
      userId,
    )
  ) {
    throw new ArtefactNotFound(artefactId); // BM2 + no-leak (AH8)
  }
}

async function assertOwnCollection(
  collectionId: string,
  userId: string,
  scope: TenantScope,
  deps: BookmarkDeps,
): Promise<void> {
  const collection = await deps.collectionRepo.findById(collectionId, scope);
  if (!collection || collection.ownerId !== userId) {
    throw new CollectionNotFound(collectionId); // BM2 + CL10
  }
}

export async function setArtefactBookmark(
  input: {
    artefactId: string;
    requesterId: string;
    bookmarked: boolean;
    scope: TenantScope;
  },
  deps: BookmarkDeps,
): Promise<void> {
  if (input.bookmarked) {
    // View-gated add (BM2): you can pin what you can open.
    await assertViewableArtefact(
      input.artefactId,
      input.requesterId,
      input.scope,
      deps,
    );
    await deps.bookmarkRepo.addArtefact(input.requesterId, input.artefactId);
  } else {
    // Removes are ungated (BM2) — deleting one's own row must work even after
    // the target was archived or access was revoked. Idempotent (BM1).
    await deps.bookmarkRepo.removeArtefact(input.requesterId, input.artefactId);
  }
}

export async function setCollectionBookmark(
  input: {
    collectionId: string;
    requesterId: string;
    bookmarked: boolean;
    scope: TenantScope;
  },
  deps: BookmarkDeps,
): Promise<void> {
  if (input.bookmarked) {
    await assertOwnCollection(
      input.collectionId,
      input.requesterId,
      input.scope,
      deps,
    );
    await deps.bookmarkRepo.addCollection(input.requesterId, input.collectionId);
  } else {
    await deps.bookmarkRepo.removeCollection(
      input.requesterId,
      input.collectionId,
    );
  }
}

// The caller's bookmarks resolved to live targets. Targets that are archived or
// no longer viewable are **hidden, not pruned** (BM3) — the row survives and
// the pin reappears on restore / re-share. Each surviving artefact carries its
// effective tier (the same resolution that just gated it).
export async function listBookmarks(
  input: { requesterId: string; scope: TenantScope },
  deps: BookmarkDeps,
): Promise<{ artefacts: BookmarkedArtefact[]; collections: Collection[] }> {
  const marks = await deps.bookmarkRepo.listByUser(input.requesterId);

  const artefacts: BookmarkedArtefact[] = [];
  for (const id of marks.artefactIds) {
    const artefact = await deps.artefactRepo.findById(id, input.scope);
    if (!artefact) continue;
    const viewable = await resolveEffectiveViewable(
      artefact,
      deps.collectionRepo,
    );
    if (!canViewArtefact(viewable, input.requesterId)) continue; // BM3 — hidden
    artefacts.push({ artefact, effectiveVisibility: viewable.visibility });
  }

  const collections: Collection[] = [];
  for (const id of marks.collectionIds) {
    const collection = await deps.collectionRepo.findById(id, input.scope);
    // Own + active only (CL10 / BM3): archived ones reappear on restore.
    if (!collection || collection.ownerId !== input.requesterId) continue;
    if (collection.status !== "active") continue;
    collections.push(collection);
  }

  return { artefacts, collections };
}
