import { describe, expect, it } from "vitest";
import { generateSlug } from "./slug";

describe("generateSlug", () => {
  // r[verify hosting.slug.random-token]
  it("mints a short URL-safe token", () => {
    expect(generateSlug()).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  // r[verify hosting.slug.random-token]
  it("is random: a thousand mints never repeat", () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => generateSlug()));
    expect(slugs.size).toBe(1000);
  });
});
