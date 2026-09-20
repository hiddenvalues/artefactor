import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";

// S38 (IA4, amended) — a deployment with the sign-up gate **closed** creates no
// accounts by any route, while accounts created before it closed keep working.
// The flag is read at boot, so this needs its own file: Vitest isolates modules
// per file, which is the only way to drive a second env.
process.env.AUTH_ALLOW_SIGNUP = "false";

describe("sign-up gate closed (S38)", () => {
  let app: Hono;
  let auth: typeof import("./auth").auth;
  let db: typeof import("../infra/db/client").db;
  let user: typeof import("../infra/db/schema").user;
  let account: typeof import("../infra/db/schema").account;

  // An account that existed *before* the gate closed: seeded straight through
  // Drizzle, since the create path is exactly what is now refused.
  const EXISTING = {
    id: randomUUID(),
    email: "early-bird@example.com",
    password: "correct-horse-battery",
  };

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    ({ db } = await import("../infra/db/client"));
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    ({ user, account } = await import("../infra/db/schema"));
    ({ auth } = await import("./auth"));
    const { createApp } = await import("./app");
    app = createApp();

    const now = new Date();
    await db.insert(user).values({
      id: EXISTING.id,
      name: "Early Bird",
      email: EXISTING.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(account).values({
      id: randomUUID(),
      accountId: EXISTING.id,
      providerId: "credential",
      userId: EXISTING.id,
      password: await (await auth.$context).password.hash(EXISTING.password),
      createdAt: now,
      updatedAt: now,
    });
  });

  it("refuses sign-up from an allowlisted address, writing no user row", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "latecomer@example.com",
        password: "correct-horse-battery",
        name: "Latecomer",
      }),
    });
    expect(res.status).toBe(403);

    const rows = await db
      .select()
      .from(user)
      .where(eq(user.email, "latecomer@example.com"));
    expect(rows).toHaveLength(0);
  });

  it("reports signupAllowed: false via /api/config", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signupAllowed: boolean };
    expect(body.signupAllowed).toBe(false);
  });

  it("still signs in an account created before the gate closed", async () => {
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EXISTING.email,
        password: EXISTING.password,
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;

    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()) as { id: string }).toMatchObject({
      id: EXISTING.id,
    });
  });

  // IA2 — the connector authorises an *existing* Account; it never creates one,
  // so a closed gate must not break it.
  it("still completes the MCP OAuth flow for an existing Account (IA2)", async () => {
    const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EXISTING.email,
        password: EXISTING.password,
      }),
    });
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;

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

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authRes = await app.request(
      `/api/auth/mcp/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        scope: "openid",
        state: "xyz",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString()}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(authRes.status).toBe(302);
    const code = new URL(authRes.headers.get("location")!).searchParams.get(
      "code",
    );
    expect(code).toBeTruthy();

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

    const callRes = await app.request("/mcp", {
      method: "POST",
      headers: {
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
            title: "Gate closed, connector open",
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
    };
    expect(artefact.ownerId).toBe(EXISTING.id);
  });
});
