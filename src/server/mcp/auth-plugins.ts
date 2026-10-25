import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";

// S18/S63 — the MCP connector's authorization server, as BetterAuth plugins.
// One definition for every deployment's auth instance (the OSS SQLite one and a
// superset's), so the consent rule is configured in exactly one place.
//
// `@better-auth/mcp` is an OAuth 2.1 provider (`@better-auth/oauth-provider`)
// bound to the `/mcp` resource: dynamic client registration (`/oauth2/register`,
// open to clients with no session), authorize, consent and token under
// `/api/auth/oauth2/*`. The `jwt` plugin signs the access tokens, audience-bound
// to `/mcp`, which the root route verifies in-process (`verify-token.ts`). An
// unauthenticated authorize request goes to `loginPage` (the SPA root) and
// resumes after sign-in; a signed-in one goes to the SPA consent screen. No
// client skips consent: registration refuses `skip_consent`, and nothing here
// sets it. See docs/specs/ddd/identity-access.md "Programmatic access (MCP
// connector)".
export function mcpAuthPlugins(baseURL: string) {
  return [
    // The keys sign the provider's access tokens only: no session JWT is minted
    // on every `getSession` (the `set-auth-jwt` header nothing reads).
    jwt({ disableSettingJwtHeader: true }),
    // r[impl identity.mcp.consent-required]
    mcp({
      loginPage: "/",
      consentPage: "/oauth/consent",
      resource: `${baseURL}/mcp`,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // The consent screen reads the client's public name through
      // `/oauth2/public-client-prelogin`, which first verifies the signed
      // query — so an expired or tampered request never shows Allow.
      allowPublicClientPrelogin: true,
    }),
  ] as const;
}
