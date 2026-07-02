import { Hono } from "hono";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import { listBookmarks } from "../bookmarks/bookmarks.command";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { BookmarksResponse } from "../../shared/contracts";
import { toArtefactSummary } from "./artefacts";
import { toCollectionSummary } from "./collections";

export interface BookmarkRoutesDeps {
  bookmarkRepo: BookmarkRepository;
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  resolveScope: TenantScopeResolver;
}

// S27 — the caller's bookmarks (`GET /api/bookmarks`): any artefact still
// viewable to them (BM2/BM3, effective tier resolved in the command) plus their
// own active collections. The toggle endpoints live on the artefact/collection
// resources (`PUT|DELETE …/:id/bookmark`).
export function createBookmarkRoutes(deps: BookmarkRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/", requireAuth, async (c) => {
    const { artefacts, collections } = await listBookmarks(
      { requesterId: ownerId(c), scope: await deps.resolveScope(c) },
      deps,
    );
    return c.json<BookmarksResponse>({
      artefacts: artefacts.map(({ artefact, effectiveVisibility }) =>
        toArtefactSummary(artefact, effectiveVisibility),
      ),
      collections: collections.map(toCollectionSummary),
    });
  });

  return r;
}
