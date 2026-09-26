import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_ORDER, KIND_PRESENTATION } from "../../shared/kind-presentation";
import { COLLECTION_HUE_COUNT, collectionColor } from "./format";

// S43 — the one tokens file carries the Mint garden theme
// (docs/design/theme/mint-garden.md) and the app-specific colours, in light
// (`:root`) and dark (`.dark`). The light kind colours also live in
// `shared/kind-presentation.ts` for the server-rendered host shell, so the two
// must not drift apart.
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

describe("app tokens (S43)", () => {
  it.each(KIND_ORDER)("defines the light %s kind colour and tint as the shared presentation has them", (kind) => {
    expect(light(`kind-${kind}`)).toBe(KIND_PRESENTATION[kind].color);
    expect(light(`kind-${kind}-tint`)).toBe(KIND_PRESENTATION[kind].tint);
  });

  it("takes the Mint garden light kind colours, tinted at 12% (slide deck 13%)", () => {
    expect(light("kind-prototype")).toBe("oklch(0.56 0.09 170)");
    expect(KIND_PRESENTATION.prototype.color).toBe("oklch(0.56 0.09 170)");
    expect(light("kind-prototype-tint")).toBe("oklch(0.56 0.09 170 / 12%)");
    expect(light("kind-slide-deck-tint")).toBe("oklch(0.64 0.13 55 / 13%)");
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
});
