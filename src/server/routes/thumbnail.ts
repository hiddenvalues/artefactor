import { Hono } from "hono";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import { linkGateChallenged, linkPassesOf } from "../link-gate/passes";
import type { ThumbnailStore } from "../../domain/artefact/ports";
import type { AccessPolicy } from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveEffectiveRead } from "../collections/effective";
import type { Artefact } from "../../domain/artefact/artefact";
import type { LinkGate } from "../../domain/artefact/link-gate";
import { resolveViewableArtefact, resolveViewableArtefactBySlug } from "../data/own-data.command";
import type { AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";

export interface ThumbnailRoutesDeps {
  artefactRepo: ArtefactRepository;
  // hosting.access.effective-from-tree-root — the access decision needs the effective tier
  // (collection tree root).
  collectionRepo: CollectionRepository;
  thumbnailStore: ThumbnailStore;
  // S22 (hosting.tenant.invisible-to-oss) — resolves the request's tenant scope for the id-fallback
  // resolve.
  resolveScope: TenantScopeResolver;
  // S22 (hosting.access.policy-decided) — decides the `authenticated` tier for the slug-resolved
  // artefact.
  accessPolicy?: AccessPolicy;
}

// S35 — an artefact's card thumbnail. Mounted at `/api/artefacts/:ref/thumbnail`, where `:ref` is
// the slug or the id for a signed-in caller, and the slug only for an anonymous one (S44).
// Resolution and the access matrix are the download's own (`resolveViewableArtefact`), so the
// effective tier (hosting.access.effective-from-tree-root), the `AccessPolicy` cell
// (hosting.access.policy-decided) and the S32a link gate
// (hosting.link-gate.narrows-public-audience) are inherited. Unknown, not viewable, archived and
// not-yet-rendered are one flat 404, to an anonymous caller as to anyone else.
//
// The `?v=<hash>` the summary appends only busts the cache; the recorded
// thumbnail is served whatever it says, so it may stay immutable for a year.
export function createThumbnailRoutes(deps: ThumbnailRoutesDeps) {
  const r = new Hono<AuthEnv>();

  // r[impl hosting.thumbnail.read-follows-export-matrix]
  r.get("/:ref/thumbnail", async (c) => {
    try {
      const viewerId = c.get("user")?.id ?? null;
      const ref = c.req.param("ref");
      // r[impl hosting.thumbnail.anonymous-by-slug]
      const artefact =
        viewerId === null
          ? await resolveViewableArtefactBySlug(deps, ref, linkPassesOf(c))
          : await resolveViewableArtefact(
              deps,
              ref,
              viewerId,
              await deps.resolveScope(c),
              linkPassesOf(c),
            );
      if (artefact.thumbnailHash === null) return c.notFound();
      const image = await deps.thumbnailStore.get(artefact.id, artefact.thumbnailHash);
      if (!image) return c.notFound();
      // S32b — the gate that applies is the effective one (the tree root's when
      // contained), not the artefact's own.
      const { gate } = (await resolveEffectiveRead(artefact, deps.collectionRepo)).linkGate;
      // The cast only narrows the store's `ArrayBufferLike` backing to the
      // `ArrayBuffer` a BodyInit is typed for; the bytes are never copied.
      return new Response(image as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": thumbnailCacheControl(viewerId, artefact, gate),
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

// Who may keep the image, and for how long, by audience (S44):
// - a non-owner's read of a link-gated artefact may depend on a pass that later
//   expires or is voided, so the browser must ask again (S32a);
// - an anonymous read is shareable, but only briefly, so the image stops being
//   served soon after the artefact leaves `public`;
// - every other signed-in read is addressed by its hash, so it never changes.
// r[impl hosting.thumbnail.cache-by-audience]
function thumbnailCacheControl(viewerId: string | null, artefact: Artefact, gate: LinkGate): string {
  const gated = gate.passwordHash !== null || gate.expiresAt !== null;
  if (viewerId !== artefact.ownerId && gated) return "private, no-store";
  if (viewerId === null) return "public, max-age=300";
  return "private, max-age=31536000, immutable";
}
