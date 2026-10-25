import { Hono } from "hono";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import { listBookmarks } from "../bookmarks/bookmarks.command";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { BookmarksResponse } from "../../shared/contracts";
import type { AccessPolicy } from "../../domain/artefact/access";
import { linkPassesOf } from "../link-gate/passes";
import { toArtefactSummary } from "./artefacts";
import { toCollectionSummary } from "./collections";

export interface BookmarkRoutesDeps {
  bookmarkRepo: BookmarkRepository;
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  resolveScope: TenantScopeResolver;
  accessPolicy?: AccessPolicy;
}

// S27 — the caller's bookmarks (`GET /api/bookmarks`): any artefact still viewable to them
// (collections.bookmark.artefact-view-gated, collections.bookmark.hidden-not-pruned, effective tier
// resolved in the command) plus any active collection whose root still grants them view
// (collections.bookmark.collection-view-gated). The toggle endpoints live on the
// artefact/collection resources (`PUT|DELETE …/:id/bookmark`).
export function createBookmarkRoutes(deps: BookmarkRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/", requireAuth, async (c) => {
    const { artefacts, collections } = await listBookmarks(
      { requesterId: ownerId(c), scope: await deps.resolveScope(c), passes: linkPassesOf(c) },
      deps,
    );
    return c.json<BookmarksResponse>({
      artefacts: artefacts.map(({ artefact, effectiveVisibility }) =>
        toArtefactSummary(artefact, effectiveVisibility),
      ),
      collections: collections.map((col) => toCollectionSummary(col, null)),
    });
  });

  return r;
}
