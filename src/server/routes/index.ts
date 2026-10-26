import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { authConfig, env, legalLinks } from "../env";
import type { Adapters } from "../adapters";
import {
  createAttachSession,
  requireAuth,
  type AuthEnv,
  type AuthInstance,
} from "../middleware/auth";
import {
  singletonScopeResolver,
  type TenantScopeResolver,
} from "../middleware/tenant-scope";
import {
  defaultAccessPolicy,
  type AccessPolicy,
} from "../../domain/artefact/access";
import { createArtefactRoutes, toArtefactSummary } from "./artefacts";
import { createCollectionRoutes, toCollectionSummary } from "./collections";
import { createBookmarkRoutes } from "./bookmarks";
import { createPublicCollectionRoutes } from "./public-collections";
import { listEffectivelyShared } from "../collections/shared.query";
import { listSharedCollections } from "../collections/shared-collections.query";
import { linkPassesOf } from "../link-gate/passes";
import { createDataRoutes } from "./data";
import { createDownloadRoutes } from "./download";
import { createThumbnailRoutes } from "./thumbnail";
import type { ThumbnailQueue } from "../thumbnails/thumbnail-service";
import { ossEnforcement, type EnforcementPolicies } from "../../domain/artefact/enforcement";
import { createViewRoutes } from "./views";
import { listMyViews } from "../views/views.command";
import { createFrameTokenRoutes } from "./frame-token";
import { framingFromEnv, type Framing } from "../runtime/framing";
import { createUserRoutes } from "./users";
import { createAttachLinkPasses } from "../link-gate/passes";
import { ossCapabilities } from "../capabilities";
import { noOrganizationContext, type OrganizationContextProvider } from "../org-context";
import { noOrganizationAdministration, type OrganizationAdministration } from "../org-admin";
import { createOrganizationRoutes } from "./organization";
import { noShareInvitations, type ShareInvitations } from "../share-invitations";
import { createInvitationRoutes } from "./invitations";
import type {
  Capabilities,
  MeResponse,
  MyViewsResponse,
  PublicConfigResponse,
  SharedCollectionsResponse,
  SharedListResponse,
  SwitchOrganizationRequest,
  UpdateMeRequest,
} from "../../shared/contracts";

// S57 — the longest name `PATCH /api/me` accepts, after trimming.
const MAX_NAME_LENGTH = 100;

