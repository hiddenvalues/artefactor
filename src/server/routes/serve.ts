import { Hono } from "hono";
import {
  canViewArtefactUnder,
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveEffectiveViewable } from "../collections/effective";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import { recordArtefactView } from "../views/views.command";
import { renderHostShell } from "../runtime/shell";
import { frameUrl, mintFrame, type Framing } from "../runtime/framing";
import {
  createAttachSession,
  type AuthEnv,
  type AuthInstance,
} from "../middleware/auth";

export interface ServingDeps {
  repo: ArtefactRepository;
  // AH20 — serving decides access on the *effective* tier (collection tree root).
  collectionRepo: CollectionRepository;
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  auth: AuthInstance;
  // S22 (AH18) — serving is slug-addressed and tenant-global (AH6), so the
  // per-tier tenant decision is the policy's. Default = the OSS matrix.
  accessPolicy?: AccessPolicy;
  // S36 — mints the shell's first frame URL (and places it on the content origin).
  framing: Framing;
}

// S6 + S12 — Serve artefact by slug. The shared links point at `/a/:slug`, which
// returns the **host shell** (S12): a thin chrome with the data-context switcher
// wrapping a sandboxed <iframe>. The artefact itself is served by the frame
// routes (`routes/frame.ts`, S36), which never read cookies. The shell resolves
// the slug and applies the access matrix against the current session; any deny
// — unknown slug, archived, or wrong-tier viewer — is a flat 404 (or, for the
// anonymous, a uniform sign-in redirect) so visibility is never leaked
// (AH7/AH8).
export function createArtefactServingRoutes(deps: ServingDeps) {
  const app = new Hono<AuthEnv>();
  const accessPolicy = deps.accessPolicy ?? defaultAccessPolicy;

  // Resolve the viewer's session so the access matrix can see who is asking.
  app.use("*", createAttachSession(deps.auth));

  // The host shell with the data-context switcher (outside the artefact).
  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const artefact = await deps.repo.findBySlug(slug);
    const viewerId = c.get("user")?.id ?? null;

    if (
      !artefact ||
      // The matrix decides on the effective tier (AH20/CL5): an artefact in a
      // collection is served under its tree root's access.
      !(await canViewArtefactUnder(
        accessPolicy,
        await resolveEffectiveViewable(artefact, deps.collectionRepo),
        viewerId,
      ))
    ) {
      // An anonymous visitor who can't (yet) see it — e.g. a "Members"
      // (`authenticated`) link opened by someone in the org who hasn't created
      // their account yet — is sent to sign in and then bounced back to this
      // artefact, instead of a dead 404. The redirect is uniform across every
      // anonymous miss (unknown slug, private, members-only, archived), so it
      // leaks no more than the old flat 404 did: an anonymous prober still
      // can't distinguish an existing artefact from a missing one (AH8). An
      // *authenticated* viewer who is denied stays a flat 404 — they already
      // have an account, so a sign-in redirect would only loop.
      if (viewerId === null) {
        return c.redirect(`/?returnTo=${encodeURIComponent(c.req.path)}`, 302);
      }
      return c.notFound();
    }

    // S21 — record that a signed-in viewer opened this artefact (latest view
    // only, VT1). Anonymous opens are never recorded (VT2). Best-effort: view
    // tracking must never break serving, so a store hiccup is swallowed.
    if (viewerId !== null) {
      try {
        await recordArtefactView(artefact.id, viewerId, {
          viewRepo: deps.viewRepo,
        });
      } catch {
        // Non-critical analytics — ignore and serve the artefact regardless.
      }
    }

    // S36 — a signed-in viewer's frame opens on a token for their own context
    // (and the shell's first save is pinned to that entry); the anonymous get a
    // token-less, read-only frame.
    const own = viewerId
      ? await deps.dataRepo.findByArtefactAndAuthor(artefact.id, viewerId)
      : null;
    const minted = viewerId
      ? mintFrame(deps.framing, "slug", slug, {
          artefactId: artefact.id,
          viewerId,
          authorId: null,
        })
      : null;
    return c.html(
      renderHostShell({
        title: artefact.title,
        kind: artefact.kind,
        updatedAt: artefact.updatedAt.toISOString(),
        frameUrl: minted?.frameUrl ?? frameUrl(deps.framing, "slug", slug),
        channel: minted?.channel ?? null,
        mintEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/frame-token`,
        dataEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/data/me`,
        seedUpdatedAt: own?.updatedAt.toISOString() ?? null,
        authorsEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/data/authors`,
        viewersEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/viewers`,
        viewerId,
        ownerId: artefact.ownerId,
        usesStorage: artefact.usesStorage,
      }),
    );
  });

  return app;
}
