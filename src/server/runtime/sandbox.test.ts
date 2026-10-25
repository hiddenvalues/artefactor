import { describe, expect, it } from "vitest";
import {
  FRAME_ALLOW,
  FRAME_SANDBOX_FLAGS,
  frameSecurityHeaders,
} from "./sandbox";

// S36 — the flags a served artefact runs under, single-sourced for the
// iframe attribute and the response header.
describe("frame sandbox (S36)", () => {
  // r[verify hosting.frame.sandboxed]
  it("allows scripts, forms, popups, modals and downloads — never same-origin or top navigation", () => {
    expect(FRAME_SANDBOX_FLAGS).toBe(
      "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
    );
    expect(FRAME_SANDBOX_FLAGS).not.toMatch(/allow-same-origin|allow-top-navigation/);
  });

  // r[verify hosting.frame.sandbox-header+2]
  it("carries the same flags in the CSP header, with no other directive, and no referrer", () => {
    const headers = frameSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toBe(`sandbox ${FRAME_SANDBOX_FLAGS}`);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  // r[verify hosting.frame.sandboxed]
  it("grants the frame clipboard writes and fullscreen", () => {
    expect(FRAME_ALLOW).toBe("clipboard-write; fullscreen");
  });
});
