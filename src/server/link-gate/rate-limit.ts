// S32a — unlock attempts are limited to 10 per holder + client IP per 15 minutes.
// An in-process store: the app runs as one container. A multi-instance
// deployment needs a shared store (out of scope).

export const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
export const UNLOCK_MAX_ATTEMPTS = 10;

export class UnlockRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  // Records an attempt; false once the key has used up its window.
  attempt(holderId: string, ip: string, now: number): boolean {
    const key = `${holderId}\u0000${ip}`;
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < UNLOCK_WINDOW_MS);
    if (recent.length >= UNLOCK_MAX_ATTEMPTS) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    this.prune(now);
    return true;
  }

  // Keep the store bounded: drop keys with no attempt left in the window.
  private prune(now: number): void {
    if (this.attempts.size < 10_000) return;
    for (const [key, times] of this.attempts) {
      if (times.every((t) => now - t >= UNLOCK_WINDOW_MS)) this.attempts.delete(key);
    }
  }
}

// The client behind Coolify's proxy: the first `X-Forwarded-For` hop when
// present, else the socket address.
export function clientIp(forwardedFor: string | undefined, socketAddress: string | undefined): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first) return first;
  return socketAddress?.trim() || "unknown";
}
