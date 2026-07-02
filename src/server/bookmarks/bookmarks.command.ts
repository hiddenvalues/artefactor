import type { Artefact } from "../../domain/artefact/artefact";
import type { Collection } from "../../domain/collection/collection";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

// Application commands for S27 — Bookmarks (BM1–BM4). Per-user pins with set
// semantics; own-items-only in v1 (BM2) — a non-owned target answers uniform
// not-found, so nothing leaks. Bookmarks never affect access (BM3).

export interface BookmarkDeps {
  bookmarkRepo: BookmarkRepository;
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
}

async function assertOwnArtefact(
  artefactId: string,
  userId: string,
  scope: TenantScope,
  deps: BookmarkDeps,
): Promise<void> {
  const artefact = await deps.artefactRepo.findById(artefactId, scope);
  if (!artefact || artefact.ownerId !== userId) {
    throw new ArtefactNotFound(artefactId); // BM2 + no-leak
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
  await assertOwnArtefact(input.artefactId, input.requesterId, input.scope, deps);
  if (input.bookmarked) {
    await deps.bookmarkRepo.addArtefact(input.requesterId, input.artefactId);
  } else {
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
  await assertOwnCollection(
    input.collectionId,
    input.requesterId,
    input.scope,
    deps,
  );
  if (input.bookmarked) {
    await deps.bookmarkRepo.addCollection(input.requesterId, input.collectionId);
  } else {
    await deps.bookmarkRepo.removeCollection(
      input.requesterId,
      input.collectionId,
    );
  }
}

// The caller's bookmarks resolved to live targets. Archived targets are
// filtered at read time (BM3) — the rows survive archive/restore. Own items
// only (BM2), so the owner listings suffice to resolve them.
export async function listBookmarks(
  input: { requesterId: string; scope: TenantScope },
  deps: BookmarkDeps,
): Promise<{ artefacts: Artefact[]; collections: Collection[] }> {
  const marks = await deps.bookmarkRepo.listByUser(input.requesterId);
  const artefactIds = new Set(marks.artefactIds);
  const collectionIds = new Set(marks.collectionIds);

  const artefacts =
    artefactIds.size === 0
      ? []
      : (
          await deps.artefactRepo.listByOwner(input.requesterId, input.scope)
        ).filter((a) => artefactIds.has(a.id));
  const collections =
    collectionIds.size === 0
      ? []
      : (
          await deps.collectionRepo.listByOwner(input.requesterId, input.scope)
        ).filter((c) => collectionIds.has(c.id));

  return { artefacts, collections };
}
