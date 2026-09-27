import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Client for the BetterAuth handler mounted by the BFF at /api/auth. The base
// URL defaults to the current origin; in dev, Vite proxies /api to the Hono
// server, so the same-origin default works without extra config.
//
// S33a — the magic-link plugin only adds `signIn.magicLink`: it sends nothing
// until the sign-in screen's magic-link form is used, and that form renders
// only where a superset registers the server plugin.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });

export const { signIn, signUp, signOut, useSession } = authClient;
