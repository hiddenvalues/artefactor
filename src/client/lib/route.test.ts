import { describe, expect, it } from "vitest";
import { HOME, parsePath, resolveRoute, routePath, type Route } from "./route";

// S59 — every shell screen has a path, and a path names at most one screen.
describe("parsePath / routePath", () => {
  const table: [string, Route][] = [
    ["/", { view: "dashboard" }],
    ["/archive", { view: "archive" }],
    ["/account", { view: "account" }],
    ["/organization", { view: "organization" }],
    ["/c/abc", { view: "collection", id: "abc" }],
  ];

  // r[verify platform.navigation.paths]
  it("parses each screen's path", () => {
    for (const [path, route] of table) expect(parsePath(path), path).toEqual(route);
  });

  // r[verify platform.navigation.paths]
  it("accepts a trailing slash and decodes a collection id", () => {
    expect(parsePath("/account/")).toEqual({ view: "account" });
    expect(parsePath("/c/a%20b")).toEqual({ view: "collection", id: "a b" });
  });

  // r[verify platform.navigation.paths]
  it("parses anything else to null", () => {
    for (const path of ["/c/", "/c", "/c/abc/x", "/foo", "/archive/x", "//", "/c/%E0%A4%A"])
      expect(parsePath(path), path).toBeNull();
  });

  // r[verify platform.navigation.paths]
  it("round-trips every screen, encoding a collection id with a slash or a space", () => {
    for (const [path, route] of table) {
      expect(routePath(route)).toBe(path);
      expect(parsePath(routePath(route))).toEqual(route);
    }
    const odd: Route = { view: "collection", id: "a/b c" };
    expect(routePath(odd)).toBe("/c/a%2Fb%20c");
    expect(parsePath(routePath(odd))).toEqual(odd);
  });
});

// S59 — a path the caller can't open lands on Home, whatever the reason.
describe("resolveRoute", () => {
  const ctx = { collectionIds: new Set(["own-1", "shared-1"]), organizationOffered: false };

  // r[verify platform.navigation.fallback-home+2]
  it("sends an unparsed path Home, replacing the URL", () => {
    expect(resolveRoute(null, ctx)).toEqual({ route: HOME, replace: true });
  });

  // r[verify platform.navigation.fallback-home+2]
  it("treats a collection the caller can't open exactly like an unknown path", () => {
    expect(resolveRoute({ view: "collection", id: "nope" }, ctx)).toEqual(resolveRoute(parsePath("/foo"), ctx));
  });

  // r[verify platform.navigation.fallback-home+2]
  it("keeps an own or shared collection", () => {
    for (const id of ["own-1", "shared-1"])
      expect(resolveRoute({ view: "collection", id }, ctx)).toEqual({ route: { view: "collection", id }, replace: false });
  });

  // r[verify platform.navigation.fallback-home+2]
  it("keeps Organization settings only where it is offered", () => {
    const org: Route = { view: "organization" };
    expect(resolveRoute(org, ctx)).toEqual({ route: HOME, replace: true });
    expect(resolveRoute(org, { ...ctx, organizationOffered: true })).toEqual({ route: org, replace: false });
  });

  // r[verify platform.navigation.fallback-home+2]
  it("keeps the screens that need nothing", () => {
    for (const route of [HOME, { view: "archive" }, { view: "account" }] as Route[])
      expect(resolveRoute(route, ctx)).toEqual({ route, replace: false });
  });
});
