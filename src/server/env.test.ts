import { describe, expect, it } from "vitest";
import { envSchema } from "./env";
import { resolveAuthConfig } from "../domain/identity/auth-config";

// S38 (IA7) — the boot-time guard on "production has at least one enabled
// sign-in method". `env` is a module singleton that `process.exit(1)`s on a bad
// configuration, so the exported schema is the testable boot-failure surface.
const base = {
  BETTER_AUTH_SECRET: "a-real-production-secret-value",
  BETTER_AUTH_URL: "https://artefactor.example.com",
  AUTH_ALLOWED_EMAIL_DOMAINS: "example.com",
};

const prod = (over: Record<string, string> = {}) =>
  envSchema.safeParse({ ...base, NODE_ENV: "production", ...over });

const GOOGLE = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

function messages(result: ReturnType<typeof prod>): string {
  return result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
}

describe("env schema — sign-in methods (S38)", () => {
  it("accepts production with email+password and no Google credentials", () => {
    const res = prod({ AUTH_EMAIL_PASSWORD: "true" });
    expect(res.success).toBe(true);
  });

  it("accepts production with Google only, and keeps email+password off (S1)", () => {
    const res = prod(GOOGLE);
    expect(res.success).toBe(true);
    const cfg = resolveAuthConfig({
      nodeEnv: res.data!.NODE_ENV,
      emailPassword: res.data!.AUTH_EMAIL_PASSWORD,
      allowSignup: res.data!.AUTH_ALLOW_SIGNUP,
      googleConfigured: true,
    });
    expect(cfg.emailPasswordEnabled).toBe(false);
    expect(cfg.googleEnabled).toBe(true);
  });

  it("rejects production with neither method, naming both routes out", () => {
    const res = prod();
    expect(res.success).toBe(false);
    const msg = messages(res);
    expect(msg).toContain("GOOGLE_CLIENT_ID");
    expect(msg).toContain("GOOGLE_CLIENT_SECRET");
    expect(msg).toContain("AUTH_EMAIL_PASSWORD");
  });

  it("requires no sign-in method outside production", () => {
    const res = envSchema.safeParse({ ...base, NODE_ENV: "development" });
    expect(res.success).toBe(true);
  });
});

describe("env schema — the auth booleans (S38)", () => {
  for (const key of ["AUTH_EMAIL_PASSWORD", "AUTH_ALLOW_SIGNUP"] as const) {
    describe(key, () => {
      it("parses true/TRUE/1 as true", () => {
        for (const raw of ["true", "TRUE", "1"]) {
          const res = prod({ ...GOOGLE, [key]: raw });
          expect(res.success).toBe(true);
          expect(res.data![key]).toBe(true);
        }
      });

      it("parses false/FALSE/0 as false", () => {
        for (const raw of ["false", "FALSE", "0"]) {
          const res = prod({ ...GOOGLE, [key]: raw });
          expect(res.success).toBe(true);
          expect(res.data![key]).toBe(false);
        }
      });

      it("parses the empty string as unset", () => {
        const res = prod({ ...GOOGLE, [key]: "" });
        expect(res.success).toBe(true);
        expect(res.data![key]).toBeUndefined();
      });

      it("rejects a non-boolean string", () => {
        const res = prod({ ...GOOGLE, [key]: "yes-please" });
        expect(res.success).toBe(false);
        expect(messages(res)).toContain(key);
      });
    });
  }
});
