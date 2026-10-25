import { Hono } from "hono";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { env } from "../env";
import type { AuthInstance } from "../middleware/auth";
import { buildMcpServer, type McpScopeRefusal, type McpToolDeps } from "./server";
import { verifyMcpBearer } from "./verify-token";
import {
  SINGLETON_SCOPE,
  type TenantScope,
} from "../../domain/artefact/tenant-scope";

// S22 (hosting.tenant.invisible-to-oss) — resolve the tenant scope a connector request runs under
// from its resolved MCP session (the token Account). OSS maps every Account to the single tenant
// (byte-identical); a superset reads the Account's active org (ET2 — an open question in
// `ddd/identity-access.md`). Injected like the other seams so the superset overrides it without
// editing this route. It may instead refuse the Account (`McpScopeRefusal`): every tool call then
// answers the refusal's message as an error result. OSS never refuses.
export type McpScopeResolver = (session: {
  userId: string;
}) => TenantScope | McpScopeRefusal | Promise<TenantScope | McpScopeRefusal>;

export const singletonMcpScopeResolver: McpScopeResolver = () => SINGLETON_SCOPE;

// S18/S63 — MCP connector endpoints, mounted at the app root (NOT under /api)
// so they sit at the URLs an MCP client probes: the OAuth discovery
// descriptors at `/.well-known/oauth-*` and the protocol endpoint at `/mcp`.
// OAuth itself (register/authorize/consent/token) is served by the BetterAuth
// handler under `/api/auth/oauth2/*` via `@better-auth/mcp`; these root routes
// are the discovery surface plus the bearer-guarded tool endpoint.
export function createMcpRoutes(
  deps: McpToolDeps,
  auth: AuthInstance,
  resolveScope: McpScopeResolver = singletonMcpScopeResolver,
) {
  const r = new Hono();

  // Discovery. The authorization-server metadata is the provider's own; it is
  // served at the root and at the RFC 8414 form its issuer's path implies
  // (`/.well-known/oauth-authorization-server/api/auth`).
  const authServerMetadata = oauthProviderAuthServerMetadata(auth);
  // The issuer is BetterAuth's base URL (`<BETTER_AUTH_URL>/api/auth`, where
  // the app mounts its handler), so the suffix is that URL's path.
  const issuerPath = new URL(`${auth.options.baseURL}/api/auth`).pathname;
  // Discovery is public metadata, and a browser-based MCP client runs on an
  // origin of its own, so these four paths answer any origin, preflight
  // included. Registration and the token endpoint get no such header.
  const anyOrigin = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] });
  for (const path of [
    "/.well-known/oauth-authorization-server",
    `/.well-known/oauth-authorization-server${issuerPath}`,
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    r.use(path, anyOrigin);
  }
  r.get("/.well-known/oauth-authorization-server", (c) =>
    authServerMetadata(c.req.raw),
  );
  r.get(`/.well-known/oauth-authorization-server${issuerPath}`, (c) =>
    authServerMetadata(c.req.raw),
  );
  // The RFC 9728 protected-resource metadata, at its root and `/mcp`-suffixed
  // paths. `mcp()` renders it from the request path, so the request goes to the
  // BetterAuth handler as it came.
  r.get("/.well-known/oauth-protected-resource", (c) => auth.handler(c.req.raw));
  r.get("/.well-known/oauth-protected-resource/mcp", (c) =>
    auth.handler(c.req.raw),
  );

  // The MCP protocol endpoint. Resolve the OAuth bearer to an Account; reject
  // with 401 + the protected-resource pointer (per the MCP auth spec) when it
  // authenticates nothing, so the client knows where to start the OAuth flow.
  // On success, a per-request stateless server runs the tools as that user.
  r.all("/mcp", async (c) => {
    const session = await verifyMcpBearer(auth, c.req.raw);
    // r[impl identity.mcp.bearer-required+4]
    if (!session) {
      return c.body(null, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource"`,
      });
    }
    const scope = await resolveScope({ userId: session.userId });
    // r[impl identity.mcp.token-one-account]
    const server = buildMcpServer(session.userId, deps, scope);
    // Stateless (no sessionIdGenerator): a fresh server per request, so each
    // POST is handled independently — no session store, no init handshake to
    // remember. `enableJsonResponse` returns a single JSON-RPC reply (we have no
    // streaming/progress needs) instead of an SSE stream.
    const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
    await server.connect(transport);
    // handleRequest returns the Response for the JSON-RPC exchange (or undefined
    // for a body-less ack, which shouldn't happen for POST tool calls).
    return (await transport.handleRequest(c)) ?? c.body(null, 202);
  });

  return r;
}
