import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { isLinkExpired, type LinkPasswordHasher } from "../../domain/artefact/link-gate";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { ScryptLinkPasswordHasher } from "../../infra/crypto/link-password-hasher";
import { authorizeRead } from "../link-gate/authorize";
import { createAttachLinkPasses, issuePass, linkPassesOf } from "../link-gate/passes";
import { UnlockRateLimiter, clientIp } from "../link-gate/rate-limit";
import { renderUnlockPage } from "../runtime/unlock";
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
  // S32a — verifies a link password at unlock (default: scrypt).
  linkPasswordHasher?: LinkPasswordHasher;
  // S32a — unlock attempts per holder + client IP (default: in-process).
  unlockLimiter?: UnlockRateLimiter;
}

// S6 + S12 — Serve artefact by slug. The shared links point at `/a/:slug`, which
// returns the **host shell** (S12): a thin chrome with the data-context switcher
// wrapping a sandboxed <iframe>. The artefact itself is served by the frame
// routes (`routes/frame.ts`, S36), which never read cookies. The shell resolves
// the slug and applies the access matrix against the current session; any deny
// — unknown slug, archived, or wrong-tier viewer — is a flat 404 (or, for the
// anonymous, a uniform sign-in redirect) so visibility is never leaked
// (AH7/AH8).
//
// S32a (AH22–AH24) — a public link's gate is checked after the matrix: a viewer
// the public cell alone admits is shown the unlock page until they hold a pass
// for the current password, and an expired gate is the private outcome.
export function createArtefactServingRoutes(deps: ServingDeps) {
  const app = new Hono<AuthEnv>();
  const accessPolicy = deps.accessPolicy ?? defaultAccessPolicy;
  const hasher = deps.linkPasswordHasher ?? new ScryptLinkPasswordHasher();
  const limiter = deps.unlockLimiter ?? new UnlockRateLimiter();
  const passKeys = {
    secret: deps.framing.secret,
    now: deps.framing.now,
    secure: deps.framing.appOrigin.startsWith("https:"),
  };

  // Resolve the viewer's session so the access matrix can see who is asking,
  // and their link passes so the gate can (S32a).
  app.use("*", createAttachSession(deps.auth));
  app.use("*", createAttachLinkPasses(passKeys));

  // The host shell with the data-context switcher (outside the artefact).
  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const artefact = await deps.repo.findBySlug(slug);
    const viewerId = c.get("user")?.id ?? null;
    const passes = linkPassesOf(c);

    // The matrix decides on the effective tier (AH20/CL5) — an artefact in a
    // collection is served under its tree root's access — then the gate.
    const verdict = artefact
      ? await authorizeRead({ ...deps, accessPolicy }, artefact, viewerId, {
          passes,
          now: new Date(deps.framing.now()),
        })
      : viewerId === null
        ? "sign-in"
        : "not-found";
    if (verdict === "challenge") return c.html(renderUnlockPage({ slug }));
    if (!artefact || verdict !== "granted") {
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
    // token-less, read-only frame — unless they hold a pass (S32a): frames read
    // no cookies, so the token carries the gate version the pass proved.
    const own = viewerId
      ? await deps.dataRepo.findByArtefactAndAuthor(artefact.id, viewerId)
      : null;
    const gate = passes(artefact.id)?.version;
    const minted =
      viewerId || gate !== undefined
        ? mintFrame(deps.framing, "slug", slug, {
            artefactId: artefact.id,
            viewerId,
            authorId: null,
            ...(gate !== undefined ? { gate } : {}),
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
        linkExpired: viewerId === artefact.ownerId && isLinkExpired(artefact, new Date(deps.framing.now())),
      }),
    );
  });

  // S32a — unlock a password-gated public link. Only a viewer the gate actually
  // challenges gets anywhere: an open link redirects back to itself, anything
  // the matrix denies (or an expired gate) is the shell's own deny (AH24). The
  // password is verified in constant time; a match sets the holder's pass.
  app.post("/:slug/unlock", async (c) => {
    const slug = c.req.param("slug");
    const artefact = await deps.repo.findBySlug(slug);
    const viewerId = c.get("user")?.id ?? null;
    const now = deps.framing.now();
    const verdict = artefact
      ? await authorizeRead({ ...deps, accessPolicy }, artefact, viewerId, {
          now: new Date(now),
        })
      : viewerId === null
        ? "sign-in"
        : "not-found";
    const back = `/a/${encodeURIComponent(slug)}`;
    if (verdict === "granted") return c.redirect(back, 303);
    if (!artefact || verdict !== "challenge" || artefact.linkGate.passwordHash === null) {
      if (viewerId === null) return c.redirect(`/?returnTo=${encodeURIComponent(back)}`, 302);
      return c.notFound();
    }

    if (!limiter.attempt(artefact.id, requestIp(c), now)) {
      return c.html(renderUnlockPage({ slug, error: "rate-limited" }), 429);
    }
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const password = typeof form.password === "string" ? form.password : "";
    if (!(await hasher.verify(password, artefact.linkGate.passwordHash))) {
      return c.html(renderUnlockPage({ slug, error: "wrong" }), 401);
    }
    issuePass(c, passKeys, artefact.id, artefact.linkGate);
    return c.redirect(back, 303);
  });

  return app;
}

// The client an unlock attempt is counted against (S32a): the last
// `X-Forwarded-For` hop (appended by the proxy), else the socket address.
function requestIp(c: Context): string {
  let socket: string | undefined;
  try {
    socket = getConnInfo(c).remote.address;
  } catch {
    socket = undefined; // no socket (e.g. an in-process request)
  }
  return clientIp(c.req.header("X-Forwarded-For"), socket);
}
