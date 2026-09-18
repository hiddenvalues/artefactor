import { Hono, type Context } from "hono";
import {
  canViewArtefactUnder,
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { PayloadStore } from "../../domain/artefact/ports";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { resolveEffectiveViewable } from "../collections/effective";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { frameChannel, verifyFrameToken, type FrameTokenClaims } from "../runtime/frame-token";
import { frameTargetOrigin, type Framing } from "../runtime/framing";
import { renderExpiredFramePage, renderServedArtefact } from "../runtime/render";
import { frameSecurityHeaders } from "../runtime/sandbox";

export interface FrameRoutesDeps {
  repo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  payloadStore: PayloadStore;
  dataRepo: DataRepository;
  accessPolicy?: AccessPolicy;
  framing: Framing;
}

// The two frame routes, whose paths `createApp` and the content-host gate share.
export const SLUG_FRAME_ROUTE = "/a/:slug/frame";
export const RAW_FRAME_ROUTE = "/api/artefacts/:id/raw/frame";

// S36 (AH28, AD10) — the artefact itself, inside the shell's sandboxed iframe.
// Mounted by `createApp` **before** the `/a` and `/api` routers, so their
// attach-session middleware never runs here: a frame authenticates only from
// its `?t=` frame token, never from cookies. Every response — the artefact, the
// expired-token page, a 404 — carries the sandbox CSP.
//
// Redeem: verify the signature and `exp`; the token's artefact and route must
// match the URL; then the route's own access check is re-run for the token's
// viewer, so a revocation is effective immediately. Any deny is a flat 404
// (AH7/AH8). Seed = `authorId ?? viewerId`; writable only in the viewer's own
// context (AD5).
export function createFrameRoutes(deps: FrameRoutesDeps) {
  const app = new Hono();
  const accessPolicy = deps.accessPolicy ?? defaultAccessPolicy;

  app.use(SLUG_FRAME_ROUTE, sandboxed);
  app.use(RAW_FRAME_ROUTE, sandboxed);

  // Served by slug: the anonymous may load it token-less when the matrix admits
  // an anonymous viewer (a `public` artefact), read-only.
  app.get(SLUG_FRAME_ROUTE, async (c) => {
    const artefact = await deps.repo.findBySlug(c.req.param("slug"));
    const token = c.req.query("t");
    let claims: Pick<FrameTokenClaims, "viewerId" | "authorId"> = {
      viewerId: null,
      authorId: null,
    };
    // An anonymous frame is read-only and never posts, so it has no channel.
    let channel: string | null = null;
    if (token !== undefined) {
      const verdict = verifyFrameToken(token, deps.framing.secret, deps.framing.now());
      if (
        verdict.status === "invalid" ||
        verdict.claims.route !== "slug" ||
        !artefact ||
        verdict.claims.artefactId !== artefact.id
      ) {
        return c.notFound();
      }
      if (verdict.status === "expired") return expired(c);
      claims = verdict.claims;
      channel = frameChannel(token, deps.framing.secret);
    }
    if (
      !artefact ||
      !(await canViewArtefactUnder(
        accessPolicy,
        await resolveEffectiveViewable(artefact, deps.collectionRepo),
        claims.viewerId,
      ))
    ) {
      return c.notFound();
    }
    return serve(c, artefact, claims, channel);
  });

  // The owner preview: token only, and only its owner, active, in the tenant
  // scope the token was minted under.
  app.get(RAW_FRAME_ROUTE, async (c) => {
    const id = c.req.param("id");
    const token = c.req.query("t");
    if (token === undefined) return c.notFound();
    const verdict = verifyFrameToken(token, deps.framing.secret, deps.framing.now());
    if (
      verdict.status === "invalid" ||
      verdict.claims.route !== "raw" ||
      verdict.claims.artefactId !== id ||
      verdict.claims.viewerId === null ||
      verdict.claims.tenantId === undefined
    ) {
      return c.notFound();
    }
    if (verdict.status === "expired") return expired(c);
    try {
      const artefact = await loadOwnActiveArtefact(deps.repo, {
        id,
        ownerId: verdict.claims.viewerId,
        scope: { tenantId: verdict.claims.tenantId },
      });
      return serve(c, artefact, verdict.claims, frameChannel(token, deps.framing.secret));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  async function serve(
    c: Context,
    artefact: Artefact,
    claims: Pick<FrameTokenClaims, "viewerId" | "authorId">,
    channel: string | null,
  ) {
    const html = await renderServedArtefact(artefact, claims.viewerId, deps, {
      authorId: claims.authorId,
      targetOrigin: frameTargetOrigin(deps.framing, c.req.url),
      channel,
    });
    return c.html(html);
  }

  function expired(c: Context) {
    return c.html(renderExpiredFramePage(frameTargetOrigin(deps.framing, c.req.url)));
  }

  return app;
}

async function sandboxed(c: Context, next: () => Promise<void>) {
  await next();
  for (const [name, value] of Object.entries(frameSecurityHeaders())) {
    c.res.headers.set(name, value);
  }
}
