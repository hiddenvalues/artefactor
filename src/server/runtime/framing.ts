import {
  FRAME_TOKEN_TTL_MS,
  frameChannel,
  signFrameToken,
  type FrameTokenClaims,
} from "./frame-token";

// S36 (AH28, AD10, IA6) — where frames live and who may talk to the API.
//
// `appOrigin` is the canonical app origin (`BETTER_AUTH_URL`). `trustedAppOrigins`
// adds `AUTH_TRUSTED_ORIGINS` (e.g. the Vite dev server) — the origins a
// cookie-authenticated state change may come from (IA6) — and never includes the
// content origin. `contentOrigin`, when set, is the separate registrable domain
// frames are served on; unset, frames live on the app host.
export interface Framing {
  secret: string;
  appOrigin: string;
  trustedAppOrigins: string[];
  contentOrigin: string | null;
  now: () => number;
}

export interface FramingEnv {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_TRUSTED_ORIGINS: string[];
  ARTEFACTOR_CONTENT_ORIGIN?: string;
}

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function framingFromEnv(env: FramingEnv): Framing {
  const appOrigin = originOf(env.BETTER_AUTH_URL) ?? env.BETTER_AUTH_URL;
  const contentOrigin = env.ARTEFACTOR_CONTENT_ORIGIN
    ? originOf(env.ARTEFACTOR_CONTENT_ORIGIN)
    : null;
  const trusted = new Set<string>([appOrigin]);
  for (const o of env.AUTH_TRUSTED_ORIGINS) {
    const origin = originOf(o);
    if (origin) trusted.add(origin);
  }
  if (contentOrigin) trusted.delete(contentOrigin);
  return {
    secret: env.BETTER_AUTH_SECRET,
    appOrigin,
    trustedAppOrigins: [...trusted],
    contentOrigin,
    now: () => Date.now(),
  };
}

// The frame route path for an artefact, before any token.
export function framePath(route: "slug" | "raw", ref: string): string {
  return route === "slug"
    ? `/a/${encodeURIComponent(ref)}/frame`
    : `/api/artefacts/${encodeURIComponent(ref)}/raw/frame`;
}

// A token-less frame URL (an anonymous, read-only frame): on the content origin
// when there is one (absolute), else on the app host (relative).
export function frameUrl(framing: Framing, route: "slug" | "raw", ref: string): string {
  return `${framing.contentOrigin ?? ""}${framePath(route, ref)}`;
}

// S36 — a freshly tokened frame URL and the message channel of the document it
// will load: what the shell needs to load a frame and to accept its changes.
export interface MintedFrame {
  frameUrl: string;
  channel: string;
}

export function mintFrame(
  framing: Framing,
  route: "slug" | "raw",
  ref: string,
  claims: Omit<FrameTokenClaims, "exp" | "route">,
): MintedFrame {
  const token = signFrameToken(
    { ...claims, route, exp: framing.now() + FRAME_TOKEN_TTL_MS },
    framing.secret,
  );
  return {
    frameUrl: `${frameUrl(framing, route, ref)}?t=${token}`,
    channel: frameChannel(token, framing.secret),
  };
}

// The origin a frame's shim posts its changes to: the shell's. With a content
// origin that is always the canonical app origin. On the app host the frame was
// requested from the shell's own host, so a request origin that is a trusted app
// origin (e.g. the Vite dev server) is the shell's; anything else — including a
// TLS-terminating proxy's plain-http view of the canonical host — falls back to
// the canonical app origin.
export function frameTargetOrigin(framing: Framing, requestUrl: string): string {
  if (framing.contentOrigin) return framing.appOrigin;
  const origin = originOf(requestUrl);
  return origin && framing.trustedAppOrigins.includes(origin) ? origin : framing.appOrigin;
}
