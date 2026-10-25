import { describe, expect, it } from "vitest";
import { authModePath, authPath } from "./auth-paths";

describe("authPath (S73)", () => {
  // r[verify identity.auth-screen.signin-signup-paths]
  it("reads /signin and /signup, with or without one trailing slash", () => {
    expect(authPath("/signin")).toBe("sign-in");
    expect(authPath("/signup")).toBe("sign-up");
    expect(authPath("/signin/")).toBe("sign-in");
    expect(authPath("/signup/")).toBe("sign-up");
  });

  // r[verify identity.auth-screen.signin-signup-paths]
  it("reads any other path as neither", () => {
    for (const p of ["/", "/account", "/signup//", "/signups", "/c/signup", "/sign-up"]) {
      expect(authPath(p), p).toBeNull();
    }
  });

  it("maps each mode back to its path", () => {
    expect(authModePath("sign-in")).toBe("/signin");
    expect(authModePath("sign-up")).toBe("/signup");
  });
});
