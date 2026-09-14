import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

// End-to-end S18: drive the real app (BetterAuth `mcp` plugin + the root MCP
// routes) against a throwaway db. Covers the OAuth discovery surface, the
// bearer guard on POST /mcp, and dynamic client registration.
describe("MCP connector (S18)", () => {
  let app: Hono;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
  });

  it("exposes OAuth discovery at the root well-known paths", async () => {
    const as = await app.request("/.well-known/oauth-authorization-server");
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as Record<string, unknown>;
    // The authorization-server metadata advertises the OAuth endpoints.
    expect(typeof asBody.authorization_endpoint).toBe("string");
    expect(typeof asBody.token_endpoint).toBe("string");
    expect(typeof asBody.registration_endpoint).toBe("string");

    const prm = await app.request("/.well-known/oauth-protected-resource");
    expect(prm.status).toBe(200);
    const prmBody = (await prm.json()) as { authorization_servers: string[] };
    expect(Array.isArray(prmBody.authorization_servers)).toBe(true);
  });

  it("rejects POST /mcp without a bearer (401 + protected-resource pointer)", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("supports dynamic client registration", async () => {
    const res = await app.request("/api/auth/mcp/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        client_name: "Claude",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(res.status).toBe(201); // RFC 7591 Created
    const body = (await res.json()) as { client_id?: string };
    expect(body.client_id).toBeTruthy();
  });

  // The full path a connector walks: register → authorize (logged-in) → exchange
  // code for a bearer → call a tool. Proves the bearer authenticates an MCP
  // request and the tool acts as that Account against the real DB.
  it("OAuth authorization-code flow yields a bearer that drives a tool call", async () => {
    const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
    const cookie = await signUp("mcp-user@example.com");
    const me = (await (
      await app.request("/api/me", { headers: { cookie } })
    ).json()) as { id: string };

    // 1. Register a public client.
    const client = (await (
      await app.request("/api/auth/mcp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT],
          client_name: "Claude",
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      })
    ).json()) as { client_id: string };

    // 2. Authorize as the logged-in user → 302 redirect carrying the code.
    // Public clients must use PKCE (S256), as claude.ai does.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authQuery = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      scope: "openid",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authRes = await app.request(
      `/api/auth/mcp/authorize?${authQuery.toString()}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get("location")!;
    const code = new URL(location).searchParams.get("code");
    expect(code).toBeTruthy();

    // 3. Exchange the code for an access token (public client, no secret).
    const tokenRes = await app.request("/api/auth/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    // 4. Call a tool with the bearer — JSON-RPC over POST /mcp. S36 (IA6): /mcp
    // is bearer-only and not under /api, so even an opaque Origin passes.
    const callRes = await app.request("/mcp", {
      method: "POST",
      headers: {
        Origin: "null",
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_artefact",
          arguments: {
            title: "Via MCP",
            kind: "prototype",
            html: "<!doctype html><h1>mcp</h1>",
          },
        },
      }),
    });
    expect(callRes.status).toBe(200);
    const rpc = (await callRes.json()) as {
      result?: { content: { text: string }[]; isError?: boolean };
    };
    expect(rpc.result?.isError).toBeFalsy();
    const artefact = JSON.parse(rpc.result!.content[0]!.text) as {
      ownerId: string;
      title: string;
    };
    // The tool acted as the token's Account.
    expect(artefact.ownerId).toBe(me.id);
    expect(artefact.title).toBe("Via MCP");

    // ...and it really persisted: the owner sees it via the BFF.
    const list = (await (
      await app.request("/api/artefacts", { headers: { cookie } })
    ).json()) as { artefacts: { title: string }[] };
    expect(list.artefacts.some((a) => a.title === "Via MCP")).toBe(true);
  });
});
