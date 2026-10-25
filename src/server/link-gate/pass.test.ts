import { describe, expect, it } from "vitest";
import {
  PASS_TTL_MS,
  passCookieName,
  passExpiry,
  signPass,
  verifyPass,
} from "./pass";

// S32a — the link pass: an HMAC-signed cookie proving a viewer unlocked one
// holder's password at one gate version.

const SECRET = "test-secret-at-least-32-characters-long!!";
const NOW = Date.parse("2026-06-01T12:00:00Z");

describe("link pass (S32a)", () => {
  // r[verify hosting.link-gate.correct-password-yields-pass]
  it("round-trips the version for its own holder", () => {
    const token = signPass({ holderId: "a1", version: 3, exp: NOW + 1000 }, SECRET);
    expect(verifyPass(token, "a1", SECRET, NOW)).toEqual({ version: 3 });
  });

  // r[verify hosting.link-gate.correct-password-yields-pass]
  it("does not open another holder", () => {
    const token = signPass({ holderId: "a1", version: 3, exp: NOW + 1000 }, SECRET);
    expect(verifyPass(token, "a2", SECRET, NOW)).toBeNull();
  });

  it("is void once expired", () => {
    const token = signPass({ holderId: "a1", version: 3, exp: NOW }, SECRET);
    expect(verifyPass(token, "a1", SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload, another secret and garbage", () => {
    const token = signPass({ holderId: "a1", version: 3, exp: NOW + 1000 }, SECRET);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ holderId: "a1", version: 4, exp: NOW + 1000 }),
    ).toString("base64url");
    expect(verifyPass(`${forged}.${sig}`, "a1", SECRET, NOW)).toBeNull();
    expect(verifyPass(`${payload}.${sig}`, "a1", `${SECRET}x`, NOW)).toBeNull();
    expect(verifyPass("garbage", "a1", SECRET, NOW)).toBeNull();
  });

  it("names the cookie per holder", () => {
    expect(passCookieName("a1")).not.toBe(passCookieName("a2"));
    expect(passCookieName("a1")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // r[verify hosting.link-gate.correct-password-yields-pass]
  // r[verify hosting.link-gate.pass-bounded-by-expiry]
  it("lasts 7 days, capped at the gate's expiry", () => {
    expect(passExpiry(NOW, null)).toBe(NOW + PASS_TTL_MS);
    expect(PASS_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const soon = new Date(NOW + 60_000);
    expect(passExpiry(NOW, soon)).toBe(soon.getTime());
    const later = new Date(NOW + 30 * 24 * 60 * 60 * 1000);
    expect(passExpiry(NOW, later)).toBe(NOW + PASS_TTL_MS);
  });

  // r[verify hosting.link-gate.pass-bounded-by-expiry]
  it("minted a day before the gate's expiry, is refused once the gate has expired", () => {
    const expiresAt = new Date(NOW + 24 * 60 * 60 * 1000);
    const token = signPass({ holderId: "a1", version: 0, exp: passExpiry(NOW, expiresAt) }, SECRET);
    expect(verifyPass(token, "a1", SECRET, expiresAt.getTime() - 1)).toEqual({ version: 0 });
    expect(verifyPass(token, "a1", SECRET, expiresAt.getTime() + 1)).toBeNull();
  });
});
