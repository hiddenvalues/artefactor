// S36 (AH28) — the sandbox a served artefact runs under.
//
// The host shell's iframe carries these flags as its `sandbox` attribute, and
// every frame response carries them again as `Content-Security-Policy: sandbox`,
// so a frame URL opened top-level (or in a popup that escaped the sandbox) is
// still an opaque origin. Never `allow-same-origin` (the artefact would regain
// the app origin and its session) and never `allow-top-navigation*`. No other
// CSP directive: CDN libraries and external APIs keep working.
export const FRAME_SANDBOX_FLAGS =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

// The iframe's permissions policy: what typical artefacts (copy buttons, decks)
// need beyond the sandbox flags.
export const FRAME_ALLOW = "clipboard-write; fullscreen";

// The headers every frame response carries, whatever its status.
export function frameSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": `sandbox ${FRAME_SANDBOX_FLAGS}`,
    "Referrer-Policy": "no-referrer",
  };
}
