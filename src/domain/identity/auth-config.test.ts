import { describe, expect, it } from "vitest";
import {
  resolveAuthConfig,
  type AuthConfigInput,
} from "./auth-config";

// S38 (IA7) — the pure sign-in-method decision. The whole truth table lives
// here; env.ts, auth.ts and the config route only consume the result.
const input = (over: Partial<AuthConfigInput> = {}): AuthConfigInput => ({
  nodeEnv: "production",
  emailPassword: undefined,
  allowSignup: undefined,
  googleConfigured: false,
  ...over,
});

describe("resolveAuthConfig (S38)", () => {
  describe("emailPasswordEnabled", () => {
    it("defaults to off in production", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "production" })).emailPasswordEnabled,
      ).toBe(false);
    });

    it("defaults to on in development and test", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "development" }))
          .emailPasswordEnabled,
      ).toBe(true);
      expect(
        resolveAuthConfig(input({ nodeEnv: "test" })).emailPasswordEnabled,
      ).toBe(true);
    });

    it("honours an explicit true in production", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "production", emailPassword: true }))
          .emailPasswordEnabled,
      ).toBe(true);
    });

    it("honours an explicit false in development", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "development", emailPassword: false }))
          .emailPasswordEnabled,
      ).toBe(false);
    });
  });

  describe("googleEnabled", () => {
    it("mirrors googleConfigured exactly", () => {
      for (const nodeEnv of ["development", "test", "production"] as const) {
        expect(
          resolveAuthConfig(input({ nodeEnv, googleConfigured: true }))
            .googleEnabled,
        ).toBe(true);
        expect(
          resolveAuthConfig(input({ nodeEnv, googleConfigured: false }))
            .googleEnabled,
        ).toBe(false);
      }
    });
  });

  describe("signupAllowed default (tracks the unverified path)", () => {
    it("is closed in production when email+password is enabled", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "production", emailPassword: true }))
          .signupAllowed,
      ).toBe(false);
    });

    it("is open for a Google-only production deployment", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "production", googleConfigured: true }))
          .signupAllowed,
      ).toBe(true);
    });

    it("is closed in production when both methods are enabled", () => {
      expect(
        resolveAuthConfig(
          input({
            nodeEnv: "production",
            emailPassword: true,
            googleConfigured: true,
          }),
        ).signupAllowed,
      ).toBe(false);
    });

    it("is open in development and test", () => {
      expect(
        resolveAuthConfig(input({ nodeEnv: "development" })).signupAllowed,
      ).toBe(true);
      expect(resolveAuthConfig(input({ nodeEnv: "test" })).signupAllowed).toBe(
        true,
      );
    });
  });

  describe("an explicit allowSignup wins over the default", () => {
    const cases: { name: string; over: Partial<AuthConfigInput> }[] = [
      {
        name: "production with email+password (default closed)",
        over: { nodeEnv: "production", emailPassword: true },
      },
      {
        name: "production Google-only (default open)",
        over: { nodeEnv: "production", googleConfigured: true },
      },
      {
        name: "production with both (default closed)",
        over: {
          nodeEnv: "production",
          emailPassword: true,
          googleConfigured: true,
        },
      },
      { name: "development (default open)", over: { nodeEnv: "development" } },
      { name: "test (default open)", over: { nodeEnv: "test" } },
    ];

    for (const { name, over } of cases) {
      it(`${name}: true opens it, false closes it`, () => {
        expect(
          resolveAuthConfig(input({ ...over, allowSignup: true })).signupAllowed,
        ).toBe(true);
        expect(
          resolveAuthConfig(input({ ...over, allowSignup: false })).signupAllowed,
        ).toBe(false);
      });
    }
  });
});
