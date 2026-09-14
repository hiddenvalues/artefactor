// S36 (AH28) — `ARTEFACTOR_CONTENT_ORIGIN`, the optional origin frames are served
// on. It must be a bare http(s) origin (`scheme://host[:port]`, no path) on a
// **separate registrable domain** from the app: the app host itself (any port —
// cookies don't isolate by port), a subdomain of it, or a parent domain of it
// would share the app's cookies and site. There is no public-suffix check, so
// e.g. two siblings under one registrable domain aren't caught here: the value
// is documented as needing its own registrable domain (e.g. `humlycontent.com`).
//
// Returns a message naming the problem, or null when the value is acceptable.
export function contentOriginProblem(value: string, appUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an origin (scheme://host[:port]), e.g. https://artefactor-content.com";
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    return "must be a bare http(s) origin (scheme://host[:port]) with no path, query or fragment";
  }
  let appHost: string;
  try {
    appHost = new URL(appUrl).hostname.toLowerCase();
  } catch {
    return null; // BETTER_AUTH_URL itself is reported on its own
  }
  const host = url.hostname.toLowerCase();
  const related =
    host === appHost
      ? "is the app host"
      : host.endsWith(`.${appHost}`)
        ? "is a subdomain of the app host"
        : appHost.endsWith(`.${host}`)
          ? "is a parent domain of the app host"
          : null;
  return related
    ? `${related} (${appHost}); the content origin must be on a separate registrable domain`
    : null;
}