// BFF API routes. One module per feature slice is mounted here from S1 onward.
// S24 — the persistence-port adapters are injected (see `createApp`), not
// imported as ambient singletons, so a superset can wire a different backend.
// r[impl platform.composition.no-singleton-imports]
export function createApiRoutes(
  adapters: Adapters,
  auth: AuthInstance,
  resolveScope: TenantScopeResolver = singletonScopeResolver,
  // S22 (hosting.access.policy-decided) — decides the `authenticated` tier on the slug-addressed
  // reads (data authors/entries, viewers). Default = the OSS matrix, byte-identical.
  accessPolicy: AccessPolicy = defaultAccessPolicy,
  // S35 — renders card thumbnails after a create or HTML replace; absent = none.
  thumbnails?: ThumbnailQueue,
  // S36 — frame URLs and tokens for the shells and the mint endpoint.
  framing: Framing = framingFromEnv(env),
  // S33a — the injected capabilities, reported on /api/config unchanged but for
  // S33b's `shareInvitations`, which also needs the port.
  capabilities: Capabilities = ossCapabilities,
  // S53 — the caller's organization context; default = none (OSS).
  organizations: OrganizationContextProvider = noOrganizationContext,
  // S58 — the active org's administration; default = none (OSS).
  administration: OrganizationAdministration = noOrganizationAdministration,
  // S23 — the quota and payload-size policies the create/edit routes consult; default = OSS.
  enforcement: EnforcementPolicies = ossEnforcement,
  // S33b — the artefact share invitations; default = none (OSS).
  shareInvitations: ShareInvitations | null = noShareInvitations,
) {
  const {
    artefactRepository,
    collectionRepository,
    bookmarkRepository,
    dataRepository,
    payloadStore,
    thumbnailStore,
    userDirectory,
    viewRepository,
  } = adapters;
  const api = new Hono<AuthEnv>();

  // CORS for the auth endpoints so a cross-origin client (e.g. the Vite dev
  // server) can drive sign-up/in with credentials. Must precede the handler.
  api.use(
    "/auth/*",
    cors({
      origin: env.AUTH_TRUSTED_ORIGINS,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    }),
  );

  // BetterAuth owns the whole auth surface: sign-up/in/out, session, and later
  // Google OAuth + API keys. This terminal handler returns before the session
  // middleware below, so it manages its own request/response.
  api.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));

  // S73 — any origin's browser may read the anonymous public collection tree:
  // `*` on every status, the preflight included, and never credentials. Mounted
  // ahead of the session middleware, so a response or error from it still
  // carries the header; scoped to that one path, so no other route gains CORS.
  // r[impl collections.public-link.cross-origin-read]
  api.use(
    "/public/collections/*",
    cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"], credentials: false }),
  );

  // Every other BFF request gets its BetterAuth session resolved up front.
  api.use("*", createAttachSession(auth));
  // S32a — the link passes the request carries, for the gated reads
  // (hosting.link-gate.narrows-public-audience).
  api.use("*", createAttachLinkPasses({ secret: framing.secret, now: framing.now }));

  api.get("/ping", (c) => c.json({ pong: true }));

  // Public config the sign-in screen reads before any session exists — the
  // enabled sign-in methods and the sign-up gate (S38) so the screen renders
  // only what this deployment will accept. Advertising these flags changes no
  // enforcement: the env guard and the user-create hook remain the boundaries.
  // The same goes for the injected capabilities (S33a). The allowed email
  // domains are never advertised.
  // S33b — share invitations are offered only where a port carries them out, so
  // the flag and the port can't disagree.
  // r[impl hosting.invitations.oss-default-off+3]
  const advertised: Capabilities = {
    ...capabilities,
    shareInvitations: capabilities.shareInvitations && shareInvitations !== null,
  };
  // r[impl identity.config.advertises-methods+3]
  api.get("/config", (c) =>
    c.json<PublicConfigResponse>({
      // r[impl identity.config.methods-from-auth-config]
      emailPasswordEnabled: authConfig.emailPasswordEnabled,
      googleEnabled: authConfig.googleEnabled,
      signupAllowed: authConfig.signupAllowed,
      capabilities: advertised,
      // r[impl identity.config.legal-links]
      legal: legalLinks,
    }),
  );

  // Protected: the current identity. `requireAuth`
  // rejects unauthenticated callers with 401; otherwise returns the ownerId.
  // S53 — plus the organization context, only when the provider has one.
  // r[impl platform.org-context.me-organizations]
  const me = async (c: Context<AuthEnv>): Promise<MeResponse> => {
    const user = c.get("user")!;
    const context = await organizations.get(c);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(context ? { organizations: context } : {}),
    };
  };
  api.get("/me", requireAuth, async (c) => c.json<MeResponse>(await me(c)));

  // S57 — rename yourself. No user id is taken, so only the caller's own name
  // moves, and BetterAuth writes it: the domain still stores no profile. A bad
  // name is refused before BetterAuth is called.
  // r[impl platform.account.rename-route]
  api.patch("/me", requireAuth, async (c) => {
    // r[impl identity.account.rename-self+2]
    const body = (await c.req.json().catch(() => null)) as Partial<UpdateMeRequest> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: `name must be 1–${MAX_NAME_LENGTH} characters` }, 400);
    }
    const { headers } = await auth.api.updateUser({
      body: { name },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    // BetterAuth re-issues the session cookie carrying the new user; pass it on.
    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    c.set("user", { ...c.get("user")!, name });
    return c.json<MeResponse>(await me(c));
  });

  // S53 — switch the active org. Core decides: only an org the provider lists
  // among the caller's memberships is activated; anything else — no context,
  // another org, no id at all — is the same 404, and the provider never sees it.
  // r[impl platform.org-context.switch-route]
  api.post("/me/active-organization", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<SwitchOrganizationRequest> | null;
    const id = typeof body?.organizationId === "string" ? body.organizationId : null;
    const context = await organizations.get(c);
    // r[impl identity.org-context.switch-own-membership+2]
    if (!id || !context?.memberships.some((m) => m.id === id)) {
      return c.json({ error: "not found" }, 404);
    }
    await organizations.activate(c, id);
    return c.json<MeResponse>(await me(c));
  });

  // S14 — "Shared with you". Signed-in users only (unauthenticated access is by slug link only).
  // Lists active artefacts **effectively** shared *to* the caller
  // (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant): others' top-level shared artefacts plus others'
  // artefacts inside collection trees whose root grants the caller. Their own artefacts (in "Your
  // artefacts") and anyone's private ones never appear (hosting.access.matrix). The client
  // groups/filters by kind.
  // r[impl hosting.listing.signed-in-only+2]
  // r[impl hosting.shared.others-shared+2]
  // r[impl hosting.shared.selected-members+2]
  api.get("/shared", requireAuth, async (c) => {
    const scope = await resolveScope(c);
    const shared = await listEffectivelyShared(
      c.get("user")!.id,
      scope,
      { artefactRepo: artefactRepository, collectionRepo: collectionRepository, accessPolicy },
      { passes: linkPassesOf(c) },
    );
    // Enrich with owner display identity so the gallery can attribute each
    // artefact ("Shared by …"). The artefact ids/owner ids come from Hosting;
    // names/emails are composed from Identity via the user directory.
    const identities = await userDirectory.lookup(
      shared.map((e) => e.artefact.ownerId),
    );
    return c.json<SharedListResponse>({
      artefacts: shared.map(({ artefact: a, effectiveVisibility }) => {
        const who = identities.get(a.ownerId);
        return {
          ...toArtefactSummary(a, effectiveVisibility),
          owner: { name: who?.name ?? "", email: who?.email ?? "" },
        };
      }),
    });
  });

  // S28 — the collection trees shared *to* the caller (collections.read.follows-root): every node of
  // every granting tree, with the per-tree contributor flag (collections.contributor.on-root-access-list) and the
  // owner's display identity. Signed-in only; the flat artefact list above is
  // unchanged (both-way listing).
  api.get("/shared/collections", requireAuth, async (c) => {
    const scope = await resolveScope(c);
    const nodes = await listSharedCollections(
      c.get("user")!.id,
      scope,
      { collectionRepo: collectionRepository, accessPolicy },
      { passes: linkPassesOf(c) },
    );
    const identities = await userDirectory.lookup(
      nodes.map((n) => n.collection.ownerId),
    );
    return c.json<SharedCollectionsResponse>({
      collections: nodes.map(({ collection, canContribute }) => {
        const who = identities.get(collection.ownerId);
        return {
          ...toCollectionSummary(collection, null),
          canContribute,
          owner: { name: who?.name ?? "", email: who?.email ?? "" },
        };
      }),
    });
  });

  // S47 — the caller's own views (views.mine.own-visible-only), newest first,
  // for Home's Recent row and Last viewed sort. Signed-in only; only artefacts
  // the caller can open now.
  api.get("/views/mine", requireAuth, async (c) => {
    const views = await listMyViews(
      c.get("user")!.id,
      await resolveScope(c),
      {
        artefactRepo: artefactRepository,
        collectionRepo: collectionRepository,
        viewRepo: viewRepository,
        accessPolicy,
      },
      { passes: linkPassesOf(c) },
    );
    return c.json<MyViewsResponse>({
      views: views.map((v) => ({ artefactId: v.artefactId, viewedAt: v.viewedAt.toISOString() })),
    });
  });

  // S16 — user directory search for the share-with-specific-people picker.
  api.route("/users", createUserRoutes({ userDirectory, resolveScope }));

  // S58 — the Organization settings screen's routes.
  api.route("/organization", createOrganizationRoutes({ organizations, administration }));

  // Artefact Hosting routes — share the domain ports' adapters (see adapters.ts).
  api.route(
    "/artefacts",
    createArtefactRoutes({
      repo: artefactRepository,
      payloadStore,
      dataRepo: dataRepository,
      viewRepo: viewRepository,
      collectionRepo: collectionRepository,
      bookmarkRepo: bookmarkRepository,
      userDirectory,
      resolveScope,
      thumbnailStore,
      thumbnails,
      framing,
      accessPolicy,
      enforcement,
    }),
  );

  // S33b — an artefact's share invitations (owner-only; none mounted in OSS).
  api.route(
    "/artefacts",
    createInvitationRoutes({ repo: artefactRepository, resolveScope, invitations: shareInvitations }),
  );

  // S36 — a fresh, tokened frame URL for the host shell (author switch, conflict
  // reload, expired token), addressed by slug or id.
  api.route(
    "/artefacts",
    createFrameTokenRoutes({
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      dataRepo: dataRepository,
      resolveScope,
      accessPolicy,
      framing,
    }),
  );

  // S25/S26 — Artefact Collections (owner-only folder tree + cascades).
  api.route(
    "/collections",
    createCollectionRoutes({
      collectionRepo: collectionRepository,
      artefactRepo: artefactRepository,
      bookmarkRepo: bookmarkRepository,
      dataRepo: dataRepository,
      viewRepo: viewRepository,
      payloadStore,
      thumbnailStore,
      userDirectory,
      resolveScope,
      accessPolicy,
    }),
  );

  // S44 — the anonymous read of a public collection tree by its root slug. No
  // session needed: everything under `/public` answers the same without one.
  api.route(
    "/public/collections",
    createPublicCollectionRoutes({
      collectionRepo: collectionRepository,
      artefactRepo: artefactRepository,
    }),
  );

  // S27 — Bookmarks: the caller's pins (toggles live on the resources).
  api.route(
    "/bookmarks",
    createBookmarkRoutes({
      bookmarkRepo: bookmarkRepository,
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      resolveScope,
      accessPolicy,
    }),
  );

  // S11 — Artefact Data: the caller's own blob, addressed by the artefact slug
  // or id. Mounted with the `:ref` param so the data handlers resolve the artefact.
  api.route(
    "/artefacts/:ref/data",
    createDataRoutes({
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      dataRepo: dataRepository,
      userDirectory,
      resolveScope,
      accessPolicy,
    }),
  );

  // S30 — Export: the artefact's stored HTML as a download, addressed by its slug or id. Access
  // follows the same matrix as the data reads (hosting.access.effective-from-tree-root,
  // hosting.access.policy-decided); anonymous callers may download a `public` artefact by slug.
  api.route(
    "/artefacts",
    createDownloadRoutes({
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      payloadStore,
      resolveScope,
      accessPolicy,
    }),
  );

  // S35 — the card thumbnail, addressed by slug or id when signed in and by slug
  // only when anonymous (S44). Access follows the download's resolver, so the
  // matrix, the effective tier and the access policy are inherited, not
  // re-implemented.
  api.route(
    "/artefacts",
    createThumbnailRoutes({
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      thumbnailStore,
      resolveScope,
      accessPolicy,
    }),
  );

  // S21 — Artefact Views: the "viewed by" list for an artefact, addressed by its
  // slug or id. A view itself is recorded on the serving path (see routes/serve.ts).
  api.route(
    "/artefacts/:ref/viewers",
    createViewRoutes({
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
      viewRepo: viewRepository,
      userDirectory,
      resolveScope,
      accessPolicy,
    }),
  );

  return api;
}
