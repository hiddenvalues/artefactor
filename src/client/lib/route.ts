// S59 — the shell's screens as paths. Pure: `use-route.ts` wires it to history.

export type Route =
  | { view: "dashboard" }
  | { view: "archive" }
  | { view: "account" }
  | { view: "organization" }
  | { view: "collection"; id: string };

export const HOME: Route = { view: "dashboard" };

const FIXED: Record<string, Route> = {
  "": HOME,
  archive: { view: "archive" },
  account: { view: "account" },
  organization: { view: "organization" },
};

// One path per screen; a trailing slash is accepted, anything else is null.
// r[impl platform.navigation.paths]
export function parsePath(pathname: string): Route | null {
  // One trailing slash after a segment (`/account/`), never a bare `//`.
  const trimmed = /[^/]\/$/.test(pathname) ? pathname.slice(0, -1) : pathname;
  if (trimmed !== "/" && trimmed.endsWith("/")) return null;
  if (!trimmed.startsWith("/")) return null;
  const segments = trimmed.slice(1).split("/");
  if (segments.length === 1) return Object.hasOwn(FIXED, segments[0]!) ? FIXED[segments[0]!]! : null;
  if (segments.length !== 2 || segments[0] !== "c" || !segments[1]) return null;
  try {
    return { view: "collection", id: decodeURIComponent(segments[1]) };
  } catch {
    return null; // a malformed escape names no collection
  }
}

export function routePath(route: Route): string {
  return route.view === "collection"
    ? `/c/${encodeURIComponent(route.id)}`
    : route.view === "dashboard"
      ? "/"
      : `/${route.view}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routePath(a) === routePath(b);
}

/** What the caller can open: their own and shared active collections, and
 *  whether Organization settings is offered (an org context). */
export interface RouteContext {
  collectionIds: ReadonlySet<string>;
  organizationOffered: boolean;
}

// A route the caller can't open lands on Home the same way whatever the
// reason, so the URL never tells a hidden collection from a missing one
// (hosting.access.no-existence-leak).
// r[impl platform.navigation.fallback-home+2]
export function resolveRoute(route: Route | null, ctx: RouteContext): { route: Route; replace: boolean } {
  const home = { route: HOME, replace: true };
  if (!route) return home;
  if (route.view === "collection" && !ctx.collectionIds.has(route.id)) return home;
  if (route.view === "organization" && !ctx.organizationOffered) return home;
  return { route, replace: false };
}
