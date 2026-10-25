import { useEffect, useRef, useState } from "react";
import { HOME, parsePath, resolveRoute, routePath, sameRoute, type Route, type RouteContext } from "./route";

/** What the route resolves against, and whether each part has first answered. */
export interface RouteReadiness extends RouteContext {
  collectionsLoaded: boolean;
  meLoaded: boolean;
}

// The answer a route can't be resolved without: a collection page needs the
// library's collections, Organization settings needs `/api/me`. The first load
// and Back/Forward both wait on it.
function needs(route: Route | null): "collectionsLoaded" | "meLoaded" | null {
  if (route?.view === "collection") return "collectionsLoaded";
  if (route?.view === "organization") return "meLoaded";
  return null;
}

// r[impl platform.navigation.waits-for-data]
function ready(route: Route | null, r: RouteReadiness): boolean {
  const answer = needs(route);
  return answer === null || r[answer];
}

const needsNothing = (route: Route | null): route is Route => route !== null && needs(route) === null;

/** A path held until what it needs has answered, and how the user reached it. */
interface Pending {
  target: Route | null;
  via: "load" | "pop";
}

/**
 * S59 — the shell's screen, kept in the URL. `route` is null while a path
 * waits for its data (the shell shows its loading state): the path loaded at
 * first, or one Back/Forward landed on (S61). `open` pushes one history entry
 * — none when the screen is already the URL's — and `leave` replaces the
 * current one; both drop a waiting path, so the last navigation wins. A waiting
 * path resolves through `onEnter` with the screen it lands on, as Back/Forward
 * onto a ready one does, so the shell applies its side effects without pushing.
 */
// r[impl platform.navigation.history]
export function useRoute(readiness: RouteReadiness, onEnter: (route: Route, via: "load" | "pop") => void) {
  const [initial] = useState(() => parsePath(window.location.pathname));
  const [pending, setPending] = useState<Pending | null>(() =>
    needsNothing(initial) ? null : { target: initial, via: "load" },
  );
  const [route, setRoute] = useState<Route | null>(() => (needsNothing(initial) ? initial : null));
  const latest = useRef({ readiness, onEnter });
  useEffect(() => {
    latest.current = { readiness, onEnter };
  });

  // A route the caller can't open replaces the URL with Home's (fallback-home).
  function show(target: Route | null): Route {
    const { route: next, replace } = resolveRoute(target, latest.current.readiness);
    if (replace) window.history.replaceState(null, "", routePath(next));
    setRoute(next);
    return next;
  }

  // Resolve a waiting path once what it needs has answered.
  const canResolve = pending !== null && ready(pending.target, readiness);
  useEffect(() => {
    if (!pending || !canResolve) return;
    setPending(null);
    latest.current.onEnter(show(pending.target), pending.via);
    // `show` reads the latest readiness through the ref.
  }, [pending, canResolve]);

  useEffect(() => {
    const onPopState = () => {
      const target = parsePath(window.location.pathname);
      if (ready(target, latest.current.readiness)) {
        setPending(null);
        latest.current.onEnter(show(target), "pop");
      } else {
        setPending({ target, via: "pop" });
        setRoute(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function open(next: Route) {
    const here = parsePath(window.location.pathname);
    if (!here || !sameRoute(here, next)) window.history.pushState(null, "", routePath(next));
    setPending(null);
    setRoute(next);
  }

  function leave(next: Route = HOME) {
    window.history.replaceState(null, "", routePath(next));
    setPending(null);
    setRoute(next);
  }

  return { route, open, leave };
}
