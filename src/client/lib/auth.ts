import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Client for the BetterAuth handler mounted by the BFF at /api/auth. The base
// URL defaults to the current origin; in dev, Vite proxies /api to the Hono
// server, so the same-origin default works without extra config.
//
// S33a — the magic-link plugin only adds `signIn.magicLink`: it sends nothing
// until the sign-in screen's magic-link form is used, and that form renders
// only where a superset registers the server plugin.
//
// S63 — `oauthProviderClient()` adds the page's signed OAuth query
// (`oauth_query`) to every auth POST made from a page that carries one: a
// sign-in on the login page resumes the MCP connector's authorize request, and
// the consent screen's calls name the request they answer.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), oauthProviderClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
