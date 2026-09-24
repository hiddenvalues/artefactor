import { Hono } from "hono";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import { linkGateChallenged, linkPassesOf } from "../link-gate/passes";
import type { ThumbnailStore } from "../../domain/artefact/ports";
import type { AccessPolicy } from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveViewableArtefact } from "../data/own-data.command";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";

export interface ThumbnailRoutesDeps {
  artefactRepo: ArtefactRepository;
  // AH20 — the access decision needs the effective tier (collection tree root).
  collectionRepo: CollectionRepository;
  thumbnailStore: ThumbnailStore;
  // S22 (AH17) — resolves the request's tenant scope for the id-fallback resolve.
  resolveScope: TenantScopeResolver;
  // S22 (AH18) — decides the `authenticated` tier for the slug-resolved artefact.
  accessPolicy?: AccessPolicy;
}

// S35 — an artefact's card thumbnail. Mounted at `/api/artefacts/:ref/thumbnail`,
// where `:ref` is the slug or the id. Unlike the S30 download it is **signed-in
// only** (AH27): an anonymous caller gets 401 whatever the ref, which says nothing
// about any artefact (AH8). Past that, resolution and the access matrix are the
// download's own (`resolveViewableArtefact`), so the effective tier (AH20), the
// `AccessPolicy` cell (AH18) and the S32a link gate (AH22) are inherited.
// Unknown, not viewable, archived and not-yet-rendered are one flat 404.
//
// The `?v=<hash>` the summary appends only busts the cache; the recorded
// thumbnail is served whatever it says, so it may stay immutable for a year.
export function createThumbnailRoutes(deps: ThumbnailRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/:ref/thumbnail", requireAuth, async (c) => {
    try {
      const artefact = await resolveViewableArtefact(
        deps,
        c.req.param("ref"),
        c.get("user")!.id,
        await deps.resolveScope(c),
        linkPassesOf(c),
      );
      if (artefact.thumbnailHash === null) return c.notFound();
      const image = await deps.thumbnailStore.get(artefact.id, artefact.thumbnailHash);
      if (!image) return c.notFound();
      // The cast only narrows the store's `ArrayBufferLike` backing to the
      // `ArrayBuffer` a BodyInit is typed for; the bytes are never copied.
      return new Response(image as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": String(image.byteLength),
        },
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      if (err instanceof LinkGateChallenge) return linkGateChallenged(c);
      throw err;
    }
  });

  return r;
}
