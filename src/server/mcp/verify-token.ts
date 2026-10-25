import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import type { AuthInstance } from "../middleware/auth";

// S63 — resolve an MCP request's `Authorization: Bearer` to the Account it acts
// as. The access token is a JWT the OAuth provider signed with a `jwt`-plugin
// key and bound to this deployment's `/mcp` resource. It is verified against
// the key set read **in-process** (`auth.api.getJwks()` reads the `jwks` rows):
// the library's `requireMcpAuth` fetches the server's own `/jwks` over HTTP,
// which in production hairpins through the public URL.
//
// `null` means "authenticates nothing": no bearer, a bad signature, another
// issuer or audience, an expired token, a token bound to a client key (`cnf`),
// or an Account that no longer exists.

export function mcpResource(auth: AuthInstance): string {
  return `${auth.options.baseURL}/mcp`;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
}

// r[impl identity.mcp.token-audience]
export async function verifyMcpBearer(
  auth: AuthInstance,
  request: Request,
): Promise<{ userId: string } | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const ctx = await auth.$context;
  const keys = (await auth.api.getJwks()) as JSONWebKeySet;
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: ctx.baseURL,
      audience: mcpResource(auth),
      // jose checks `exp` only when present: a token with no expiry would
      // never lapse, so it authenticates nothing.
      requiredClaims: ["exp"],
    });
    // A token bound to a client key (`cnf`, e.g. DPoP's `jkt`) is only as good
    // as the proof of that key, which `/mcp` doesn't check: refuse it rather
    // than honour it as a plain bearer, which would void the binding.
    if (payload.cnf !== undefined) return null;
    sub = payload.sub;
  } catch {
    return null;
  }
  if (!sub) return null;

  // A token outlives nothing it names: a deleted Account authenticates nothing.
  const user = await ctx.internalAdapter.findUserById(sub);
  return user ? { userId: user.id } : null;
}
