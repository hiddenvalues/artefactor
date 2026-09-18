import { Hono } from "hono";
import {
  canViewArtefactUnder,
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import { resolveEffectiveViewable } from "../collections/effective";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { mintFrame, type Framing, type MintedFrame } from "../runtime/framing";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { FrameTokenResponse } from "../../shared/contracts";

export interface FrameTokenRoutesDeps {
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  dataRepo: DataRepository;
  resolveScope: TenantScopeResolver;
  accessPolicy?: AccessPolicy;
  framing: Framing;
}

// S36 (AD10) — `POST /api/artefacts/:ref/frame-token`: a fresh, tokened frame URL
// for the host shell — to switch the data context to another author (body
// `{ author }`), to reload after a conflict, or to replace an expired token.
//
// Signed in only. A slug ref is the shared link: gated by the access matrix like
// `…/data/authors` (effective tier AH20, policy AH18), it mints a `slug` token.
// An id ref is the owner preview: gated like `/:id/raw` (own, active, in scope),
// it mints a `raw` token carrying that scope. Any deny is a flat 404 (AH8).
// `seedUpdatedAt` is the seeded entry's `updatedAt` — the pin the shell's next
// save in the viewer's own context is conditioned on (S31).
export function createFrameTokenRoutes(deps: FrameTokenRoutesDeps) {
  const r = new Hono<AuthEnv>();
  const accessPolicy = deps.accessPolicy ?? defaultAccessPolicy;

  r.post("/:ref/frame-token", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { author?: unknown };
    if (body.author !== undefined && body.author !== null && typeof body.author !== "string") {
      return c.json({ error: "author must be a user id" }, 400);
    }
    const viewerId = ownerId(c);
    const ref = c.req.param("ref");
    // Your own id as the author is simply your own (writable) context.
    const authorId = body.author && body.author !== viewerId ? body.author : null;

    const bySlug = await deps.artefactRepo.findBySlug(ref);
    let minted: MintedFrame;
    let artefactId: string;
    if (bySlug) {
      const viewable = await canViewArtefactUnder(
        accessPolicy,
        await resolveEffectiveViewable(bySlug, deps.collectionRepo),
        viewerId,
      );
      if (!viewable) return c.notFound();
      artefactId = bySlug.id;
      minted = mintFrame(deps.framing, "slug", ref, { artefactId, viewerId, authorId });
    } else {
      const scope = await deps.resolveScope(c);
      try {
        const own = await loadOwnActiveArtefact(deps.artefactRepo, {
          id: ref,
          ownerId: viewerId,
          scope,
        });
        artefactId = own.id;
      } catch (err) {
        if (err instanceof ArtefactNotFound) return c.notFound();
        throw err;
      }
      minted = mintFrame(deps.framing, "raw", artefactId, {
        artefactId,
        viewerId,
        authorId,
        tenantId: scope.tenantId,
      });
    }

    const entry = await deps.dataRepo.findByArtefactAndAuthor(artefactId, authorId ?? viewerId);
    return c.json<FrameTokenResponse>({
      frameUrl: minted.frameUrl,
      channel: minted.channel,
      seedUpdatedAt: entry?.updatedAt.toISOString() ?? null,
    });
  });

  return r;
}
