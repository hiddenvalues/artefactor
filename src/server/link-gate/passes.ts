import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { LinkPass } from "../../domain/artefact/link-gate";
import type { AuthEnv } from "../middleware/auth";
import type { LinkGateChallengeResponse } from "../../shared/contracts";
import { passCookieName, passExpiry, signPass, verifyPass } from "./pass";

// S32a — the link passes a request carries, looked up by the gate's holder id
// (the artefact). Lazy: only the holder a read resolves is ever verified.
export type PassLookup = (holderId: string) => LinkPass | null;

export const NO_PASSES: PassLookup = () => null;

export interface PassKeys {
  secret: string;
  now: () => number;
}

// Attach the request's pass lookup; runs beside the session middleware on the
// `/api` and `/a` routers. Frames never read cookies (AH28): a frame token
// carries the version its pass proved instead.
export function createAttachLinkPasses(keys: PassKeys) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    c.set("linkPasses", (holderId) => {
      const raw = getCookie(c, passCookieName(holderId));
      return raw ? verifyPass(raw, holderId, keys.secret, keys.now()) : null;
    });
    await next();
  });
}

export function linkPassesOf(c: Context<AuthEnv>): PassLookup {
  return c.get("linkPasses") ?? NO_PASSES;
}

// The API's answer to a `LinkGateChallenge` (AH22): the viewer is admitted but
// must unlock the link first.
export function linkGateChallenged(c: Context) {
  return c.json<LinkGateChallengeResponse>({ gate: "password" }, 403);
}

// Issue a pass for `holderId` at the gate's current version: httpOnly,
// SameSite=Lax, path `/` (the API reads it too), `Secure` over https, and never
// beyond the gate's expiry.
export function issuePass(
  c: Context,
  keys: PassKeys & { secure: boolean },
  holderId: string,
  gate: { version: number; expiresAt: Date | null },
): void {
  const exp = passExpiry(keys.now(), gate.expiresAt);
  setCookie(c, passCookieName(holderId), signPass({ holderId, version: gate.version, exp }, keys.secret), {
    httpOnly: true,
    secure: keys.secure,
    sameSite: "Lax",
    path: "/",
    expires: new Date(exp),
  });
}
