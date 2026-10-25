import { describe, expect, it } from "vitest";
import { composite, contrastRatio, parseColour, textContrast } from "./contrast";

describe("contrast maths", () => {
  it("rates white on black 21:1 and black on black 1:1", () => {
    expect(contrastRatio(parseColour("#fff"), parseColour("oklch(0 0 0)"))).toBeCloseTo(21, 2);
    expect(contrastRatio(parseColour("oklch(0 0 0)"), parseColour("oklch(0 0 0)"))).toBe(1);
  });

  it("parses oklch with alpha, and short and long hex alike", () => {
    expect(parseColour("oklch(0.51 0.09 170 / 12%)").alpha).toBe(0.12);
    expect(parseColour("oklch(0.51 0.09 170)").alpha).toBe(1);
    expect(parseColour("#ffffff")).toEqual(parseColour("#fff"));
  });

  it("throws on any other colour syntax, naming the value", () => {
    expect(() => parseColour("hsl(0 0% 0%)")).toThrow("hsl(0 0% 0%)");
  });

  it("throws on a malformed number or an out-of-range lightness or alpha, naming the value", () => {
    for (const value of ["oklch(. 0 0)", "oklch(0.5.1 0.1 340)", "oklch(1.2 0 0)", "oklch(0.5 0 0 / 150%)"]) {
      expect(() => parseColour(value)).toThrow(value);
    }
  });

  it("composites at alpha 0 to the background and at alpha 1 to the colour itself", () => {
    const colour = parseColour("oklch(0.51 0.09 190)");
    const white = parseColour("#fff");
    expect(composite(colour, 0, white)).toEqual(white);
    expect(composite(colour, 1, white)).toEqual({ ...colour, alpha: 1 });
  });
});

describe("textContrast", () => {
  const lookup = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? null;

  it("rates a pair from the lookup's values", () => {
    const rows = textContrast(
      [{ fg: "muted-foreground", bg: "muted" }],
      lookup({ "muted-foreground": "oklch(0.556 0 0)", muted: "oklch(0.97 0 0)" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fg: "muted-foreground", bg: "muted" });
    expect(rows[0]!.over).toBeUndefined();
    expect(rows[0]!.ratio.toFixed(2)).toBe("4.34");
  });

  it("rates a translucent background once over each surface", () => {
    const rows = textContrast(
      [{ fg: "kind-form", bg: "kind-form-tint" }],
      lookup({
        "kind-form": "oklch(0.52 0.09 228)",
        "kind-form-tint": "oklch(0.52 0.09 228 / 12%)",
        background: "#fff",
        card: "oklch(0.3 0 0)",
      }),
    );
    expect(rows.map((row) => row.over)).toEqual(["background", "card"]);
    expect(rows[0]!.ratio).not.toBeCloseTo(rows[1]!.ratio, 2);
  });

  it("throws on a translucent surface, naming it", () => {
    const tokens = { "kind-form": "oklch(0.52 0.09 228)", "kind-form-tint": "oklch(0.52 0.09 228 / 12%)" };
    expect(() =>
      textContrast(
        [{ fg: "kind-form", bg: "kind-form-tint" }],
        lookup({ ...tokens, background: "#fff", card: "oklch(1 0 0 / 50%)" }),
      ),
    ).toThrow("--card");
  });

  it("throws on a token the lookup can't find, naming it", () => {
    expect(() => textContrast([{ fg: "foreground", bg: "nowhere" }], lookup({ foreground: "#fff" }))).toThrow(
      "nowhere",
    );
  });
});
