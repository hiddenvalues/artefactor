import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "./env";
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
import { createMcpRoutes, type McpScopeResolver } from "./mcp/routes";
import type { HealthResponse } from "../shared/contracts";

// S24 — the composition root. The persistence-port adapters *and* the BetterAuth
// instance are injected (defaulting to the OSS SQLite/filesystem set + the
// SQLite-backed `auth`), so a superset can compose the same app over a different
// backend (e.g. Postgres) without editing core.
//
// S22 (AH17) — the tenant-scope resolver is injected the same way (default =
// single-tenant `singletonScopeResolver`, so OSS is byte-identical). A
// multi-tenant superset injects an active-org resolver (ET2) without editing
// core route handlers.
//
// S22 (AH18) — so is the access policy: the one overridable matrix cell (the
// `authenticated` tier) on the slug-addressed read paths (serve, data, views).
// Default = the OSS matrix (any signed-in user); a superset injects an
// org-membership policy (ET3) without editing core.
export function createApp(
  adapters: Adapters = defaultAdapters,
  auth: AuthInstance = defaultAuth,
  resolveScope: TenantScopeResolver = singletonScopeResolver,
  // The MCP connector resolves scope from the token Account, not a Hono request
  // session, so it has its own resolver (default = single-tenant). See ET2's
  // open question on the connector's active org.
  resolveMcpScope?: McpScopeResolver,
  accessPolicy: AccessPolicy = defaultAccessPolicy,
) {
  const app = new Hono();

  app.use("*", logger());

  app.get("/health", (c) =>
    c.json<HealthResponse>({
      status: "ok",
      uptime: process.uptime(),
      build: env.GIT_SHA,
    }),
  );

  app.route("/api", createApiRoutes(adapters, auth, resolveScope, accessPolicy));

  // S6 — public artefact serving by slug (the shared-link render route). Mounted
  // before the static handlers so `/a/:slug` is not swallowed by the SPA fallback.
  app.route(
    "/a",
    createArtefactServingRoutes({
      repo: adapters.artefactRepository,
      collectionRepo: adapters.collectionRepository,
      payloadStore: adapters.payloadStore,
      dataRepo: adapters.dataRepository,
      viewRepo: adapters.viewRepository,
      auth,
      accessPolicy,
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
      },
      auth,
      resolveMcpScope,
    ),
  );

  // Serve the built Svelte client. Static assets first...
  app.use("/*", serveStatic({ root: env.CLIENT_DIR }));
  // ...then SPA fallback to index.html for any unmatched (non-API) route.
  app.get("*", serveStatic({ path: "index.html", root: env.CLIENT_DIR }));

  return app;
}
