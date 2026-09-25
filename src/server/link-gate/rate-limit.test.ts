import { describe, expect, it } from "vitest";
import { UNLOCK_WINDOW_MS, UnlockRateLimiter } from "./rate-limit";

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

describe("UnlockRateLimiter bounds (S32a)", () => {
  it("never holds more than its key cap, evicting the oldest keys", () => {
    const limiter = new UnlockRateLimiter({ maxKeys: 3 });
    for (const ip of ["a", "b", "c", "d", "e"]) limiter.attempt("h", ip, 1);
    expect(limiter.size).toBe(3);
    // The newest keys keep their counts; the evicted ones start over.
    for (let i = 0; i < 9; i++) limiter.attempt("h", "e", 2);
    expect(limiter.attempt("h", "e", 3)).toBe(false);
    expect(limiter.attempt("h", "a", 3)).toBe(true);
  });

  it("drops keys whose window has passed", () => {
    const limiter = new UnlockRateLimiter({ maxKeys: 2 });
    limiter.attempt("h", "a", 0);
    limiter.attempt("h", "b", UNLOCK_WINDOW_MS + 1);
    limiter.attempt("h", "c", UNLOCK_WINDOW_MS + 2);
    expect(limiter.size).toBe(2);
  });
});
