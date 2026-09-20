import { Hono } from "hono";
import { cors } from "hono/cors";
import { authConfig, env } from "../env";
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
import { listEffectivelyShared } from "../collections/shared.query";
import { listSharedCollections } from "../collections/shared-collections.query";
import { createDataRoutes } from "./data";
import { createDownloadRoutes } from "./download";
import { createThumbnailRoutes } from "./thumbnail";
import type { ThumbnailQueue } from "../thumbnails/thumbnail-service";
import { createViewRoutes } from "./views";
import { createFrameTokenRoutes } from "./frame-token";
import { framingFromEnv, type Framing } from "../runtime/framing";
import { createUserRoutes } from "./users";
import type {
  MeResponse,
  PublicConfigResponse,
  SharedCollectionsResponse,
  SharedListResponse,
} from "../../shared/contracts";

// BFF API routes. One module per feature slice is mounted here from S1 onward.
// S24 — the persistence-port adapters are injected (see `createApp`), not
// imported as ambient singletons, so a superset can wire a different backend.
export function createApiRoutes(
  adapters: Adapters,
  auth: AuthInstance,
  resolveScope: TenantScopeResolver = singletonScopeResolver,
  // S22 (AH18) — decides the `authenticated` tier on the slug-addressed reads
  // (data authors/entries, viewers). Default = the OSS matrix, byte-identical.
  accessPolicy: AccessPolicy = defaultAccessPolicy,
  // S35 — renders card thumbnails after a create or HTML replace; absent = none.
  thumbnails?: ThumbnailQueue,
  // S36 — frame URLs and tokens for the shells and the mint endpoint.
  framing: Framing = framingFromEnv(env),
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

  // Every other BFF request gets its BetterAuth session resolved up front.
  api.use("*", createAttachSession(auth));

  api.get("/ping", (c) => c.json({ pong: true }));

  // Public config the sign-in screen reads before any session exists — the
  // allowed email domains so the UI can show them without hardcoding (these
  // aren't secret; they're shown in the UI hint anyway), plus the enabled
  // sign-in methods and the sign-up gate (S38, IA7) so the screen renders only
  // what this deployment will accept. Advertising them changes no enforcement:
  // the env guard and the user-create hook remain the boundaries.
  api.get("/config", (c) =>
    c.json<PublicConfigResponse>({
      allowedEmailDomains: env.AUTH_ALLOWED_EMAIL_DOMAINS,
      emailPasswordEnabled: authConfig.emailPasswordEnabled,
      googleEnabled: authConfig.googleEnabled,
      signupAllowed: authConfig.signupAllowed,
    }),
  );

  // Protected: the current identity. Encodes IA invariant 1 — `requireAuth`
  // rejects unauthenticated callers with 401; otherwise returns the ownerId.
  api.get("/me", requireAuth, (c) => {
    const user = c.get("user")!;
    return c.json<MeResponse>({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  });

  // S14 — "Shared with you". Signed-in users only (unauthenticated access is by
  // slug link only). Lists active artefacts **effectively** shared *to* the
  // caller (AH20/CL5): others' top-level shared artefacts plus others' artefacts
  // inside collection trees whose root grants the caller. Their own artefacts
  // (in "Your artefacts") and anyone's private ones never appear (AH8). The
  // client groups/filters by kind.
  api.get("/shared", requireAuth, async (c) => {
    const scope = await resolveScope(c);
    const shared = await listEffectivelyShared(c.get("user")!.id, scope, {
      artefactRepo: artefactRepository,
      collectionRepo: collectionRepository,
    });
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

  // S28 — the collection trees shared *to* the caller (CL11): every node of
  // every granting tree, with the per-tree contributor flag (CL12) and the
  // owner's display identity. Signed-in only; the flat artefact list above is
  // unchanged (both-way listing).
  api.get("/shared/collections", requireAuth, async (c) => {
    const scope = await resolveScope(c);
    const nodes = await listSharedCollections(c.get("user")!.id, scope, {
      collectionRepo: collectionRepository,
    });
    const identities = await userDirectory.lookup(
      nodes.map((n) => n.collection.ownerId),
    );
    return c.json<SharedCollectionsResponse>({
      collections: nodes.map(({ collection, canContribute }) => {
        const who = identities.get(collection.ownerId);
        return {
          ...toCollectionSummary(collection),
          canContribute,
          owner: { name: who?.name ?? "", email: who?.email ?? "" },
        };
      }),
    });
  });

  // S16 — user directory search for the share-with-specific-people picker.
  api.route("/users", createUserRoutes({ userDirectory }));

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
    }),
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

  // S30 — Export: the artefact's stored HTML as a download, addressed by its
  // slug or id. Access follows the same matrix as the data reads (AH20/AH18);
  // anonymous callers may download a `public` artefact by slug.
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

  // S35 — the card thumbnail, addressed by slug or id. Signed-in only (AH27);
  // access otherwise follows the download's resolver, so the matrix, the
  // effective tier and the access policy are inherited, not re-implemented.
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
