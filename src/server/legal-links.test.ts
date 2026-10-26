import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicConfigResponse } from "../shared/contracts";

// S67 — the legal links on /api/config. They are read at boot, so each case
// sets the env, resets the module registry and builds a fresh app. Both vars
// start blank, so a value in the ambient environment can't leak into a case.
async function config(vars: Record<string, string>): Promise<PublicConfigResponse> {
  for (const [key, value] of Object.entries({ LEGAL_TERMS_URL: "", LEGAL_PRIVACY_URL: "", ...vars })) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  const { createApp } = await import("./app");
  const res = await createApp().request("/api/config");
  expect(res.status).toBe(200);
  return (await res.json()) as PublicConfigResponse;
}

// A cold import of the whole app graph can pass Vitest's 5 s default when files run in parallel.
describe("/api/config — legal links (S67)", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // r[verify identity.config.legal-links]
  it("echoes both configured links", async () => {
    const body = await config({ LEGAL_TERMS_URL: "https://example.com/terms", LEGAL_PRIVACY_URL: "/privacy" });
    expect(body.legal).toEqual({ termsUrl: "https://example.com/terms", privacyUrl: "/privacy" });
  });

  // r[verify identity.config.legal-links]
  it("reports nulls when neither is set, and keeps the existing fields", async () => {
    const body = await config({});
    expect(body.legal).toEqual({ termsUrl: null, privacyUrl: null });
    expect(body).toMatchObject({
      emailPasswordEnabled: true,
      googleEnabled: false,
      signupAllowed: true,
      capabilities: { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false, shareInvitations: false },
    });
  });

  // r[verify identity.config.legal-links]
  it("reports only the privacy notice when only it is set", async () => {
    expect((await config({ LEGAL_PRIVACY_URL: "/privacy" })).legal).toEqual({ termsUrl: null, privacyUrl: "/privacy" });
  });

  // r[verify identity.config.legal-links]
  it("reports only the terms when only they are set", async () => {
    expect((await config({ LEGAL_TERMS_URL: "/terms" })).legal).toEqual({ termsUrl: "/terms", privacyUrl: null });
  });
});
