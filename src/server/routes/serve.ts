import { Hono } from "hono";
import {
  canViewArtefactUnder,
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveEffectiveViewable } from "../collections/effective";
import type { PayloadStore } from "../../domain/artefact/ports";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import { recordArtefactView } from "../views/views.command";
import { renderServedArtefact } from "../runtime/render";
import { renderHostShell } from "../runtime/shell";
import {
  createAttachSession,
  type AuthEnv,
  type AuthInstance,
} from "../middleware/auth";

export interface ServingDeps {
  repo: ArtefactRepository;
  // AH20 — serving decides access on the *effective* tier (collection tree root).
  collectionRepo: CollectionRepository;
  payloadStore: PayloadStore;
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  auth: AuthInstance;
  // S22 (AH18) — serving is slug-addressed and tenant-global (AH6), so the
  // per-tier tenant decision is the policy's. Default = the OSS matrix.
  accessPolicy?: AccessPolicy;
}

// S6 + S12 — Serve artefact by slug. The shared links point at `/a/:slug`, which
// returns the **host shell** (S12): a thin chrome with the data-context switcher
// wrapping an <iframe>. The iframe loads the artefact itself from
// `/a/:slug/frame` — its trusted HTML served **as-is** (no sanitization) with
// the S13 localStorage bootstrap injected and seeded with the chosen data
// context. Both resolve the slug and apply the access matrix against the current
// session; any deny — unknown slug, archived, or wrong-tier viewer — is a flat
// 404 so visibility is never leaked (AH7/AH8).
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

    return c.html(
      renderHostShell({
        title: artefact.title,
        kind: artefact.kind,
        updatedAt: artefact.updatedAt.toISOString(),
        framePath: `/a/${encodeURIComponent(slug)}/frame`,
        authorsEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/data/authors`,
        viewersEndpoint: `/api/artefacts/${encodeURIComponent(slug)}/viewers`,
        viewerId,
        ownerId: artefact.ownerId,
        usesStorage: artefact.usesStorage,
      }),
    );
  });

  // The artefact itself, inside the iframe. `?author=<id>` selects the data
  // context to seed (default = the viewer's own, read-write; another author =
  // read-only, AD5). The chosen author is gated by the same artefact access as
  // the shell — any viewer who can see the artefact can load any author (AD4).
  app.get("/:slug/frame", async (c) => {
    const slug = c.req.param("slug");
    const artefact = await deps.repo.findBySlug(slug);
    const viewerId = c.get("user")?.id ?? null;

    if (
      !artefact ||
      !(await canViewArtefactUnder(
        accessPolicy,
        await resolveEffectiveViewable(artefact, deps.collectionRepo),
        viewerId,
      ))
    ) {
      return c.notFound();
    }

    // Served by slug → the shim writes back through the slug.
    const html = await renderServedArtefact(artefact, slug, viewerId, deps, {
      authorId: c.req.query("author") ?? null,
    });
    return c.html(html);
  });

  return app;
}
