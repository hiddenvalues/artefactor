import { describe, expect, it } from "vitest";
import { ScryptLinkPasswordHasher } from "./link-password-hasher";

// S32a — the scrypt LinkPasswordHasher adapter.
describe("ScryptLinkPasswordHasher (S32a)", () => {
  const hasher = new ScryptLinkPasswordHasher();

  it("verifies the password it hashed and rejects another", async () => {
    const hash = await hasher.hash("correct-horse");
    expect(await hasher.verify("correct-horse", hash)).toBe(true);
    expect(await hasher.verify("correct-horsf", hash)).toBe(false);
  });

  it("never stores the password and salts each hash", async () => {
    const a = await hasher.hash("correct-horse");
    const b = await hasher.hash("correct-horse");
    expect(a).not.toContain("correct-horse");
    expect(a).not.toBe(b);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    expect(await hasher.verify("x", "not-a-hash")).toBe(false);
    expect(await hasher.verify("x", "scrypt$$")).toBe(false);
  });
});
