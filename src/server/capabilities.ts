import type { Capabilities } from "../shared/contracts";

// S33a — the capabilities a deployment advertises on `GET /api/config`,
// injected into `createApp` (the S22/S24 pattern). OSS sends no mail and
// registers no magic-link plugin, so it offers nothing beyond the S38 methods;
// a superset that registers the plugin injects `magicLinkSignIn: true`. S48's
// verified sign-up and password reset need mail too, so OSS offers neither, and
// nor S33b's share invitations.
// r[impl identity.capabilities.superset-only]
export const ossCapabilities: Capabilities = {
  magicLinkSignIn: false,
  verifiedSignUp: false,
  passwordReset: false,
  shareInvitations: false,
};
