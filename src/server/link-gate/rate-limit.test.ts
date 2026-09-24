import { describe, expect, it } from "vitest";
import { UNLOCK_WINDOW_MS, UnlockRateLimiter, clientIp } from "./rate-limit";

// S32a — unlock attempts: 10 per holder + client IP per 15 minutes.

describe("UnlockRateLimiter (S32a)", () => {
  const T0 = 1_000_000;

  it("allows 10 attempts and refuses the 11th within the window", () => {
    const limiter = new UnlockRateLimiter();
    for (let i = 0; i < 10; i++) expect(limiter.attempt("a1", "1.2.3.4", T0 + i)).toBe(true);
    expect(limiter.attempt("a1", "1.2.3.4", T0 + 10)).toBe(false);
  });

  it("counts each holder and each client separately", () => {
    const limiter = new UnlockRateLimiter();
    for (let i = 0; i < 10; i++) limiter.attempt("a1", "1.2.3.4", T0);
    expect(limiter.attempt("a2", "1.2.3.4", T0)).toBe(true);
    expect(limiter.attempt("a1", "5.6.7.8", T0)).toBe(true);
  });

  it("opens again once the window has passed", () => {
    const limiter = new UnlockRateLimiter();
    for (let i = 0; i < 11; i++) limiter.attempt("a1", "ip", T0);
    expect(limiter.attempt("a1", "ip", T0 + UNLOCK_WINDOW_MS)).toBe(true);
    expect(UNLOCK_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe("clientIp (S32a)", () => {
  it("takes the first X-Forwarded-For hop", () => {
    expect(clientIp("203.0.113.9, 10.0.0.1", "10.0.0.2")).toBe("203.0.113.9");
  });

  it("falls back to the socket address, then to a fixed key", () => {
    expect(clientIp(undefined, "10.0.0.2")).toBe("10.0.0.2");
    expect(clientIp(" ", undefined)).toBe("unknown");
  });
});
