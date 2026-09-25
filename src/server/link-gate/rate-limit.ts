// S32a — unlock attempts are limited to 10 per holder + client IP per 15 minutes.
// An in-process store: the app runs as one container. A multi-instance
// deployment needs a shared store (out of scope).

export const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
export const UNLOCK_MAX_ATTEMPTS = 10;
// How often expired keys are swept, and the most keys the store ever holds.
const PRUNE_INTERVAL_MS = UNLOCK_WINDOW_MS / 15;
const DEFAULT_MAX_KEYS = 50_000;

export class UnlockRateLimiter {
  // Insertion-ordered: a key is re-inserted on every attempt, so the first
  // entries are the least recently used.
  private readonly attempts = new Map<string, number[]>();
  private readonly maxKeys: number;
  private lastPrune = 0;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  get size(): number {
    return this.attempts.size;
  }

  // Records an attempt; false once the key has used up its window.
  attempt(holderId: string, ip: string, now: number): boolean {
    const key = `${holderId}\u0000${ip}`;
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < UNLOCK_WINDOW_MS);
    const allowed = recent.length < UNLOCK_MAX_ATTEMPTS;
    if (allowed) recent.push(now);
    this.attempts.delete(key);
    this.attempts.set(key, recent);
    this.bound(now);
    return allowed;
  }

  // Keep the store bounded without scanning it on every attempt: sweep expired
  // keys at most once per interval, and past the cap evict the least recently
  // used keys (an evicted key starts a fresh window — never a refusal).
  private bound(now: number): void {
    if (now - this.lastPrune >= PRUNE_INTERVAL_MS) {
      this.lastPrune = now;
      for (const [key, times] of this.attempts) {
        if (times.every((t) => now - t >= UNLOCK_WINDOW_MS)) this.attempts.delete(key);
      }
    }
    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= this.maxKeys) break;
      this.attempts.delete(key);
    }
  }
}

// The client behind Coolify's proxy: the **last** `X-Forwarded-For` hop — the
// address the proxy appends — when present, else the socket address. Earlier
// hops are whatever the client sent, so keying on them would let a client pick
// a fresh key per guess.
export function clientIp(forwardedFor: string | undefined, socketAddress: string | undefined): string {
  const last = forwardedFor?.split(",").pop()?.trim();
  if (last) return last;
  return socketAddress?.trim() || "unknown";
}
