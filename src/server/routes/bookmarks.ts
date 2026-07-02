import { Hono } from "hono";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import { effectiveVisibility } from "../../domain/collection/effective-access";
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

// S27 — the caller's bookmarks (`GET /api/bookmarks`), resolved to live
// targets (archived ones filtered, BM3). The toggle endpoints live on the
// artefact/collection resources (`PUT|DELETE …/:id/bookmark`).
export function createBookmarkRoutes(deps: BookmarkRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/", requireAuth, async (c) => {
    const scope = await deps.resolveScope(c);
    const { artefacts, collections } = await listBookmarks(
      { requesterId: ownerId(c), scope },
      deps,
    );
    // Bookmarked artefacts may live in collections (BM2 makes them all the
    // caller's own) — resolve effective tiers from the owner's tree in one read.
    const all = await deps.collectionRepo.listByOwner(ownerId(c), scope, {
      includeArchived: true,
    });
    const byId = new Map(all.map((col) => [col.id, col]));
    return c.json<BookmarksResponse>({
      artefacts: artefacts.map((a) => {
        const root = a.collectionId
          ? (byId.get(byId.get(a.collectionId)?.rootId ?? "") ?? null)
          : null;
        return toArtefactSummary(a, effectiveVisibility(a, root));
      }),
      collections: collections.map(toCollectionSummary),
    });
  });

  return r;
}
