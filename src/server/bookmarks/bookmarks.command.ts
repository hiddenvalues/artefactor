import type { Artefact } from "../../domain/artefact/artefact";
import type { Collection } from "../../domain/collection/collection";
import type { Visibility } from "../../domain/artefact/visibility";
import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { resolveEffectiveViewable } from "../collections/effective";
import { authorizeRead, decideCollectionRead, memoizedPolicy } from "../link-gate/authorize";
import type { PassLookup } from "../link-gate/passes";

// Application commands for S27 — Bookmarks. Per-user pins with set semantics
// covering **anything the user can view**: adding is gated on the read
// authorization (S32a — the effective access matrix under the access policy, then
// the link gate; a non-viewable target answers uniform not-found,
// hosting.access.matrix), and the list hides by the same decision, while removing one's own bookmark row is always allowed — it is the
// user's own data, and access may already have lapsed. Collections follow the
// same rule via collections.read.follows-root: any collection whose root grants
// the signed-in user view may be bookmarked (S28).

export interface BookmarkDeps {
  bookmarkRepo: BookmarkRepository;
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  // The deployment's policy for the `authenticated` tier (hosting.access.policy-decided);
  // the OSS default when absent.
  accessPolicy?: AccessPolicy;
}

// A bookmarked artefact resolved for the sidebar list, with the tier it is effectively served under
// (hosting.access.effective-from-tree-root) so the summary mapper needs no re-resolution.
export interface BookmarkedArtefact {
  artefact: Artefact;
  effectiveVisibility: Visibility;
}

async function assertViewableArtefact(
  artefactId: string,
  userId: string,
  scope: TenantScope,
  passes: PassLookup | undefined,
  deps: BookmarkDeps,
): Promise<void> {
  const artefact = await deps.artefactRepo.findById(artefactId, scope);
  // The one read authorization (S32a): the matrix under the access policy, then
  // the link gate with the request's passes. A policy-refused, gated (no pass) or
  // expired artefact is as unbookmarkable as a missing one (hosting.access.matrix).
  if (!artefact || (await authorizeRead(deps, artefact, userId, { passes })) !== "granted") {
    throw new ArtefactNotFound(artefactId); // no-leak (hosting.access.no-existence-leak)
  }
}

// Resolve a collection and decide it by the one read decision on its tree root
// (collections.read.follows-root — the access policy, then the root's link gate
// with the request's passes). Returns null for missing / archived-node /
// non-granting — the callers treat all three uniformly (no leak,
// collections.access.no-existence-leak).
async function loadViewableCollection(
  collectionId: string,
  userId: string,
  scope: TenantScope,
  passes: PassLookup | undefined,
  deps: BookmarkDeps,
): Promise<Collection | null> {
  const collection = await deps.collectionRepo.findById(collectionId, scope);
  if (!collection || collection.status !== "active") return null;
  const { granted } = await decideCollectionRead(deps, collection, userId, { scope, passes });
  return granted ? collection : null;
}

// r[impl collections.bookmark.artefact-view-gated]
export async function setArtefactBookmark(
  input: {
    artefactId: string;
    requesterId: string;
    bookmarked: boolean;
    scope: TenantScope;
    // The request's link passes (S32a); a gated artefact the caller unlocked can be added.
    passes?: PassLookup;
  },
  deps: BookmarkDeps,
): Promise<void> {
  if (input.bookmarked) {
    // View-gated add: you can pin what you can open.
    await assertViewableArtefact(
      input.artefactId,
      input.requesterId,
      input.scope,
      input.passes,
      deps,
    );
    await deps.bookmarkRepo.addArtefact(input.requesterId, input.artefactId);
  } else {
    // Removes are ungated — deleting one's own row must work even after the
    // target was archived or access was revoked. Idempotent
    // (collections.bookmark.set-semantics).
    await deps.bookmarkRepo.removeArtefact(input.requesterId, input.artefactId);
  }
}

// r[impl collections.bookmark.collection-view-gated+2]
export async function setCollectionBookmark(
  input: {
    collectionId: string;
    requesterId: string;
    bookmarked: boolean;
    scope: TenantScope;
    // The request's link passes (S32b); a tree whose gated root the caller unlocked can be added.
    passes?: PassLookup;
  },
  deps: BookmarkDeps,
): Promise<void> {
  if (input.bookmarked) {
    // View-gated add: you can pin any collection you can open.
    const viewable = await loadViewableCollection(
      input.collectionId,
      input.requesterId,
      input.scope,
      input.passes,
      deps,
    );
    if (!viewable) throw new CollectionNotFound(input.collectionId);
    await deps.bookmarkRepo.addCollection(input.requesterId, input.collectionId);
  } else {
    await deps.bookmarkRepo.removeCollection(
      input.requesterId,
      input.collectionId,
    );
  }
}

// The caller's bookmarks resolved to live targets. Targets that are archived or
// no longer viewable — by the same read authorization that gates an add, with the
// request's link passes, so a gated artefact the caller has unlocked stays listed —
// are **hidden, not pruned**: the row survives and the pin reappears on restore /
// re-share. Each surviving artefact carries its effective tier.
// r[impl collections.bookmark.hidden-not-pruned]
export async function listBookmarks(
  input: { requesterId: string; scope: TenantScope; passes?: PassLookup },
  deps: BookmarkDeps,
): Promise<{ artefacts: BookmarkedArtefact[]; collections: Collection[] }> {
  const marks = await deps.bookmarkRepo.listByUser(input.requesterId);
  // One policy answer per (viewer, tenant) for the whole list.
  deps = { ...deps, accessPolicy: memoizedPolicy(deps.accessPolicy ?? defaultAccessPolicy) };

  const artefacts: BookmarkedArtefact[] = [];
  for (const id of marks.artefactIds) {
    const artefact = await deps.artefactRepo.findById(id, input.scope);
    if (!artefact) continue;
    const verdict = await authorizeRead(deps, artefact, input.requesterId, {
      passes: input.passes,
    });
    if (verdict !== "granted") continue; // hidden, not pruned
    const viewable = await resolveEffectiveViewable(artefact, deps.collectionRepo);
    artefacts.push({ artefact, effectiveVisibility: viewable.visibility });
  }

  const collections: Collection[] = [];
  for (const id of marks.collectionIds) {
    // Viewable + active only: archived or no-longer-granting ones are hidden,
    // not pruned — they reappear on restore / re-share.
    const collection = await loadViewableCollection(
      id,
      input.requesterId,
      input.scope,
      input.passes,
      deps,
    );
    if (collection) collections.push(collection);
  }

  return { artefacts, collections };
}
