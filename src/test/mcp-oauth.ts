import { createHash, randomBytes } from "node:crypto";

// S63 — the OAuth walk an MCP client (claude.ai) makes against the app:
// register → authorize → consent → token. Shared by the SQLite and Postgres
// suites, so both drive the same provider endpoints the same way.

export type RequestApp = {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

export const MCP_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

export async function signUp(app: RequestApp, email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

// Dynamic client registration with no session, as a public (PKCE) client.
export async function registerClient(
  app: RequestApp,
  clientName = "Claude",
): Promise<Response> {
  return app.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [MCP_REDIRECT],
      client_name: clientName,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// The authorize request, as the signed-in user's browser sends it.
export async function authorize(
  app: RequestApp,
  cookie: string,
  clientId: string,
  challenge: string,
  resource: string | null,
): Promise<Response> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: MCP_REDIRECT,
    scope: "openid offline_access",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (resource) q.set("resource", resource);
  return app.request(`/api/auth/oauth2/authorize?${q.toString()}`, {
    headers: { cookie, accept: "text/html" },
    redirect: "manual",
  });
}

// The consent screen's Allow/Deny POST, carrying the signed query the
// authorize redirect put on `/oauth/consent`. Returns the URL the client is
// sent back to.
export async function consent(
  app: RequestApp,
  cookie: string,
  oauthQuery: string,
  accept: boolean,
): Promise<URL> {
  const res = await app.request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  });
  if (res.status !== 200) {
    throw new Error(`consent failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { url?: string; redirect_uri?: string };
  return new URL((body.url ?? body.redirect_uri)!);
}

export async function exchangeCode(
  app: RequestApp,
  clientId: string,
  code: string,
  verifier: string,
  resource: string | null,
): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: MCP_REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (resource) body.set("resource", resource);
  return app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

export type Tokens = {
  access_token: string;
  refresh_token?: string;
  clientId: string;
};

// The whole walk for a signed-in user: register, authorize, Allow, exchange.
export async function connect(
  app: RequestApp,
  cookie: string,
  resource: string | null,
): Promise<Tokens> {
  const client = (await (await registerClient(app)).json()) as {
    client_id: string;
  };
  const { verifier, challenge } = pkce();
  const authRes = await authorize(app, cookie, client.client_id, challenge, resource);
  const consentUrl = new URL(authRes.headers.get("location")!, "http://x");
  const back = await consent(app, cookie, consentUrl.search.slice(1), true);
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`no code: ${back.toString()}`);
  const tokenRes = await exchangeCode(app, client.client_id, code, verifier, resource);
  if (tokenRes.status !== 200) {
    throw new Error(`token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  return {
    ...((await tokenRes.json()) as { access_token: string; refresh_token?: string }),
    clientId: client.client_id,
  };
}

export async function callTool(
  app: RequestApp,
  bearer: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      Origin: "null",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}
