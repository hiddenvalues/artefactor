import { Hono } from "hono";
import type { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { env, trustedProxies } from "./env";
import { requestLog } from "./request-log";
import { createClientAddress } from "./client-ip";
import { defaultAdapters, type Adapters } from "./adapters";
import { auth as defaultAuth } from "./auth";
import type { AuthInstance } from "./middleware/auth";
import {
  singletonScopeResolver,
  type TenantScopeResolver,
} from "./middleware/tenant-scope";
import {
  defaultAccessPolicy,
  type AccessPolicy,
} from "../domain/artefact/access";
import { createApiRoutes } from "./routes";
import { createArtefactServingRoutes } from "./routes/serve";
import { createFrameRoutes } from "./routes/frame";
import { framingFromEnv } from "./runtime/framing";
import { createOriginGuard } from "./middleware/origin-guard";
import { createContentHostGate } from "./middleware/content-host";
import { createMcpRoutes, type McpScopeResolver } from "./mcp/routes";
import { ossCapabilities } from "./capabilities";
import { noOrganizationContext, type OrganizationContextProvider } from "./org-context";
import { noOrganizationAdministration, type OrganizationAdministration } from "./org-admin";
import type { Capabilities, HealthResponse } from "../shared/contracts";
import { SHARE_LINK_BASE } from "../shared/share-link";
import type { ThumbnailQueue } from "./thumbnails/thumbnail-service";
import { ArtefactConflict } from "../domain/artefact/errors";

/** Receives each error the app answers with a 500, after it is logged. */
export type UnhandledErrorReporter = (err: Error) => void;

// S24 — the composition root. The persistence-port adapters *and* the BetterAuth
// instance are injected (defaulting to the OSS SQLite/filesystem set + the
// SQLite-backed `auth`), so a superset can compose the same app over a different
// backend (e.g. Postgres) without editing core.
//
// S22 (hosting.tenant.invisible-to-oss) — the tenant-scope resolver is injected the same way
// (default = single-tenant `singletonScopeResolver`, so OSS is byte-identical). A multi-tenant
// superset injects an active-org resolver (ET2) without editing core route handlers.
//
// S22 (hosting.access.policy-decided) — so is the access policy: the one overridable matrix cell
// (the `authenticated` tier) on the slug-addressed read paths (serve, data, views). Default = the
// OSS matrix (any signed-in user); a superset injects an org-membership policy (ET3) without
// editing core.
//
// S33a — and so are the capabilities `/api/config` advertises (default = OSS,
// all off); a superset that registers magic-link sign-in turns its flag on.
//
// S53 — and so is the organization context `/api/me` reports (default = none,
// so OSS is byte-identical); a superset supplies its memberships (ET7).
//
// S58 — and so is the organization administration the `/api/organization`
// routes drive (default = none, so every one answers 404); a superset supplies
// BetterAuth's organization plugin (ET4).
//
// S24 (platform.composition.unhandled-error-reporter) — and so is a reporter for
// the errors the app answers with a 500 (default = none); a superset hands them to
// its error monitoring.
// r[impl platform.composition.injected-adapters-serve]
export function createApp(
  adapters: Adapters = defaultAdapters,
  auth: AuthInstance = defaultAuth,
  resolveScope: TenantScopeResolver = singletonScopeResolver,
  // The MCP connector resolves scope from the token Account, not a Hono request
  // session, so it has its own resolver (default = single-tenant). See ET2's
  // open question on the connector's active org.
  resolveMcpScope?: McpScopeResolver,
  accessPolicy: AccessPolicy = defaultAccessPolicy,
  // S35 — the thumbnail queue the create/edit commands enqueue into (UI and MCP
  // alike). The entry constructs and starts it; absent = no renders.
  thumbnails?: ThumbnailQueue,
  // r[impl identity.capabilities.oss-default-off+2]
  capabilities: Capabilities = ossCapabilities,
  organizations: OrganizationContextProvider = noOrganizationContext,
  administration: OrganizationAdministration = noOrganizationAdministration,
  onUnhandledError: UnhandledErrorReporter = () => {},
) {
  const app = new Hono();
  // S60 — a save conflict that survived its command's retries is a 409 on every route, logged so a
  // write that keeps matching no row (e.g. one an RLS policy hides) stays visible. Any other
  // uncaught error gets Hono's default handler, copied as is: an error carrying its own response
  // (an HTTPException) keeps it, merged with the context's headers; anything else is a 500.
  // r[impl hosting.save.conflict-http]
  app.onError((err, c) => {
    if (err instanceof ArtefactConflict) {
      console.warn(`save conflict survived retries: ${err.message}`);
      return c.json({ error: "conflict" }, 409);
    }
    if ("getResponse" in err) {
      const res = (err as HTTPException).getResponse();
      return c.newResponse(res.body, res);
    }
    console.error(err);
    // r[impl platform.composition.unhandled-error-reporter]
    try {
      onUnhandledError(err);
    } catch {
      // A reporter that fails never changes the answer.
    }
    return c.text("Internal Server Error", 500);
  });
  // S36 — where frames live, how they are tokened, and which origins are the app's.
  const framing = framingFromEnv(env);

  // S50 — first, so every route is logged, and never a query value.
  // r[impl identity.log.request-log-app]
  app.use("*", requestLog());

  // S42 — resolve the client address once, before every route: the unlock
  // limit reads it as `clientIp`, BetterAuth from the one header it trusts.
  app.use("*", createClientAddress(trustedProxies));

  // S36 — a configured content origin answers only frames and /health;
  // the app host then answers no frame route.
  if (framing.contentOrigin) {
    app.use("*", createContentHostGate(framing.contentOrigin));
  }

  // r[impl platform.scaffold.health]
  app.get("/health", (c) =>
    c.json<HealthResponse>({
      status: "ok",
      uptime: process.uptime(),
      build: env.GIT_SHA,
    }),
  );

  // S36 — the frame routes, mounted before the `/api` and `/a` routers so
  // their attach-session middleware never runs for a frame: frames authenticate
  // only by frame token.
  app.route(
    "/",
    createFrameRoutes({
      repo: adapters.artefactRepository,
      collectionRepo: adapters.collectionRepository,
      payloadStore: adapters.payloadStore,
      dataRepo: adapters.dataRepository,
      accessPolicy,
      framing,
    }),
  );

  // S36 — a cookie-authenticated state change under /api must come from
  // the app origin (BetterAuth checks /api/auth/* itself).
  app.use("/api/*", createOriginGuard(framing.trustedAppOrigins));

  app.route(
    "/api",
    createApiRoutes(
      adapters,
      auth,
      resolveScope,
      accessPolicy,
      thumbnails,
      framing,
      capabilities,
      organizations,
      administration,
    ),
  );

  // S6 — public artefact serving by slug (the shared-link render route). Mounted
  // before the static handlers so `/a/:slug` is not swallowed by the SPA fallback.
  app.route(
    SHARE_LINK_BASE,
    createArtefactServingRoutes({
      repo: adapters.artefactRepository,
      collectionRepo: adapters.collectionRepository,
      dataRepo: adapters.dataRepository,
      viewRepo: adapters.viewRepository,
      auth,
      accessPolicy,
      framing,
    }),
  );

  // S18 — MCP connector (remote MCP server + OAuth discovery). Mounted at the
  // root, before the static handlers, so `/mcp` and `/.well-known/oauth-*` are
  // not swallowed by the SPA fallback. OAuth endpoints proper live under
  // /api/auth/* (the BetterAuth `mcp` plugin).
  app.route(
    "/",
    createMcpRoutes(
      {
        repo: adapters.artefactRepository,
        collectionRepo: adapters.collectionRepository,
        payloadStore: adapters.payloadStore,
        dataRepo: adapters.dataRepository,
        userDirectory: adapters.userDirectory,
        thumbnails,
      },
      auth,
      resolveMcpScope,
    ),
  );

  // Serve the built React client. Static assets first...
  app.use("/*", serveStatic({ root: env.CLIENT_DIR }));
  // ...then SPA fallback to index.html for any unmatched (non-API) route.
  app.get("*", serveStatic({ path: "index.html", root: env.CLIENT_DIR }));

  return app;
}
