import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_ORDER, KIND_PRESENTATION } from "../../shared/kind-presentation";
import { COLLECTION_HUE_COUNT, collectionColor } from "./format";

// S43 — the one tokens file carries the app-specific colours. The kind colours
// also live in `shared/kind-presentation.ts` for the server-rendered host shell,
// so the two must not drift apart.
const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m?.[1]?.replace(/\s+/g, "") ?? null;
};

describe("app tokens (S43)", () => {
  it.each(KIND_ORDER)("defines the %s kind colour and tint as the shared presentation has them", (kind) => {
    expect(token(`kind-${kind}`)).toBe(KIND_PRESENTATION[kind].color);
    expect(token(`kind-${kind}-tint`)).toBe(KIND_PRESENTATION[kind].tint.replace(/\s+/g, ""));
  });

  it("defines every collection hue a collection can hash to", () => {
    for (let n = 1; n <= COLLECTION_HUE_COUNT; n++) expect(token(`collection-${n}`)).toMatch(/^#[0-9a-f]{6}$/);
    expect(token(`collection-${COLLECTION_HUE_COUNT + 1}`)).toBeNull();
    expect(collectionColor("some-collection-id")).toMatch(/^var\(--collection-[1-6]\)$/);
  });
});
