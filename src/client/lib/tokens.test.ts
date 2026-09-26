import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHELL_TOKENS, type ShellMode } from "../../server/runtime/shell-theme";
import { KIND_ORDER, KIND_PRESENTATION } from "../../shared/kind-presentation";
import { COLLECTION_HUE_COUNT, collectionColor } from "./format";

// S43 — the one tokens file carries the Mint garden theme
// (docs/design/theme/mint-garden.md) and the app-specific colours, in light
// (`:root`) and dark (`.dark`). S45 — the server-rendered host shell follows
// the viewer's theme too, so the kind colours in `shared/kind-presentation.ts`
// (light and dark) and the shell's chrome tokens in
// `server/runtime/shell-theme.ts` must not drift from these.
const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

/** The declarations of the top-level rule whose selector is exactly `selector`. */
const block = (selector: string) => {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
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

type Rgb = [number, number, number];

function parseOklch(value: string) {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ (\d+)%)?\)$/.exec(value);
  if (!m) throw new Error(`not an oklch colour: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), alpha: m[4] ? Number(m[4]) / 100 : 1 };
}

/** OKLCH → gamma-encoded sRGB (Björn Ottosson's OKLab matrices). */
function oklchToSrgb({ l, c, h }: { l: number; c: number; h: number }): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return linear.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055)) as Rgb;
}

/** WCAG 2 contrast ratio of two gamma-encoded sRGB colours. */
function contrast(x: Rgb, y: Rgb): number {
  const lum = (rgb: Rgb) => {
    const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("app tokens (S43)", () => {
  it.each(KIND_ORDER)("defines the light %s kind colour and tint as the shared presentation has them", (kind) => {
    expect(light(`kind-${kind}`)).toBe(KIND_PRESENTATION[kind].color);
    expect(light(`kind-${kind}-tint`)).toBe(KIND_PRESENTATION[kind].tint);
  });

  it("takes the Mint garden light kind colours, tinted at 12% (slide deck 13%)", () => {
    expect(light("kind-prototype")).toBe("oklch(0.51 0.09 170)");
    expect(KIND_PRESENTATION.prototype.color).toBe("oklch(0.51 0.09 170)");
    expect(light("kind-prototype-tint")).toBe("oklch(0.51 0.09 170 / 12%)");
    expect(light("kind-slide-deck-tint")).toBe("oklch(0.53 0.13 55 / 13%)");
  });

  // The app draws kind colour as text (the card's kind badge, the specimen's
  // chip), so each light kind colour reads at 4.5:1 on its own tint over white.
  it.each(KIND_ORDER)("draws the light %s kind colour as text at 4.5:1 on its tint", (kind) => {
    const colour = parseOklch(light(`kind-${kind}`)!);
    const tint = parseOklch(light(`kind-${kind}-tint`)!);
    const fg = oklchToSrgb(colour);
    const bg = fg.map((c) => tint.alpha * c + (1 - tint.alpha)) as Rgb;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KIND_ORDER)("overrides the %s kind colour in dark, tinted at 16%", (kind) => {
    const colour = dark(`kind-${kind}`);
    expect(colour).toMatch(COLOUR);
    expect(dark(`kind-${kind}-tint`)).toBe(colour!.replace(/\)$/, " / 16%)"));
  });

  it("takes the Mint garden dark kind colours", () => {
    expect(dark("kind-form")).toBe("oklch(0.78 0.08 240)");
  });

  it("defines every collection hue a collection can hash to, in light and dark", () => {
    for (let n = 1; n <= COLLECTION_HUE_COUNT; n++) {
      expect(light(`collection-${n}`)).toMatch(COLOUR);
      expect(dark(`collection-${n}`)).toMatch(COLOUR);
    }
    expect(light(`collection-${COLLECTION_HUE_COUNT + 1}`)).toBeNull();
    expect(dark(`collection-${COLLECTION_HUE_COUNT + 1}`)).toBeNull();
    expect(light("collection-1")).toBe("oklch(0.58 0.09 170)");
    expect(collectionColor("some-collection-id")).toMatch(/^var\(--collection-[1-6]\)$/);
  });

  it("carries the Mint garden colours (spot-checks of docs/design/theme/mint-garden.md)", () => {
    expect(light("primary")).toBe("oklch(0.85 0.05 170)");
    expect(light("background")).toBe("#fff");
    expect(dark("background")).toBe("oklch(0.11 0.02 150)");
    expect(dark("destructive")).toBe("oklch(0.704 0.191 22.216)");
  });

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

  it.each(["light", "dark"] as const)("keeps every %s shell token named like an app.css token equal to it", (mode) => {
    const shared = Object.entries(SHELL_TOKENS[mode]).filter(([name]) => app[mode](name) !== null);
    expect(shared.map(([name]) => name)).toEqual(expect.arrayContaining(CHROME));
    for (const [name, value] of shared) expect(canon(value), `--${name}`).toBe(canon(app[mode](name)!));
  });

  it("gives light and dark the same token names", () => {
    expect(Object.keys(SHELL_TOKENS.dark).sort()).toEqual(Object.keys(SHELL_TOKENS.light).sort());
  });

  // The read-only badge and the conflict/expired banners set warning text on the warning background.
  it.each(["light", "dark"] as const)("draws the %s warning text at 4.5:1 on the warning background", (mode) => {
    const fg = oklchToSrgb(parseOklch(SHELL_TOKENS[mode]["warn-fg"]));
    const bg = oklchToSrgb(parseOklch(SHELL_TOKENS[mode]["warn-bg"]));
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
