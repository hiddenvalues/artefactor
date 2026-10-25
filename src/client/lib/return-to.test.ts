import { describe, expect, it } from "vitest";
import { pendingAuthorizeURL, safeReturnTo, signInReturnTo } from "./return-to";

// The post-sign-in destination is honoured only as a same-origin path, so a
// crafted `?returnTo=` can never send a user off-site.
describe("safeReturnTo", () => {
  const origin = "https://app.example";

  it("keeps an internal path, its query and hash", () => {
    expect(safeReturnTo("/a/x", origin)).toBe("/a/x");
    expect(safeReturnTo("/?tab=shared#top", origin)).toBe("/?tab=shared#top");
  });

  it("refuses a missing value, a relative path and an absolute URL", () => {
    expect(safeReturnTo(null, origin)).toBeNull();
    expect(safeReturnTo("a/x", origin)).toBeNull();
    expect(safeReturnTo("https://evil.example/", origin)).toBeNull();
  });

  it("refuses every spelling the URL parser reads as another host", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "\\\\evil.example", "/\t/evil.example", "/\n/evil.example"])
      expect(safeReturnTo(raw, origin), JSON.stringify(raw)).toBeNull();
  });
});

// S59 — signing in from a screen's path lands back on it.
describe("signInReturnTo", () => {
  const at = (path: string) => {
    const u = new URL(path, "https://app.example");
    return { pathname: u.pathname, search: u.search, origin: u.origin };
  };

  // r[verify platform.navigation.sign-in-keeps-path]
  it("prefers ?returnTo=", () => {
    expect(signInReturnTo(at("/account?returnTo=/a/x"))).toBe("/a/x");
  });

  // r[verify platform.navigation.sign-in-keeps-path]
  it("falls back to the current path, but not to /", () => {
    expect(signInReturnTo(at("/account"))).toBe("/account");
    expect(signInReturnTo(at("/"))).toBeNull();
  });

  // r[verify platform.navigation.sign-in-keeps-path]
  it("never leaves the origin", () => {
    expect(signInReturnTo({ pathname: "//evil.example", search: "", origin: "https://app.example" })).toBeNull();
    expect(signInReturnTo(at("/?returnTo=/%5Cevil.example"))).toBeNull();
  });
});

// S63 — an emailed sign-in link sent while an MCP client's authorize request is
// pending carries that request: following the link signs in and re-enters the
// authorize endpoint, which goes on to Consent.
describe("pendingAuthorizeURL", () => {
  const signed =
    "?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&scope=openid&state=xyz" +
    "&code_challenge=c&code_challenge_method=S256&resource=https%3A%2F%2Fapp.example%2Fmcp" +
    "&prompt=login+consent&exp=123&ba_iat=1&ba_param=client_id&ba_param=state&sig=s1g";

  it("is the authorize request without the signature, its expiry, the provider's markers or prompt=login", () => {
    const url = new URL(pendingAuthorizeURL(signed)!, "https://app.example");
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["client_id", "code_challenge", "code_challenge_method", "prompt", "redirect_uri", "resource", "response_type", "scope", "state"],
    );
    expect(url.searchParams.get("redirect_uri")).toBe("https://claude.ai/cb");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("is null with no pending request", () => {
    expect(pendingAuthorizeURL("")).toBeNull();
    expect(pendingAuthorizeURL("?returnTo=%2Fa%2Fx")).toBeNull();
    expect(pendingAuthorizeURL("?client_id=abc")).toBeNull();
  });
});
