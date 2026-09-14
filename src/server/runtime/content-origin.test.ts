import { describe, expect, it } from "vitest";
import { contentOriginProblem } from "./content-origin";
import { envSchema } from "../env";

// S36 (AH28) — the content origin must be a separate registrable domain from the
// app: the host itself, a subdomain of it, or a parent domain of it would share
// cookies (and the site) with the app.
describe("ARTEFACTOR_CONTENT_ORIGIN validation (S36)", () => {
  const APP = "https://artefactor.example.com";

  it("accepts a separate domain, with or without a trailing slash or port", () => {
    expect(contentOriginProblem("https://humlycontent.com", APP)).toBeNull();
    expect(contentOriginProblem("https://humlycontent.com/", APP)).toBeNull();
    expect(contentOriginProblem("http://localhost:4000", "http://127.0.0.1:3000")).toBeNull();
  });

  it("refuses the app host itself, whatever the scheme or port", () => {
    expect(contentOriginProblem("https://artefactor.example.com", APP)).toMatch(/registrable domain/);
    expect(contentOriginProblem("http://artefactor.example.com:8443", APP)).toMatch(/registrable domain/);
  });

  it("refuses a subdomain of the app host", () => {
    expect(contentOriginProblem("https://content.artefactor.example.com", APP)).toMatch(/registrable domain/);
  });

  it("refuses a parent domain of the app host", () => {
    expect(contentOriginProblem("https://example.com", APP)).toMatch(/registrable domain/);
  });

  it("refuses a value that isn't a bare http(s) origin", () => {
    for (const value of [
      "https://humlycontent.com/frames",
      "https://humlycontent.com?x=1",
      "https://humlycontent.com#x",
      "humlycontent.com",
      "ftp://humlycontent.com",
      "not a url",
    ]) {
      expect(contentOriginProblem(value, APP)).toMatch(/origin/);
    }
  });

  describe("at startup", () => {
    const base = { BETTER_AUTH_URL: APP };
    const parse = (extra: Record<string, string>) => envSchema.safeParse({ ...base, ...extra });

    it("unset is fine", () => {
      expect(parse({}).success).toBe(true);
    });

    it("a separate domain is fine", () => {
      const parsed = parse({ ARTEFACTOR_CONTENT_ORIGIN: "https://humlycontent.com" });
      expect(parsed.success).toBe(true);
    });

    it("equal, subdomain, parent or path-bearing values fail validation", () => {
      for (const value of [
        APP,
        "https://content.artefactor.example.com",
        "https://example.com",
        "https://humlycontent.com/frames",
      ]) {
        const parsed = parse({ ARTEFACTOR_CONTENT_ORIGIN: value });
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error!.issues)).toContain("ARTEFACTOR_CONTENT_ORIGIN");
      }
    });
  });
});
