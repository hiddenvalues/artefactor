import { describe, expect, it } from "vitest";
import {
  FRAME_TOKEN_TTL_MS,
  signFrameToken,
  verifyFrameToken,
  type FrameTokenClaims,
} from "./frame-token";

// S36 (AD10) — the frame token: what authenticates a sandboxed frame instead of
// the session cookie it can no longer read.
describe("frame token (S36)", () => {
  const SECRET = "test-secret-at-least-32-characters-long";
  const NOW = Date.parse("2026-09-14T12:00:00.000Z");
  const claims: FrameTokenClaims = {
    artefactId: "a1",
    route: "slug",
    viewerId: "u1",
    authorId: "u2",
    exp: NOW + FRAME_TOKEN_TTL_MS,
  };

  it("lives five minutes", () => {
    expect(FRAME_TOKEN_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("round-trips the claims through sign → verify", () => {
    const token = signFrameToken(claims, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyFrameToken(token, SECRET, NOW)).toEqual({ status: "valid", claims });
  });

  it("round-trips a raw token's tenant and an anonymous-free own context", () => {
    const raw: FrameTokenClaims = {
      artefactId: "a1",
      route: "raw",
      viewerId: "u1",
      authorId: null,
      tenantId: "t1",
      exp: NOW + 1000,
    };
    expect(verifyFrameToken(signFrameToken(raw, SECRET), SECRET, NOW)).toEqual({
      status: "valid",
      claims: raw,
    });
  });

  it("rejects a tampered payload", () => {
    const [payload, sig] = signFrameToken(claims, SECRET).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, viewerId: "attacker" }),
    ).toString("base64url");
    expect(forged).not.toBe(payload);
    expect(verifyFrameToken(`${forged}.${sig}`, SECRET, NOW)).toEqual({ status: "invalid" });
  });

  it("rejects a tampered signature", () => {
    const token = signFrameToken(claims, SECRET);
    const at = token.indexOf(".") + 5;
    const flipped = token.slice(0, at) + (token[at] === "A" ? "B" : "A") + token.slice(at + 1);
    expect(verifyFrameToken(flipped, SECRET, NOW)).toEqual({ status: "invalid" });
  });

  it("rejects a non-canonical encoding of the right signature", () => {
    const token = signFrameToken(claims, SECRET);
    // A 32-byte MAC's last base64url character carries two unused bits: setting
    // one decodes to the same bytes, but is not the signature that was issued.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(token.at(-1)!);
    const variant = token.slice(0, -1) + alphabet[last ^ 1];
    expect(Buffer.from(variant.split(".")[1]!, "base64url")).toEqual(
      Buffer.from(token.split(".")[1]!, "base64url"),
    );
    expect(verifyFrameToken(variant, SECRET, NOW)).toEqual({ status: "invalid" });
  });

  it("rejects a token signed with another secret", () => {
    const token = signFrameToken(claims, "another-secret-of-sufficient-length!!");
    expect(verifyFrameToken(token, SECRET, NOW)).toEqual({ status: "invalid" });
  });

  it("rejects garbage", () => {
    for (const t of ["", "abc", "a.b.c", ".", "x."]) {
      expect(verifyFrameToken(t, SECRET, NOW)).toEqual({ status: "invalid" });
    }
  });

  it("reports a signed token past its exp as expired, not invalid", () => {
    const token = signFrameToken({ ...claims, exp: NOW - 1 }, SECRET);
    expect(verifyFrameToken(token, SECRET, NOW)).toEqual({ status: "expired", claims: { ...claims, exp: NOW - 1 } });
  });

  it("never signs with the raw secret itself (a derived key)", async () => {
    const { createHmac } = await import("node:crypto");
    const [payload, sig] = signFrameToken(claims, SECRET).split(".");
    const withRawSecret = createHmac("sha256", SECRET).update(payload!).digest("base64url");
    expect(sig).not.toBe(withRawSecret);
  });
});
