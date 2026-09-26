import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeSpecimen } from "./ThemeSpecimen";

// The Theme card (docs/design/README.md) shows the Mint garden product colours
// (docs/design/theme/mint-garden.md) in light and dark, as it does the colours.
const KINDS = ["prototype", "slide-deck", "form", "interactive-doc", "other"];

const product = () => renderToStaticMarkup(createElement(ThemeSpecimen, { section: "product" }));

/** The markup of one `data-column` of the product section. */
function column(name: "light" | "dark"): string {
  const html = product();
  const start = html.indexOf(`data-column="${name}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf("data-column=", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

describe("ThemeSpecimen product colours", () => {
  it.each(["light", "dark"] as const)("draws every kind and collection hue in the %s column", (name) => {
    const html = column(name);
    for (const kind of KINDS) expect(html).toContain(`data-kind="${kind}"`);
    for (let n = 1; n <= 6; n++) expect(html).toContain(`data-collection="${n}"`);
  });

  it("no longer says the product colours have no dark values", () => {
    expect(product()).not.toContain("no dark values");
  });
});
