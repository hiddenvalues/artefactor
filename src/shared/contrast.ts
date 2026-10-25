// S43 — React client on stock shadcn/ui: text contrast of the theme tokens.
//
// The one definition of which token pairs the app draws as text on a
// background and of the WCAG 2 maths that rates them
// (r[platform.theme.text-contrast], docs/specs/fdd/slices/platform.md).
// src/client/lib/tokens.test.ts checks app.css and the host shell's tokens
// against it, and the design hand-back runs it before a theme leaves design.
// No imports, so it runs anywhere — pasted into a prototype's JS too, once
// its TypeScript types are stripped.

export type Rgb = [number, number, number];

/** A gamma-encoded sRGB colour (channels 0–1) and its alpha. */
export interface Colour {
  rgb: Rgb;
  alpha: number;
}

export interface TokenPair {
  fg: string;
  bg: string;
}

export interface ContrastRow extends TokenPair {
  /** The surface a translucent `bg` was composited over; unset when `bg` is opaque. */
  over?: string;
  ratio: number;
}

export const MIN_TEXT_CONTRAST = 4.5;

/** WCAG 1.4.11: a shape the reader must make out against what it sits on. */
export const MIN_NON_TEXT_CONTRAST = 3;

const KINDS = ["prototype", "slide-deck", "form", "interactive-doc", "other"];

// The app.css pairs. The trace doesn't read CSS, so this list is where the
// rule is decided: a pair missing here is never checked.
// r[impl platform.theme.text-contrast]
export const TEXT_PAIRS: TokenPair[] = [
  { fg: "foreground", bg: "background" },
  { fg: "card-foreground", bg: "card" },
  { fg: "popover-foreground", bg: "popover" },
  { fg: "primary-foreground", bg: "primary" },
  { fg: "secondary-foreground", bg: "secondary" },
  { fg: "accent-foreground", bg: "accent" },
  { fg: "muted-foreground", bg: "background" },
  { fg: "muted-foreground", bg: "card" },
  { fg: "muted-foreground", bg: "popover" },
  { fg: "muted-foreground", bg: "muted" },
  { fg: "destructive", bg: "background" },
  { fg: "destructive", bg: "card" },
  { fg: "destructive", bg: "popover" },
  { fg: "sidebar-foreground", bg: "sidebar" },
  { fg: "sidebar-primary-foreground", bg: "sidebar-primary" },
  { fg: "sidebar-accent-foreground", bg: "sidebar-accent" },
  ...KINDS.map((kind) => ({ fg: `kind-${kind}`, bg: `kind-${kind}-tint` })),
];

// The pairs app.css draws as shapes, not text: the logo's mark on its tile and
// the tile on the page. `textContrast` rates them; the minimum is
// `MIN_NON_TEXT_CONTRAST`.
// r[impl platform.theme.non-text-contrast]
export const NON_TEXT_PAIRS: TokenPair[] = [
  { fg: "primary-foreground", bg: "primary" },
  { fg: "primary", bg: "background" },
];

/** The host shell's own pair (src/server/runtime/shell-theme.ts). */
export const SHELL_TEXT_PAIRS: TokenPair[] = [{ fg: "warn-fg", bg: "warn-bg" }];

/** The surfaces a translucent background is composited over, each in turn. */
export const COMPOSITE_SURFACES = ["background", "card"];

/** `oklch(L C H)` (L 0–1), `oklch(L C H / N%)` (N 0–100), `#rgb` or `#rrggbb`; anything else throws. */
export function parseColour(value: string): Colour {
  const n = "(\\d*\\.?\\d+)";
  const oklch = new RegExp(`^oklch\\(${n} ${n} ${n}(?: \\/ ${n}%)?\\)$`).exec(value.trim());
  if (oklch) {
    const l = Number(oklch[1]);
    const alpha = oklch[4] === undefined ? 1 : Number(oklch[4]) / 100;
    if (l <= 1 && alpha <= 1) return { rgb: toSrgb(l, Number(oklch[2]), Number(oklch[3])), alpha };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d) : hex[1]!.match(/../g)!;
    return { rgb: digits.map((d) => parseInt(d, 16) / 255) as Rgb, alpha: 1 };
  }
  throw new Error(`not a colour contrast.ts can read: ${value}`);
}

/** OKLCH → gamma-encoded sRGB (Björn Ottosson's OKLab matrices), clamped to gamut. */
export function toSrgb(l: number, c: number, h: number): Rgb {
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
  return linear.map((v) => {
    const x = Math.min(Math.max(v, 0), 1);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

/** `fg` at `alpha` over the opaque `bg`, as an opaque colour. */
export function composite(fg: Colour, alpha: number, bg: Colour): Colour {
  return { rgb: fg.rgb.map((v, i) => alpha * v + (1 - alpha) * bg.rgb[i]!) as Rgb, alpha: 1 };
}

/** WCAG 2 contrast ratio of two opaque colours, 1–21. */
export function contrastRatio(x: Colour, y: Colour): number {
  const lum = ({ rgb }: Colour) => {
    const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rates each pair, text or non-text, a translucent background once per `COMPOSITE_SURFACES` entry. */
export function textContrast(pairs: TokenPair[], token: (name: string) => string | null): ContrastRow[] {
  const colour = (name: string) => {
    const value = token(name);
    if (value === null) throw new Error(`no --${name} token`);
    return parseColour(value);
  };
  return pairs.flatMap(({ fg, bg }) => {
    const text = colour(fg);
    const back = colour(bg);
    const rate = (surface: Colour) => contrastRatio(composite(text, text.alpha, surface), surface);
    if (back.alpha === 1) return [{ fg, bg, ratio: rate(back) }];
    return COMPOSITE_SURFACES.map((over) => {
      const surface = colour(over);
      if (surface.alpha !== 1) throw new Error(`--${over} is translucent, so --${bg} can't be composited over it`);
      return { fg, bg, over, ratio: rate(composite(back, back.alpha, surface)) };
    });
  });
}
