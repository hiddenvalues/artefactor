import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ConsentState, OAuthConsentView } from "./OAuthConsentScreen";

// S71 — the consent screen renders from its state alone, so each state can be
// checked (and previewed) without a signed authorize request in the address.
const noop = () => {};
const view = (state: ConsentState, busy = false) =>
  renderToStaticMarkup(createElement(OAuthConsentView, { state, email: "ada@example.com", busy, onAllow: noop, onDeny: noop }));
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([tag, label]) => ({ label, disabled: / disabled=""/.test(tag) }));

describe("OAuthConsentView", () => {
  const ready: ConsentState = { kind: "ready", clientName: "Claude", returnHost: "claude.ai" };

  // r[verify platform.design.consent-preview-states]
  it("names the client, the account and the return host when ready, Allow before Deny", () => {
    const html = view(ready);
    expect(html).toContain("Connect Claude to Artefactor?");
    expect(html).toContain('<span class="font-medium text-foreground">ada@example.com</span>');
    expect(html).toContain('<span class="font-medium text-foreground">claude.ai</span>');
    expect(html).toContain(
      "It will be able to create, read, update, share and archive your artefacts, and read and write their saved data, as you.",
    );
    expect(buttons(html)).toEqual([
      { label: "Allow", disabled: false },
      { label: "Deny", disabled: false },
    ]);
  });

  // r[verify platform.design.consent-preview-states]
  it("disables Allow and Deny while an answer posts", () => {
    expect(buttons(view(ready, true))).toEqual([
      { label: "Allow", disabled: true },
      { label: "Deny", disabled: true },
    ]);
  });

  // r[verify platform.design.consent-preview-states]
  it("shows Loading… and no button while the provider checks the request", () => {
    const html = view({ kind: "loading" });
    expect(html).toContain("Loading…");
    expect(html).not.toContain("<button");
  });

  // r[verify platform.design.consent-preview-states]
  it("offers Go to Home and no Allow once the request has expired", () => {
    const html = view({ kind: "expired" });
    expect(html).toContain("This connection request has expired.");
    expect(buttons(html).map((b) => b.label)).toEqual(["Go to Home"]);
    expect(html).not.toContain("Allow");
  });
});
