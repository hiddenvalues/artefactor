import { Hono } from "hono";
import {
  canLoadAuthorData,
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import { decideRead } from "../link-gate/authorize";
import { linkGateChallenged, linkPassesOf } from "../link-gate/passes";
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

// S36 (data.frame-token.minted-for-context) — `POST /api/artefacts/:ref/frame-token`: a fresh, tokened frame URL
// for the host shell — to switch the data context to another author (body
// `{ author }`), to reload after a conflict, or to replace an expired token.
//
// Signed in only. A slug ref is the shared link: gated by the access matrix like `…/data/authors`
// (effective tier hosting.access.effective-from-tree-root, policy hosting.access.policy-decided),
// it mints a `slug` token. An id ref is the owner preview: gated like `/:id/raw` (own, active, in
// scope), it mints a `raw` token carrying that scope. Any deny is a flat 404
// (hosting.access.no-existence-leak), and so is an `author` the owner's data visibility refuses the
// viewer (S41, data.visibility.mint-refused; the id ref is the owner's, who reaches every author). A slug ref also passes
// the link gate (S32a, hosting.link-gate.narrows-public-audience): without a pass → `403 { gate:
// "password" }`; the token carries the version the pass proved, so the redeem can re-check it.
// `seedUpdatedAt` is the seeded entry's `updatedAt` — the pin the shell's next save in the viewer's
// own context is conditioned on (S31).
// r[impl data.frame-token.minted-for-context]
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
      const passes = linkPassesOf(c);
      const { verdict, linkGate } = await decideRead({ ...deps, accessPolicy }, bySlug, viewerId, {
        passes,
        now: new Date(deps.framing.now()),
      });
      if (verdict === "challenge") return linkGateChallenged(c);
      if (verdict !== "granted") return c.notFound();
      // r[impl data.visibility.mint-refused]
      // A foreign author the owner's data visibility refuses is a flat 404.
      if (authorId !== null && !canLoadAuthorData(bySlug, viewerId, authorId)) {
        return c.notFound();
      }
      artefactId = bySlug.id;
      // S32b — the pass is the gate holder's: the tree root's when contained.
      const gate = passes(linkGate.holderId)?.version;
      minted = mintFrame(deps.framing, "slug", ref, {
        artefactId,
        viewerId,
        authorId,
        ...(gate !== undefined ? { gate, gateHolder: linkGate.holderId } : {}),
      });
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
