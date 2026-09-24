import { createHmac, timingSafeEqual } from "node:crypto";
import type { LinkPass } from "../../domain/artefact/link-gate";

// S32a (AH22) — the link pass. A correct password yields an httpOnly cookie,
// named for the gate's holder, carrying `{ holderId, version, exp }` signed with
// a key derived from `BETTER_AUTH_SECRET` under its own label (never the session
// or frame-token key). The gate counts it only at its current `version`, so a
// password change or clear voids every pass already issued.
//
// Format: `base64url(JSON claims) "." base64url(HMAC-SHA256)`.

export const PASS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PassClaims {
  holderId: string;
  version: number;
  // Expiry, epoch milliseconds.
  exp: number;
}

const KEY_LABEL = "artefactor/link-pass/v1";

function mac(payload: string, secret: string): string {
  const key = createHmac("sha256", secret).update(KEY_LABEL).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signPass(claims: PassClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

// The pass for `holderId`, or null when it is forged, for another holder,
// malformed or expired.
export function verifyPass(
  token: string,
  holderId: string,
  secret: string,
  now: number,
): LinkPass | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts as [string, string];
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (
    c.holderId !== holderId ||
    typeof c.version !== "number" ||
    typeof c.exp !== "number" ||
    c.exp <= now
  ) {
    return null;
  }
  return { version: c.version };
}

// One cookie per holder, so passes for several artefacts coexist.
export function passCookieName(holderId: string): string {
  return `ae_pass_${holderId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

// A pass lasts 7 days and never outlives the gate's expiry (AH23).
export function passExpiry(now: number, expiresAt: Date | null): number {
  const ttl = now + PASS_TTL_MS;
  return expiresAt === null ? ttl : Math.min(ttl, expiresAt.getTime());
}
