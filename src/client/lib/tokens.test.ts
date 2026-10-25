import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHELL_TOKENS, type ShellMode } from "../../server/runtime/shell-theme";
import {
  MIN_NON_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  NON_TEXT_PAIRS,
  SHELL_TEXT_PAIRS,
  TEXT_PAIRS,
  textContrast,
  type ContrastRow,
} from "../../shared/contrast";
import { KIND_ORDER, KIND_PRESENTATION } from "../../shared/kind-presentation";
import { COLLECTION_HUE_COUNT, collectionColor } from "./format";

// S43 — the one tokens file carries the Ruby theme
// (docs/design/foundations/color.md) and the app-specific colours, in light
// (`:root`) and dark (`.dark`). S45 — the server-rendered host shell follows
// the viewer's theme too, so the kind colours in `shared/kind-presentation.ts`
// (light and dark) and the shell's chrome tokens in
// `server/runtime/shell-theme.ts` must not drift from these.
const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

/** The declarations of the top-level rule whose selector list starts with `selector`. */
const block = (selector: string) => {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}(\\s*,[^{]*)?\\s*\\{`, "m"));
  if (start < 0) throw new Error(`app.css has no ${selector} block`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};
const tokensOf = (selector: string) => {
  const body = block(selector);
  return (name: string) => body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
};
const light = tokensOf(":root");
const dark = tokensOf(".dark");

// Any colour value app.css writes: oklch(…), with or without alpha, or hex.
const COLOUR = /^(oklch\(\d*\.?\d+ \d*\.?\d+ \d*\.?\d+( \/ \d+%)?\)|#[0-9a-f]{3,6})$/;

/** The rows below `min`, each naming the pair, mode, surface and ratio. */
const failing = (rows: ContrastRow[], mode: string, min: number) =>
  rows
    .filter((row) => row.ratio < min)
    .map(({ fg, bg, over, ratio }) => `${mode} --${fg} on --${bg}${over ? ` over --${over}` : ""}: ${ratio.toFixed(2)}:1`);

/** Every row at least `MIN_TEXT_CONTRAST`. */
const expectReadable = (rows: ContrastRow[], mode: string) => expect(failing(rows, mode, MIN_TEXT_CONTRAST)).toEqual([]);

describe("app tokens (S43)", () => {
  it.each(KIND_ORDER)("defines the light %s kind colour and tint as the shared presentation has them", (kind) => {
    expect(light(`kind-${kind}`)).toBe(KIND_PRESENTATION[kind].color);
    expect(light(`kind-${kind}-tint`)).toBe(KIND_PRESENTATION[kind].tint);
  });

  it("takes the Ruby light kind colours", () => {
    expect(light("kind-prototype")).toBe("oklch(0.51 0.09 190)");
    expect(KIND_PRESENTATION.prototype.color).toBe("oklch(0.51 0.09 190)");
    expect(light("kind-slide-deck-tint")).toBe("oklch(0.52 0.12 298 / 12%)");
  });

  it.each(KIND_ORDER)("tints the light %s kind colour at 12%", (kind) => {
    const colour = light(`kind-${kind}`);
    expect(colour).toMatch(COLOUR);
    expect(light(`kind-${kind}-tint`)).toBe(colour!.replace(/\)$/, " / 12%)"));
  });

  // r[verify platform.theme.text-contrast]
  // Dark falls back to `:root` as the cascade does, so an inherited token is rated as drawn.
  it.each(["light", "dark"] as const)("draws every %s text pair at 4.5:1", (mode) => {
    expectReadable(textContrast(TEXT_PAIRS, mode === "light" ? light : (name) => dark(name) ?? light(name)), mode);
  });

  // r[verify platform.theme.non-text-contrast]
  it.each(["light", "dark"] as const)("draws every %s non-text pair at 3:1", (mode) => {
    const rows = textContrast(NON_TEXT_PAIRS, mode === "light" ? light : (name) => dark(name) ?? light(name));
    expect(rows.map(({ fg, bg }) => `${fg}/${bg}`)).toEqual(["primary-foreground/primary", "primary/background"]);
    expect(failing(rows, mode, MIN_NON_TEXT_CONTRAST)).toEqual([]);
  });

  // r[verify platform.theme.non-text-contrast]
  it("fails a primary drawn in the background's colour", () => {
    const doctored = (name: string) => light(name === "primary" ? "background" : name);
    expect(failing(textContrast(NON_TEXT_PAIRS, doctored), "light", MIN_NON_TEXT_CONTRAST)).toContain(
      "light --primary on --background: 1.00:1",
    );
  });

  // contrast.ts has no imports, so it spells the kinds out: they must stay KIND_ORDER.
  it("rates every kind's colour on its tint, and no other kind", () => {
    const kindPairs = TEXT_PAIRS.filter(({ fg }) => fg.startsWith("kind-"));
    expect(kindPairs).toEqual(KIND_ORDER.map((kind) => ({ fg: `kind-${kind}`, bg: `kind-${kind}-tint` })));
  });

  it.each(KIND_ORDER)("overrides the %s kind colour in dark, tinted at 16%", (kind) => {
    const colour = dark(`kind-${kind}`);
    expect(colour).toMatch(COLOUR);
    expect(dark(`kind-${kind}-tint`)).toBe(colour!.replace(/\)$/, " / 16%)"));
  });

  it("takes the Ruby dark kind colours", () => {
    expect(dark("kind-form")).toBe("oklch(0.78 0.07 228)");
  });

  it("defines every collection hue a collection can hash to, in light and dark", () => {
    for (let n = 1; n <= COLLECTION_HUE_COUNT; n++) {
      expect(light(`collection-${n}`)).toMatch(COLOUR);
      expect(dark(`collection-${n}`)).toMatch(COLOUR);
    }
    expect(light(`collection-${COLLECTION_HUE_COUNT + 1}`)).toBeNull();
    expect(dark(`collection-${COLLECTION_HUE_COUNT + 1}`)).toBeNull();
    expect(light("collection-1")).toBe("oklch(0.52 0.09 200)");
    expect(collectionColor("some-collection-id")).toMatch(/^var\(--collection-[1-6]\)$/);
  });

  it("carries the Ruby colours (spot-checks of the Ruby palette)", () => {
    expect(light("primary")).toBe("oklch(0.54 0.2 340)");
    expect(light("primary-foreground")).toBe("#fff");
    expect(light("background")).toBe("#fff");
    expect(dark("background")).toBe("oklch(0.17 0.004 340)");
    expect(dark("primary-foreground")).toBe("oklch(0.2 0.04 340)");
    expect(dark("destructive")).toBe("oklch(0.704 0.191 22.216)");
  });

  // r[verify platform.theme.shell-tokens-match-app]
  it.each(KIND_ORDER)("defines the dark %s kind colour and tint as the shared presentation has them (S45)", (kind) => {
    expect(dark(`kind-${kind}`)).toBe(KIND_PRESENTATION[kind].darkColor);
    expect(dark(`kind-${kind}-tint`)).toBe(KIND_PRESENTATION[kind].darkTint);
  });
});

// The shell writes white as `oklch(1 0 0)` so it carries no hex literal; app.css
// writes it `#fff`. The same colour either way.
const canon = (value: string) => (/^#f{3}(f{3})?$/i.test(value) ? "oklch(1 0 0)" : value);

describe("host shell tokens (S45)", () => {
  const CHROME = [
    "background", "foreground", "card", "muted", "muted-foreground", "border", "primary", "primary-foreground", "ring",
  ];
  const app: Record<ShellMode, (name: string) => string | null> = { light, dark };

  // r[verify platform.theme.shell-tokens-match-app]
  it.each(["light", "dark"] as const)("keeps every %s shell token named like an app.css token equal to it", (mode) => {
    const shared = Object.entries(SHELL_TOKENS[mode]).filter(([name]) => app[mode](name) !== null);
    expect(shared.map(([name]) => name)).toEqual(expect.arrayContaining(CHROME));
    for (const [name, value] of shared) expect(canon(value), `--${name}`).toBe(canon(app[mode](name)!));
  });

  // r[verify platform.theme.shell-tokens-match-app]
  it("gives light and dark the same token names", () => {
    expect(Object.keys(SHELL_TOKENS.dark).sort()).toEqual(Object.keys(SHELL_TOKENS.light).sort());
  });

  // The read-only badge and the conflict/expired banners set warning text on the warning background.
  // r[verify platform.theme.text-contrast]
  it.each(["light", "dark"] as const)("draws the %s shell text pairs at 4.5:1", (mode) => {
    const tokens: Record<string, string> = SHELL_TOKENS[mode];
    expectReadable(textContrast(SHELL_TEXT_PAIRS, (name) => tokens[name] ?? null), mode);
  });
});

// The trace doesn't read CSS, so the rule's one site is this reader of app.css's two switches:
// a design-system page sets `[data-theme="dark"]`, the app sets `.dark`, and both must flip the
// variant and the token block.
// r[impl platform.theme.dark-follows-data-theme]
const darkSwitches = () => ({
  variant: /^@custom-variant dark \(&:is\(([^)]*)\)\);/m.exec(css)?.[1]?.split(",").map((s) => s.trim()) ?? [],
  block: /^(\.dark\b[^{]*)\{/m.exec(css)?.[1]?.split(",").map((s) => s.trim()) ?? [],
});

describe("dark mode switches (S43)", () => {
  // r[verify platform.theme.dark-follows-data-theme]
  it("matches `.dark *` and `[data-theme=\"dark\"] *` in the dark variant", () => {
    expect(darkSwitches().variant).toEqual([".dark *", '[data-theme="dark"] *']);
  });

  // r[verify platform.theme.dark-follows-data-theme]
  it("declares the dark tokens under `.dark` and `[data-theme=\"dark\"]`", () => {
    expect(darkSwitches().block).toEqual([".dark", '[data-theme="dark"]']);
    expect(dark("background")).toBe("oklch(0.17 0.004 340)");
  });
});
