import { describe, expect, it } from "vitest";
import { fixture, marker } from "./fixture";
import { lookupRequirements } from "./lookup";
import { parseMarkers } from "./markers";

// `lookupRequirements` — one requirement at a time, through the checker's own parser: its version,
// the `file:line` of its marker and its body, and optionally its verify and impl sites.

const X_DDD = "docs/specs/ddd/x.md";
const X_SPEC = [
  "# X",
  "",
  marker("x.one", "The first rule,", "over two lines."),
  marker("x.two+2", "The second rule, bumped."),
  "## Next",
  "",
].join("\n");
const sources = {
  "src/x.test.ts": `// r[verify x.one]\nit("holds", () => {});\n`,
  "src/x.ts": `export const a = 1;\n// r[impl x.one]\nexport const rule = 1;\n`,
};
const input = fixture({ specs: { [X_DDD]: X_SPEC }, sources });
const lookup = (queries: string[], refs = false) => lookupRequirements(input, queries, { refs });

describe("lookupRequirements", () => {
  // r[verify platform.trace.lookup]
  it("finds a version-1 id: its version, marker site and the body the checker delimits", () => {
    const [checked] = parseMarkers({ path: X_DDD, text: X_SPEC }).requirements;
    expect(lookup(["x.one"])).toEqual([
      {
        query: "x.one",
        found: true,
        id: "x.one",
        version: 1,
        file: X_DDD,
        line: 3,
        body: checked!.body,
        stale: false,
        verify: [],
        impl: [],
      },
    ]);
    expect(checked!.body).toBe("The first rule,\nover two lines.");
  });

  // r[verify platform.trace.lookup]
  it("reports a bumped id at its current version", () => {
    expect(lookup(["x.two"])[0]).toMatchObject({ found: true, id: "x.two", version: 2, line: 7 });
  });

  // r[verify platform.trace.lookup]
  it("reads a pasted marker, a pasted reference and a current suffix as the bare id", () => {
    const { query: _, ...bare } = lookup(["x.two"])[0]!;
    for (const query of ["r[x.two+2]", "r[x.two]", "r[impl x.two]", "r[verify x.two+2]", "x.two+2"]) {
      expect(lookup([query])[0]).toEqual({ query, ...bare });
    }
  });

  // r[verify platform.trace.lookup]
  it("finds an id queried at an older version and flags the query stale", () => {
    expect(lookup(["x.two+1"])[0]).toMatchObject({ found: true, version: 2, stale: true });
  });

  // r[verify platform.trace.lookup]
  it("with refs, lists the verify and impl sites as file:line; none is an empty list", () => {
    expect(lookup(["x.one", "x.two"], true)).toMatchObject([
      { id: "x.one", verify: ["src/x.test.ts:1"], impl: ["src/x.ts:2"] },
      { id: "x.two", verify: [], impl: [] },
    ]);
  });

  // r[verify platform.trace.lookup]
  it("names an unknown id as unknown, keeping the query order", () => {
    expect(lookup(["x.nope", "x.one"])).toMatchObject([
      { query: "x.nope", found: false, id: "x.nope" },
      { query: "x.one", found: true },
    ]);
  });
});
