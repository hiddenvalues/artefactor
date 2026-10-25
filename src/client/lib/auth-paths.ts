// S73 — `/signin` and `/signup`, the addresses an external site links to: they
// pick the auth screen's opening tab and change no rule. Sign-up closed, the
// screen shows Sign in whatever the path. Signed in, neither is a route of the
// app shell, so it falls back to Home at `/` (platform.navigation.fallback-home).
export type AuthMode = "sign-in" | "sign-up";

const PATHS: Record<AuthMode, string> = { "sign-in": "/signin", "sign-up": "/signup" };

// r[impl identity.auth-screen.signin-signup-paths]
export function authPath(pathname: string = window.location.pathname): AuthMode | null {
  // One trailing slash is the same path, as the app shell's parsePath reads it.
  const trimmed = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (trimmed === PATHS["sign-in"]) return "sign-in";
  if (trimmed === PATHS["sign-up"]) return "sign-up";
  return null;
}

export function authModePath(mode: AuthMode): string {
  return PATHS[mode];
}
