import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "./env";
import { resolveAuthConfig } from "../domain/identity/auth-config";

// S38 — the boot-time guard on "production has at least one enabled
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
  // r[verify identity.signin.production-needs-a-method]
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

  // r[verify identity.signin.production-needs-a-method]
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

  // deploy/docker-compose.example.yml passes `${GOOGLE_CLIENT_ID:-}`, so an
  // operator who configures no Google client hands the container an **empty
  // string**, not an absent variable. That has to read as "no Google", or the
  // email+password route out of the at-least-one-method rule would be unreachable through the supplied
  // Compose file.
  it("treats empty Google credentials as unset", () => {
    const empty = { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" };
    const res = prod({ ...empty, AUTH_EMAIL_PASSWORD: "true" });
    expect(res.success).toBe(true);
    expect(res.data!.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(res.data!.GOOGLE_CLIENT_SECRET).toBeUndefined();

    // ...and with no method at all it is that rule that refuses, not a string-length
    // complaint about a variable the operator deliberately left blank.
    const neither = prod(empty);
    expect(neither.success).toBe(false);
    expect(messages(neither)).toContain("production needs a sign-in method");
  });

  it("reads a blank Google credential as unset, not as configured", () => {
    // Half-configured is the dangerous shape: a whitespace-only id would
    // otherwise enable the provider and render a button that cannot work.
    const res = prod({
      GOOGLE_CLIENT_ID: "   ",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      AUTH_EMAIL_PASSWORD: "true",
    });
    expect(res.success).toBe(true);
    expect(res.data!.GOOGLE_CLIENT_ID).toBeUndefined();
  });
});

// r[verify identity.config.boolean-flags]
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

// S67 — the legal links a deployment points the sign-in screen at.
// r[verify identity.config.legal-links-validated]
describe("env schema — the legal links (S67)", () => {
  it("parses an absolute https URL and a root-relative path", () => {
    const res = prod({ ...GOOGLE, LEGAL_TERMS_URL: "https://example.com/terms", LEGAL_PRIVACY_URL: "/privacy" });
    expect(res.success).toBe(true);
    expect(res.data!.LEGAL_TERMS_URL).toBe("https://example.com/terms");
    expect(res.data!.LEGAL_PRIVACY_URL).toBe("/privacy");
  });

  it("parses both unset, or empty, as unset", () => {
    for (const over of [{}, { LEGAL_TERMS_URL: "", LEGAL_PRIVACY_URL: "" }] as Record<string, string>[]) {
      const res = prod({ ...GOOGLE, ...over });
      expect(res.success).toBe(true);
      expect(res.data!.LEGAL_TERMS_URL).toBeUndefined();
      expect(res.data!.LEGAL_PRIVACY_URL).toBeUndefined();
    }
  });

  for (const key of ["LEGAL_TERMS_URL", "LEGAL_PRIVACY_URL"] as const) {
    it(`rejects anything but an http(s) URL or a root-relative path for ${key}`, () => {
      for (const raw of ["javascript:alert(1)", "//evil.example/terms", "/\\evil.example/terms", "/\t/evil.example/terms", "/\n/evil.example/terms", "/\r\\evil.example/terms", "https:example.com/terms", "http:/example.com/terms", "terms", "ftp://x/y"]) {
        const res = prod({ ...GOOGLE, [key]: raw });
        expect(res.success, raw).toBe(false);
        expect(messages(res)).toContain(key);
      }
    });
  }
});

describe("env schema — trusted proxies (S42)", () => {
  it("accepts unset, empty and a valid list", () => {
    expect(prod(GOOGLE).success).toBe(true);
    expect(prod({ ...GOOGLE, ARTEFACTOR_TRUSTED_PROXIES: "" }).success).toBe(true);
    expect(prod({ ...GOOGLE, ARTEFACTOR_TRUSTED_PROXIES: "203.0.113.0/24, ::1" }).success).toBe(true);
  });

  // r[verify identity.client-ip.trusted-set]
  it("rejects an invalid value with a message naming the variable", () => {
    const res = prod({ ...GOOGLE, ARTEFACTOR_TRUSTED_PROXIES: "nope" });
    expect(res.success).toBe(false);
    expect(messages(res)).toContain("ARTEFACTOR_TRUSTED_PROXIES");
  });
});

// S63 — the MCP connector's OAuth resource and issuer are built from
// BETTER_AUTH_URL (`<url>/mcp`, `<url>/api/auth`), and the provider refuses a
// resource that isn't https (plain http only on a loopback host). The schema
// says so at boot, naming the variable, rather than the provider throwing
// inside its own setup; and a trailing slash can't double the path's slash.
describe("env schema — BETTER_AUTH_URL (S63)", () => {
  const dev = (url: string) => envSchema.safeParse({ ...base, BETTER_AUTH_URL: url });

  it("drops trailing slashes", () => {
    const res = prod({ ...GOOGLE, BETTER_AUTH_URL: "https://artefactor.example.com//" });
    expect(res.success && res.data.BETTER_AUTH_URL).toBe("https://artefactor.example.com");
  });

  it("accepts https anywhere, and plain http on a loopback host", () => {
    for (const url of [
      "https://artefactor.example.com",
      "https://feat.artefactor.localhost",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(dev(url).success, url).toBe(true);
    }
  });

  it("rejects plain http on another host, or a value that isn't a bare URL, naming the variable", () => {
    for (const url of [
      "http://artefactor.lan:3000",
      "http://10.0.0.5",
      "artefactor.example.com",
      "https://user:pw@artefactor.example.com",
      "https://artefactor.example.com/?x=1",
    ]) {
      const res = dev(url);
      expect(res.success, url).toBe(false);
      expect(messages(res), url).toContain("BETTER_AUTH_URL");
    }
  });
});

describe("env schema — storage roots (S35)", () => {
  // r[verify hosting.thumbnail.stored-beside-payloads+2]
  it("defaults the thumbnail root to a sibling of the payload root, never inside it", () => {
    const res = envSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const thumbnails = posix.normalize(res.data.ARTEFACTOR_THUMBNAIL_DIR);
    const payloads = posix.normalize(res.data.ARTEFACTOR_PAYLOAD_DIR);
    expect(posix.dirname(thumbnails)).toBe(posix.dirname(payloads));
    expect(thumbnails).not.toBe(payloads);
  });
});
