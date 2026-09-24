import { Hono } from "hono";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import { linkGateChallenged, linkPassesOf } from "../link-gate/passes";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import { listArtefactViewers } from "../views/views.command";
import type { UserDirectory } from "../data/user-directory";
import type { AccessPolicy } from "../../domain/artefact/access";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { ArtefactViewersResponse } from "../../shared/contracts";

export interface ViewRoutesDeps {
  artefactRepo: ArtefactRepository;
  // AH20 — the access decision needs the effective tier (collection tree root).
  collectionRepo: CollectionRepository;
  viewRepo: ViewRepository;
  userDirectory: UserDirectory;
  // S22 (AH17) — resolves the request's tenant scope for the id-fallback resolve.
  resolveScope: TenantScopeResolver;
  // S22 (AH18) — decides the `authenticated` tier for the slug-resolved artefact.
  accessPolicy?: AccessPolicy;
}

// S21 — Artefact Views. Mounted at `/api/artefacts/:ref/viewers`, where `:ref`
// is the artefact's slug or its id. Unlike the data-context reads (which are
// access-matrix gated but not auth-gated, AD4), the "viewed by" list is
// **signed-in only**: it is surfaced solely in the signed-in host chrome and
// lists *people* who viewed, so anonymous callers have no place here (VT4).
// There is deliberately no record endpoint — a view is recorded server-side as
// a side effect of serving the host shell (VT3), so it can't be spoofed.
export function createViewRoutes(deps: ViewRoutesDeps) {
  const r = new Hono<AuthEnv>();

  // `:ref` comes from the mount path (`/api/artefacts/:ref/viewers`), so it is
  // always present at runtime though Hono types it as optional.
  const refOf = (c: { req: { param: (k: "ref") => string | undefined } }) =>
    c.req.param("ref") ?? "";

  // The other viewers who have opened this artefact, enriched with name/email
  // for the widget label. Excludes the caller (VT4). Gated by the access matrix
  // inside the command (missing / archived / not-viewable → 404).
  r.get("/", requireAuth, async (c) => {
    try {
      const refs = await listArtefactViewers(
        refOf(c),
        ownerId(c),
        await deps.resolveScope(c),
        {
          artefactRepo: deps.artefactRepo,
          collectionRepo: deps.collectionRepo,
          viewRepo: deps.viewRepo,
          accessPolicy: deps.accessPolicy,
        },
        linkPassesOf(c),
      );
      const identities = await deps.userDirectory.lookup(
        refs.map((v) => v.viewerId),
      );
      return c.json<ArtefactViewersResponse>({
        viewers: refs.map((v) => {
          const who = identities.get(v.viewerId);
          return {
            viewerId: v.viewerId,
            name: who?.name ?? "",
            email: who?.email ?? "",
            viewedAt: v.viewedAt.toISOString(),
          };
        }),
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      if (err instanceof LinkGateChallenge) return linkGateChallenged(c);
      throw err;
    }
  });

  return r;
}
