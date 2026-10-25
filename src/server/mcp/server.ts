import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerArtefactTools, type McpToolDeps } from "./tools";
import { PERSISTENCE_CONTRACT_SUMMARY } from "./authoring-guide";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

export type { McpToolDeps } from "./tools";

// S18 — build a per-request MCP server bound to one authenticated Account. The
// server is stateless and short-lived: created on each `POST /mcp` after the
// bearer is resolved to a `userId`, so every tool acts as that user.
//
// S22 (hosting.tenant.invisible-to-oss) — `scope` is the Account's tenant scope; OSS passes the
// singleton (byte-identical). A superset resolves it from the token Account's active org.
//
// A superset's scope resolver may refuse the Account instead of scoping it: `refused` is the
// message every tool call then answers, as an error result (`McpScopeResolver`).
export interface McpScopeRefusal {
  refused: string;
}

export function buildMcpServer(
  userId: string,
  deps: McpToolDeps,
  scope: TenantScope | McpScopeRefusal,
): McpServer {
  const server = new McpServer(
    {
      name: "artefactor",
      version: "0.2.0",
    },
    {
      // Surfaced in the `initialize` response and injected into the model's
      // context when the connector is enabled — the ambient channel that stands
      // in for the Agent Skill clients like Claude design can't load. Carries the
      // persistence contract the model needs BEFORE it writes any artefact HTML.
      // r[impl mcp.guide.instructions-summary]
      instructions: PERSISTENCE_CONTRACT_SUMMARY,
    },
  );
  if ("refused" in scope) registerArtefactTools(refusing(server, scope.refused), userId, deps, NO_SCOPE);
  else registerArtefactTools(server, userId, deps, scope);
  return server;
}

// r[impl mcp.tools.scope-refusal]
// The same tools, advertised with the same schemas, each answering `message` as an error result
// in place of its body: the handshake and `tools/list` work, and no tool runs.
function refusing(server: McpServer, message: string): McpServer {
  const refused = { content: [{ type: "text" as const, text: message }], isError: true };
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  return Object.assign(Object.create(server) as McpServer, {
    registerTool: (name: string, config: unknown) => register(name, config, async () => refused),
  });
}

// What a refused Account's tools are registered with. Never read: no tool body runs.
const NO_SCOPE: TenantScope = {
  get tenantId(): string {
    throw new Error("A refused MCP scope has no tenant.");
  },
};
