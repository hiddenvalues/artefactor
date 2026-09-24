import { Hono } from "hono";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import { linkGateChallenged, linkPassesOf } from "../link-gate/passes";
import type { PayloadStore } from "../../domain/artefact/ports";
import type { AccessPolicy } from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveViewableArtefact } from "../data/own-data.command";
import type { AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import {
  artefactFilename,
  attachmentDisposition,
} from "../../shared/artefact-filename";

export interface DownloadRoutesDeps {
  artefactRepo: ArtefactRepository;
  // AH20 — the access decision needs the effective tier (collection tree root).
  collectionRepo: CollectionRepository;
  payloadStore: PayloadStore;
  // S22 (AH17) — resolves the request's tenant scope for the id-fallback resolve.
  resolveScope: TenantScopeResolver;
  // S22 (AH18) — decides the `authenticated` tier for the slug-resolved artefact.
  accessPolicy?: AccessPolicy;
}

// S30 — export an artefact's HTML. Mounted at `/api/artefacts/:ref/download`,
// where `:ref` is the artefact's slug or its id (the id form is what the owner's
// dashboard uses for a never-shared artefact). Resolution and the access matrix
// are the *same* ones the data reads use (`resolveViewableArtefact`), so
// effective-tier resolution through a collection root (AH20) and the
// `AccessPolicy` cell (AH18) are inherited, not re-implemented: unknown ref,
// not-viewable, and archived all surface as a flat 404 (AH7/AH8).
//
// The body is the **stored** payload, verbatim — never the injected render: no
// S13 localStorage bootstrap and no S12 host shell. That is what makes the
// download round-trip (download → edit → re-upload / `update_artefact` yields
// the same artefact), and it keeps the export honest about what is hosted.
export function createDownloadRoutes(deps: DownloadRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/:ref/download", async (c) => {
    const ref = c.req.param("ref");
    try {
      const artefact = await resolveViewableArtefact(
        deps,
        ref,
        c.get("user")?.id ?? null,
        await deps.resolveScope(c),
        linkPassesOf(c),
      );
      const payload = await deps.payloadStore.get(artefact.payloadRef);
      // Name the file after the title; a title with no letters or digits at all
      // falls back to the handle the caller already has (slug, else id).
      const filename = artefactFilename(
        artefact.title,
        artefact.publicSlug ?? artefact.id,
      );
      // A raw Response (rather than `c.body`) so the stored bytes go out
      // untouched — the payload is an opaque byte array, not a Hono body type.
      // The cast only narrows the store's `ArrayBufferLike` backing to the
      // `ArrayBuffer` a BodyInit is typed for; the bytes are never copied.
      return new Response(payload as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Content-Disposition": attachmentDisposition(filename),
          // The bytes actually being sent, which for a healthy store is the
          // aggregate's `payloadBytes` — taking it from the body means a
          // store/row disagreement can never produce a malformed response.
          "Content-Length": String(payload.byteLength),
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
