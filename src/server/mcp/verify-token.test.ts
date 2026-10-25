import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { connect, signUp } from "../../test/mcp-oauth";

// S63 — `verifyMcpBearer` checks the JWT against the deployment's signing keys
// read in-process: no request to the server's own `/jwks`, which in production
// would hairpin through the public URL.
describe("verifyMcpBearer (S63)", () => {
  let app: Hono;
  let auth: typeof import("../auth").auth;
  let verifyMcpBearer: typeof import("./verify-token").verifyMcpBearer;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("../app");
    auth = (await import("../auth")).auth;
    verifyMcpBearer = (await import("./verify-token")).verifyMcpBearer;
    app = createApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function bearer(token: string | null): Request {
    return new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  // r[verify identity.mcp.token-audience]
  it("verifies a token with global fetch stubbed to throw", async () => {
    const cookie = await signUp(app, "no-self-http@example.com");
    const userId = (
      (await (await app.request("/api/me", { headers: { cookie } })).json()) as {
        id: string;
      }
    ).id;
    const { access_token } = await connect(app, cookie, "http://localhost:3000/mcp");

    vi.stubGlobal("fetch", () => {
      throw new Error("verifyMcpBearer must not make an HTTP request");
    });
    expect(await verifyMcpBearer(auth, bearer(access_token))).toEqual({ userId });
  });

  it("returns null for no bearer and for a malformed one", async () => {
    expect(await verifyMcpBearer(auth, bearer(null))).toBeNull();
    expect(await verifyMcpBearer(auth, bearer("not-a-jwt"))).toBeNull();
  });

  // r[verify identity.mcp.bearer-required+4]
  it("authenticates nothing with a token that carries no expiry", async () => {
    const cookie = await signUp(app, "no-exp@example.com");
    const userId = (
      (await (await app.request("/api/me", { headers: { cookie } })).json()) as {
        id: string;
      }
    ).id;
    // A key in the deployment's set, so only the claims decide. The provider
    // always sets `exp`, so this token is signed here rather than by it.
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const jwk = { ...(await exportJWK(publicKey)), kid: "no-exp-test", alg: "EdDSA" };
    vi.spyOn(auth.api, "getJwks").mockResolvedValue({ keys: [jwk] } as never);
    const iss = (await auth.$context).baseURL;
    const sign = (withExp: boolean) => {
      const jwt = new SignJWT({ sub: userId })
        .setProtectedHeader({ alg: "EdDSA", kid: "no-exp-test" })
        .setIssuer(iss)
        .setAudience("http://localhost:3000/mcp")
        .setIssuedAt();
      return (withExp ? jwt.setExpirationTime("10m") : jwt).sign(privateKey);
    };

    // The same token with an expiry passes, so only the missing `exp` decides.
    expect(await verifyMcpBearer(auth, bearer(await sign(true)))).toEqual({ userId });
    expect(await verifyMcpBearer(auth, bearer(await sign(false)))).toBeNull();
  });
});
