import { createAuthClient } from "better-auth/react";

// Client for the BetterAuth handler mounted by the BFF at /api/auth. The base
// URL defaults to the current origin; in dev, Vite proxies /api to the Hono
// server, so the same-origin default works without extra config.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
