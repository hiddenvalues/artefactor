import { describe, expect, it } from "vitest";
import { SHELL_TOKENS } from "./shell-theme";
import { renderUnlockPage } from "./unlock";

// S45 — App dark mode with a UI toggle: the unlock page (S32a) wears Ruby
// in light and dark, following the OS, and stays script-free.
describe("unlock page — theme (S45)", () => {
  const html = renderUnlockPage({ slug: "abc", error: "wrong" });

  // r[verify platform.theme.unlock-page]
  it("carries the dark tokens in a prefers-color-scheme: dark block", () => {
    const media = html.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
    expect(media).not.toBeNull();
    expect(media![1]).toContain(`--background: ${SHELL_TOKENS.dark.background};`);
    expect(media![1]).toContain(`--foreground: ${SHELL_TOKENS.dark.foreground};`);
  });

  it("carries the light tokens in :root", () => {
    expect(html).toMatch(new RegExp(`:root\\s*\\{[^}]*--background: ${SHELL_TOKENS.light.background.replace(/[()]/g, "\\$&")};`));
  });

  // r[verify platform.theme.unlock-page]
  it("still contains no script", () => {
    expect(html).not.toMatch(/<script/i);
  });

  it("carries no hex or rgb colour literal", () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
