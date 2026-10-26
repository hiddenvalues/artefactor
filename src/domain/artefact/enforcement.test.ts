import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  MIN_PAYLOAD_CAP_BYTES,
  capMessage,
  effectivePayloadCap,
  ossEnforcement,
} from "./enforcement";

// S23 — the OSS defaults of the enforcement seams: every create and edit is allowed, the cap is
// 100 MB and no public serve carries a badge, so OSS behaves as it did before the seams.
describe("OSS enforcement defaults (S23)", () => {
  const ctx = { ownerId: "u1", tenantId: "default" };

  // r[verify platform.enforcement.oss-defaults+2]
  it("allows every create and edit, whatever its size", async () => {
    for (const action of ["create", "edit"] as const) {
      for (const bytes of [1, DEFAULT_MAX_PAYLOAD_BYTES, 10 * DEFAULT_MAX_PAYLOAD_BYTES]) {
        expect(await ossEnforcement.quota.check({ ...ctx, action, bytes })).toEqual({
          decision: "allow",
        });
      }
    }
  });

  // r[verify platform.enforcement.oss-defaults+2]
  it("caps a payload at 100 MB and shows no badge", async () => {
    expect(DEFAULT_MAX_PAYLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(await ossEnforcement.payloadSize.maxBytes(ctx)).toBe(DEFAULT_MAX_PAYLOAD_BYTES);
    expect(await ossEnforcement.branding.badgeFor({ ...ctx, artefactId: "a1" })).toBeNull();
  });

  // r[verify hosting.payload.cap-policy-decided+2]
  it("keeps a policy's cap between 1 MB and the 100 MB ceiling", () => {
    const MB = 1024 * 1024;
    expect(MIN_PAYLOAD_CAP_BYTES).toBe(MB);
    expect(effectivePayloadCap(10 * MB)).toBe(10 * MB);
    expect(effectivePayloadCap(200 * MB)).toBe(DEFAULT_MAX_PAYLOAD_BYTES);
    for (const odd of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, "10"]) {
      expect(effectivePayloadCap(odd)).toBe(DEFAULT_MAX_PAYLOAD_BYTES);
    }
    for (const low of [0, -5, 1, MB - 1]) expect(effectivePayloadCap(low)).toBe(MB);
    expect(effectivePayloadCap(10.5 * MB + 0.5)).toBe(10.5 * MB);
  });

  // r[verify hosting.payload.cap-policy-decided+2]
  it("names the cap in megabytes, as the 100 MB message always read", () => {
    expect(capMessage(DEFAULT_MAX_PAYLOAD_BYTES)).toBe("payload exceeds the 100 MB cap");
    expect(capMessage(10 * 1024 * 1024)).toBe("payload exceeds the 10 MB cap");
  });
});
