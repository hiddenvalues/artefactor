import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { SignJWT, decodeJwt, generateKeyPair } from "jose";
import {
  MCP_REDIRECT,
  authorize,
  callTool,
  connect,
  consent,
  exchangeCode,
  pkce,
  registerClient,
  signUp,
} from "../test/mcp-oauth";

// End-to-end S18/S63: drive the real app (`@better-auth/mcp` + the root MCP
// routes) against a throwaway db, through `app.request` with no listener.
// Covers discovery, dynamic client registration, the consent gate, the token
// exchange and the bearer guard on POST /mcp.
const BASE = "http://localhost:3000";
const MCP_URL = `${BASE}/mcp`;

describe("MCP connector (S18, S63)", () => {
  let app: Hono;
  let auth: typeof import("./auth").auth;

  async function me(cookie: string): Promise<string> {
    const res = await app.request("/api/me", { headers: { cookie } });
    return ((await res.json()) as { id: string }).id;
  }

  // A JWT signed with the deployment's own key, with chosen claims — to reach
  // the checks after the signature (expiry, audience, Account).
  async function signWithDeploymentKey(
    claims: Record<string, unknown>,
  ): Promise<string> {
    const { token } = await auth.api.signJWT({ body: { payload: claims } });
    return token;
  }

  async function issuer(): Promise<string> {
    return (await auth.$context).baseURL;
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    auth = (await import("./auth")).auth;
    app = createApp();
  });

  it("registers a public client with no session (DCR)", async () => {
    const res = await registerClient(app);
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { client_id?: string };
    expect(body.client_id).toBeTruthy();
  });

  it("mints no session JWT on a session read (the keys sign access tokens only)", async () => {
    const cookie = await signUp(app, "session-jwt@example.com");
    const res = await app.request("/api/auth/get-session", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-auth-jwt")).toBeNull();
  });

  it("serves OAuth discovery at the root well-known paths", async () => {
    const as = await app.request("/.well-known/oauth-authorization-server");
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as Record<string, string>;
    for (const key of [
      "registration_endpoint",
      "authorization_endpoint",
      "token_endpoint",
    ]) {
      expect(asBody[key]).toMatch(new RegExp(`^${BASE}/api/auth/oauth2/`));
    }

    // The RFC 8414 path-suffixed form the issuer's path implies.
    const issuerPath = new URL(asBody.issuer!).pathname;
    if (issuerPath !== "/") {
      const suffixed = await app.request(
        `/.well-known/oauth-authorization-server${issuerPath}`,
      );
      expect(suffixed.status).toBe(200);
      expect(((await suffixed.json()) as { issuer: string }).issuer).toBe(
        asBody.issuer,
      );
    }

    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const prm = await app.request(path);
      expect(prm.status).toBe(200);
      const prmBody = (await prm.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(prmBody.resource).toBe(MCP_URL);
      expect(prmBody.authorization_servers).toContain(asBody.issuer);
    }
  });

  // Discovery is public metadata, and a browser-based MCP client runs on an
  // origin of its own: every discovery path answers any origin, preflight
  // included. Registration and the token endpoint stay without it.
  it("serves discovery to any origin, preflight included, and nothing else", async () => {
    const origin = "https://inspector.example";
    const asBody = (await (await app.request("/.well-known/oauth-authorization-server")).json()) as {
      issuer: string;
    };
    const paths = [
      "/.well-known/oauth-authorization-server",
      `/.well-known/oauth-authorization-server${new URL(asBody.issuer).pathname}`,
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ];
    for (const path of paths) {
      const get = await app.request(path, { headers: { Origin: origin } });
      expect(get.status, path).toBe(200);
      expect(get.headers.get("access-control-allow-origin"), path).toBe("*");

      const preflight = await app.request(path, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "mcp-protocol-version",
        },
      });
      expect(preflight.status, path).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin"), path).toBe("*");
      expect(preflight.headers.get("access-control-allow-methods"), path).toContain("GET");
    }

    const register = await app.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(register.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  // r[verify identity.mcp.consent-required]
  it("sends a signed-in authorize request to the consent screen, with no code yet", async () => {
    const cookie = await signUp(app, "consent-gate@example.com");
    const client = (await (await registerClient(app)).json()) as {
      client_id: string;
    };
    const { challenge } = pkce();
    const res = await authorize(app, cookie, client.client_id, challenge, MCP_URL);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, BASE);
    expect(location.pathname).toBe("/oauth/consent");
    expect(location.toString().startsWith(MCP_REDIRECT)).toBe(false);
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("sig")).toBeTruthy();
  });

  // r[verify identity.mcp.consent-required]
  it("Allow issues a code that exchanges for an audience-bound JWT and a refresh token", async () => {
    const cookie = await signUp(app, "consent-allow@example.com");
    const userId = await me(cookie);
    const client = (await (await registerClient(app)).json()) as {
      client_id: string;
    };
    const { verifier, challenge } = pkce();
    const authRes = await authorize(app, cookie, client.client_id, challenge, MCP_URL);
    const signed = new URL(authRes.headers.get("location")!, BASE).search.slice(1);

    const back = await consent(app, cookie, signed, true);
    expect(back.toString().startsWith(MCP_REDIRECT)).toBe(true);
    const code = back.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await exchangeCode(app, client.client_id, code!, verifier, MCP_URL);
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    const claims = decodeJwt(tokens.access_token);
    expect(claims.sub).toBe(userId);
    expect([claims.aud].flat()).toContain(MCP_URL);
    expect(tokens.refresh_token).toBeTruthy();
  });

  // r[verify identity.mcp.consent-required]
  it("Deny returns access_denied to the client and no code", async () => {
    const cookie = await signUp(app, "consent-deny@example.com");
    const client = (await (await registerClient(app)).json()) as {
      client_id: string;
    };
    const { challenge } = pkce();
    const authRes = await authorize(app, cookie, client.client_id, challenge, MCP_URL);
    const signed = new URL(authRes.headers.get("location")!, BASE).search.slice(1);

    const back = await consent(app, cookie, signed, false);
    expect(back.toString().startsWith(MCP_REDIRECT)).toBe(true);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });

  // The full path a connector walks, ending in a tool call that acts as the
  // token's Account against the real DB.
  // r[verify identity.mcp.token-one-account]
  it("a bearer from the flow drives a tool call as its Account", async () => {
    const cookie = await signUp(app, "mcp-user@example.com");
    const userId = await me(cookie);
    const { access_token } = await connect(app, cookie, MCP_URL);

    // S36: /mcp is bearer-only and not under /api, so even an opaque Origin passes.
    const callRes = await callTool(app, access_token, "create_artefact", {
      title: "Via MCP",
      kind: "prototype",
      html: "<!doctype html><h1>mcp</h1>",
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
    expect(artefact.ownerId).toBe(userId);

    const list = (await (
      await app.request("/api/artefacts", { headers: { cookie } })
    ).json()) as { artefacts: { title: string }[] };
    expect(list.artefacts.some((a) => a.title === "Via MCP")).toBe(true);
  });

  // r[verify identity.mcp.bearer-required+4]
  it("rejects POST /mcp without a bearer (401 + protected-resource pointer)", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
    );
  });

  // r[verify identity.mcp.bearer-required+4]
  it("rejects a deployment-signed bearer bound to a client key (cnf, as DPoP binds it)", async () => {
    const cookie = await signUp(app, "dpop@example.com");
    const sub = await me(cookie);
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub, iss: await issuer(), aud: MCP_URL, iat: now, exp: now + 600 };
    // The same claims without the binding pass, so only `cnf` decides the 401.
    expect((await callTool(app, await signWithDeploymentKey(claims), "list_artefacts", {})).status).toBe(200);
    const bound = await signWithDeploymentKey({ ...claims, cnf: { jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" } });
    const res = await callTool(app, bound, "list_artefacts", {});
    expect(res.status).toBe(401);
  });

  // r[verify identity.mcp.bearer-required+4]
  it("rejects a deployment-signed bearer whose exp has passed", async () => {
    const cookie = await signUp(app, "expired@example.com");
    const sub = await me(cookie);
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signWithDeploymentKey({
      sub,
      iss: await issuer(),
      aud: MCP_URL,
      iat: past - 3600,
      exp: past,
    });
    const res = await callTool(app, token, "list_artefacts", {});
    expect(res.status).toBe(401);
  });

  // r[verify identity.mcp.token-audience]
  it("rejects a bearer signed by a key outside the deployment's set", async () => {
    const cookie = await signUp(app, "foreign-key@example.com");
    const sub = await me(cookie);
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const token = await new SignJWT({ sub })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(await issuer())
      .setAudience(MCP_URL)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
    const res = await callTool(app, token, "list_artefacts", {});
    expect(res.status).toBe(401);
  });

  // r[verify identity.mcp.token-audience]
  it("rejects a deployment-signed bearer bound to another resource", async () => {
    const cookie = await signUp(app, "other-aud@example.com");
    const sub = await me(cookie);
    for (const aud of ["https://other.example/mcp", BASE]) {
      const token = await signWithDeploymentKey({
        sub,
        iss: await issuer(),
        aud,
      });
      const res = await callTool(app, token, "list_artefacts", {});
      expect(res.status).toBe(401);
    }
  });

  // r[verify identity.mcp.token-audience]
  it("rejects a bearer minted by the flow without the MCP resource", async () => {
    const cookie = await signUp(app, "no-resource@example.com");
    const { access_token } = await connect(app, cookie, null);
    const res = await callTool(app, access_token, "list_artefacts", {});
    expect(res.status).toBe(401);
  });

  // r[verify identity.mcp.bearer-required+4]
  it("rejects a valid bearer whose Account has since been deleted", async () => {
    const cookie = await signUp(app, "gone@example.com");
    const userId = await me(cookie);
    const { access_token } = await connect(app, cookie, MCP_URL);
    expect((await callTool(app, access_token, "list_artefacts", {})).status).toBe(200);

    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(userId);
    const res = await callTool(app, access_token, "list_artefacts", {});
    expect(res.status).toBe(401);
  });

  // r[verify identity.mcp.bearer-required+4]
  it("a revoked refresh token no longer refreshes (invalid_grant)", async () => {
    const cookie = await signUp(app, "revoked@example.com");
    const { refresh_token, clientId } = await connect(app, cookie, MCP_URL);
    expect(refresh_token).toBeTruthy();

    const revoke = await app.request("/api/auth/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refresh_token!,
        token_type_hint: "refresh_token",
        client_id: clientId,
      }).toString(),
    });
    expect(revoke.status).toBe(200);

    const refresh = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh_token!,
        client_id: clientId,
        resource: MCP_URL,
      }).toString(),
    });
    expect(refresh.status).toBe(400);
    expect(((await refresh.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
  });
});
