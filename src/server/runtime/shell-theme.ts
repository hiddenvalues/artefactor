// S45 — App dark mode with a UI toggle: the server-rendered chrome's tokens.
//
// The host shell (`/a/:slug`) and the unlock page are not the React SPA, so
// they can't read src/client/app.css; they carry the Mint garden values they
// need here, in light and dark. Every token named like an app.css token equals
// it (src/client/lib/tokens.test.ts); `oklch(1 0 0)` is app.css's `#fff`, so
// the chrome carries no hex literal. The `warn-*` tokens are shell-local (the
// read-only badge, the conflict and link-expired banners): an amber pair per
// mode at 4.5:1, until a design hand-back promotes them to the theme.
//
// Only the host chrome wears these: nothing is ever injected into an
// artefact's frame (S36), which renders exactly as authored.

export type ShellMode = "light" | "dark";
export type ShellToken =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "muted-foreground"
  | "border"
  | "primary"
  | "primary-foreground"
  | "ring"
  | "destructive"
  | "warn-bg"
  | "warn-fg"
  | "warn-border"
  | "shadow"
  | "shadow-pop";

export const SHELL_TOKENS: Record<ShellMode, Record<ShellToken, string>> = {
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    muted: "oklch(0.97 0 0)",
    "muted-foreground": "oklch(0.556 0 0)",
    border: "oklch(0.922 0 0)",
    primary: "oklch(0.85 0.05 170)",
    "primary-foreground": "oklch(0.26 0.05 150)",
    ring: "oklch(0.62 0.1 170)",
    destructive: "oklch(0.577 0.245 27.3)",
    "warn-bg": "oklch(0.97 0.07 95)",
    "warn-fg": "oklch(0.45 0.1 70)",
    "warn-border": "oklch(0.82 0.13 85)",
    shadow: "0 1px 2px oklch(0.2 0 0 / 5%)",
    "shadow-pop": "0 8px 24px oklch(0.2 0 0 / 12%)",
  },
  dark: {
    background: "oklch(0.11 0.02 150)",
    foreground: "oklch(0.97 0.02 90)",
    card: "oklch(0.155 0.025 150)",
    muted: "oklch(0.21 0.025 150)",
    "muted-foreground": "oklch(0.78 0.03 150)",
    border: "oklch(1 0 0 / 9%)",
    primary: "oklch(0.85 0.05 170)",
    "primary-foreground": "oklch(0.26 0.05 150)",
    ring: "oklch(0.85 0.05 170)",
    destructive: "oklch(0.704 0.191 22.216)",
    "warn-bg": "oklch(0.27 0.05 80)",
    "warn-fg": "oklch(0.88 0.11 88)",
    "warn-border": "oklch(0.5 0.09 80)",
    shadow: "0 1px 2px oklch(0 0 0 / 30%)",
    "shadow-pop": "0 8px 24px oklch(0 0 0 / 50%)",
  },
};

export type ExtraTokens = Partial<Record<ShellMode, Record<string, string>>>;

const declarations = (mode: ShellMode, extra: ExtraTokens) =>
  Object.entries({ ...SHELL_TOKENS[mode], ...extra[mode] })
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");

/**
 * The tokens as CSS. `class` (the host shell): `:root` light and `.dark` dark,
 * the class src/shared/theme-boot.ts sets from the viewer's stored choice.
 * `media` (the script-free unlock page): `:root` light and dark under
 * `prefers-color-scheme`. `extra` adds page-specific tokens per mode.
 */
export function shellThemeCss(form: "class" | "media", extra: ExtraTokens = {}): string {
  const light = `:root { color-scheme: light; ${declarations("light", extra)} }`;
  const dark = `color-scheme: dark; ${declarations("dark", extra)}`;
  return form === "class"
    ? `${light}\n  .dark { ${dark} }`
    : `${light}\n  @media (prefers-color-scheme: dark) { :root { ${dark} } }`;
}
