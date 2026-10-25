import { createHmac, timingSafeEqual } from "node:crypto";

// S36 (data.frame-token.signed-claims) — the frame token. A sandboxed frame has an opaque origin and
// never reads cookies, so the shell hands it a short-lived, stateless token in
// the frame URL (`?t=`) naming the context to seed. The frame route re-runs its
// access check for the token's viewer at every redeem, so the token carries
// identity, never a grant.
//
// Format: `base64url(JSON claims) "." base64url(HMAC-SHA256)`, keyed by a key
// derived from `BETTER_AUTH_SECRET` under its own label — never the session key.

export const FRAME_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface FrameTokenClaims {
  artefactId: string;
  // Which frame route the token opens: `slug` (`/a/:slug/frame`) or `raw`
  // (the owner preview, `/api/artefacts/:id/raw/frame`).
  route: "slug" | "raw";
  // The signed-in viewer the shell was rendered for; null for an anonymous
  // viewer who unlocked a password-gated link (S32a) — every other anonymous
  // viewer loads a token-less frame.
  viewerId: string | null;
  // Another author whose data is seeded read-only; null = the viewer's own.
  authorId: string | null;
  // A `raw` token's tenant scope — the owner-preview read is tenant-scoped, and
  // the frame has no session to resolve the scope from.
  tenantId?: string;
  // S32a (hosting.link-gate.narrows-public-audience) — the link-gate version the viewer's pass
  // proved when the token was minted. The redeem re-runs the gate with it, so a password change
  // voids the frame too. Absent = no pass.
  gate?: number;
  // S32b — the holder whose pass proved `gate`: the artefact, or its tree root
  // when contained. The redeem counts `gate` only for this holder, so a token
  // minted under one gate never satisfies another at the same version. Absent
  // (a pre-S32b token) = the artefact itself.
  gateHolder?: string;
  // Expiry, epoch milliseconds.
  exp: number;
}

export type FrameTokenVerdict =
  | { status: "valid"; claims: FrameTokenClaims }
  | { status: "expired"; claims: FrameTokenClaims }
  | { status: "invalid" };

const KEY_LABEL = "artefactor/frame-token/v1";
const CHANNEL_LABEL = "artefactor/frame-channel/v1";

function derivedKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", derivedKey(secret)).update(payload).digest();
}

// r[impl data.frame-token.signed-claims]
export function signFrameToken(claims: FrameTokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

// S36 (data.shell.channel-binds-document) — the frame's message channel: a value derived from its token, given
// to that document only (inlined in its shim config) and to the shell (with the
// frame URL that minted it). The shell accepts `artefactor:data-changed` only
// when it carries the channel of the frame URL it loaded.
//
// `event.source === frame.contentWindow` identifies the browsing context, not the
// document in it: a sandboxed frame may navigate itself, and a page it navigated
// to keeps the same `WindowProxy`. That page never learns the channel — frame
// responses are `Referrer-Policy: no-referrer`, so the frame URL (and its token)
// don't travel with the navigation.
// r[impl data.shell.channel-binds-document]
export function frameChannel(token: string, secret: string): string {
  return createHmac("sha256", createHmac("sha256", secret).update(CHANNEL_LABEL).digest())
    .update(token)
    .digest("base64url");
}

// r[impl hosting.frame.token-signed]
export function verifyFrameToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): FrameTokenVerdict {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { status: "invalid" };
  const [payload, sig] = parts as [string, string];
  // Compare the canonical encoding, not decoded bytes: base64url decoding
  // ignores a final character's unused bits, so only the issued string counts.
  const expected = Buffer.from(mac(payload, secret).toString("base64url"));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { status: "invalid" };
  }
  const claims = parseClaims(payload);
  if (!claims) return { status: "invalid" };
  return claims.exp <= now
    ? { status: "expired", claims }
    : { status: "valid", claims };
}

function parseClaims(payload: string): FrameTokenClaims | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  if (
    typeof c.artefactId !== "string" ||
    (c.route !== "slug" && c.route !== "raw") ||
    !nullableString(c.viewerId) ||
    !nullableString(c.authorId) ||
    (c.tenantId !== undefined && typeof c.tenantId !== "string") ||
    (c.gate !== undefined && typeof c.gate !== "number") ||
    (c.gateHolder !== undefined && typeof c.gateHolder !== "string") ||
    typeof c.exp !== "number"
  ) {
    return null;
  }
  return c as unknown as FrameTokenClaims;
}
