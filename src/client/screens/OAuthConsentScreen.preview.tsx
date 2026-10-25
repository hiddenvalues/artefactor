import { consentRequest, noop, viewer } from "../design/fixtures";
import { definePreview } from "../design/preview";
import { PageFrame } from "../design/ScreenFrame";
import { type ConsentState, OAuthConsentView } from "./OAuthConsentScreen";

// S70 — the MCP connector's consent screen, which the app shows outside the
// signed-in frame (docs/design/templates/auth-flow.md *Consent*). S71 — the
// catalog carries no signed authorize request, so the preview renders the
// screen's view from each state rather than the screen itself.
const consent = (state: ConsentState) => (
  <PageFrame>
    <OAuthConsentView state={state} email={viewer.email} busy={false} onAllow={noop} onDeny={noop} />
  </PageFrame>
);

export default definePreview({
  title: "OAuth consent",
  variants: [
    { name: "Ready", render: () => consent({ kind: "ready", ...consentRequest }) },
    { name: "Loading", render: () => consent({ kind: "loading" }) },
    { name: "Request expired", render: () => consent({ kind: "expired" }) },
  ],
});
