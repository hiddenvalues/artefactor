// A gated artefact link (e.g. a "Members" artefact opened by someone without an
// account) redirects to the sign-in screen as `/?returnTo=/a/<slug>`. Honour
// only same-origin internal paths (guard against open redirects), so the user
// lands on the artefact they came for once signed in.
export function readReturnTo(): string | null {
  return safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"), window.location.origin);
}

// S59 — where any sign-in method sends you: `?returnTo=` when present, else
// the screen's path you signed in from (the auth screen renders at it).
// r[impl platform.navigation.sign-in-keeps-path]
export function signInReturnTo(
  loc: Pick<Location, "pathname" | "search" | "origin"> = window.location,
): string | null {
  const param = new URLSearchParams(loc.search).get("returnTo");
  if (param) return safeReturnTo(param, loc.origin);
  return loc.pathname === "/" ? null : safeReturnTo(loc.pathname, loc.origin);
}

// A prefix check alone is not enough: the URL parser reads `\` as `/` and drops
// tabs and newlines, so `/\evil.example` or `/\t/evil.example` would leave the
// origin. Resolve the value and keep it only when it stays on `origin`.
export function safeReturnTo(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  try {
    return new URL(raw, origin).origin === origin ? raw : null;
  } catch {
    return null;
  }
}

// S48 — where a new account lands the first time a link signs it in: the
// set-password screen, which then goes on to `returnTo`.
export const WELCOME_PARAM = "welcome";
export const WELCOME_VALUE = "set-password";

export function welcomeURL(returnTo: string | null): string {
  const welcome = `/?${WELCOME_PARAM}=${WELCOME_VALUE}`;
  return returnTo ? `${welcome}&returnTo=${encodeURIComponent(returnTo)}` : welcome;
}

// S48 — BetterAuth's reset callback lands on this redirectTo, adding `token`
// (or `error=INVALID_TOKEN`) beside the param.
export const RESET_PARAM = "reset-password";
export const RESET_REDIRECT = `/?${RESET_PARAM}=1`;

// S63 — the MCP connector's consent screen, and whether this page carries the
// OAuth provider's signed authorize query (`…&sig=`). A sign-in from such a
// page resumes the authorize request server-side (`oauthProviderClient()` sends
// the query), and the provider says where to go next — so the auth screen
// doesn't navigate on its own.
export const CONSENT_PATH = "/oauth/consent";

export function hasSignedOAuthQuery(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return params.has("sig") && params.has("client_id");
}

// S63 — a pending connect's signed query lapses (its `exp`), and the provider
// then refuses every auth POST the page makes, since the auth client attaches
// the query to each one. The sign-in page shows the request as expired instead:
// up front once `exp` has passed, or when the provider refuses the signature.
export function signedOAuthQueryExpired(search: string = window.location.search, now = Date.now()): boolean {
  if (!hasSignedOAuthQuery(search)) return false;
  const exp = Number(new URLSearchParams(search).get("exp"));
  return Number.isFinite(exp) && exp * 1000 < now;
}

export function refusesSignedOAuthQuery(error: unknown): boolean {
  if (!hasSignedOAuthQuery() || typeof error !== "object" || error === null) return false;
  const { error: code } = error as { error?: unknown };
  return code === "invalid_signature";
}

// S63 — an emailed sign-in link can't resume the request the way a sign-in
// POST does (the provider resumes inside the request that sets the session),
// so the link carries the authorize request itself: following it signs in and
// re-enters the authorize endpoint, which goes on to Consent. The provider's
// signature, expiry and markers are dropped, and so is `prompt=login`, which
// the sign-in has just satisfied (as the provider's own resume does).
const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

export function pendingAuthorizeURL(search: string = window.location.search): string | null {
  if (!hasSignedOAuthQuery(search)) return null;
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (key === "sig" || key === "exp" || key.startsWith("ba_")) params.delete(key);
  }
  const prompt = params.get("prompt");
  if (prompt !== null) {
    const kept = prompt.split(" ").filter((p) => p && p !== "login");
    if (kept.length) params.set("prompt", kept.join(" "));
    else params.delete("prompt");
  }
  return `${AUTHORIZE_PATH}?${params.toString()}`;
}
