import { describe, expect, it } from "vitest";
import { traceCheck } from "./check";
import { CORE_CONTEXTS, fixture, marker, type FixtureOptions } from "./fixture";
import { hashBody } from "./markers";

const X_DDD = "docs/specs/ddd/x.md";
const TENANCY_DDD = "ee/docs/specs/ddd/tenancy.md";

const errorsOf = (options: FixtureOptions) => traceCheck(fixture(options)).errors;

const PROSE = "Every artefact has\nexactly one owner.";
const proseUnder = (heading: string, lead = "") =>
  `# X\n\n${lead}${heading}\n\n${PROSE}\n`;

describe("requirement placement", () => {
  // r[verify platform.trace.placement+2]
  it("fails prose under an Invariants heading, naming file:line", () => {
    expect(errorsOf({ specs: { [X_DDD]: proseUnder("### Invariants") } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:5: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("fails a table under an Invariants heading", () => {
    const table = "# X\n\n## Invariants\n\n| Field | Rule |\n| --- | --- |\n| owner | immutable |\n";
    expect(errorsOf({ specs: { [X_DDD]: table } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:5: table under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("fails a marker outside any Invariants heading", () => {
    const outside = `# X\n\n## Aggregate\n\n${marker("x.y", "The rule.")}`;
    expect(errorsOf({ specs: { [X_DDD]: outside } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:5: requirement x\.y sits outside an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("passes a marker with a list attached, under an Invariants heading at any level", () => {
    const listed = marker("x.y", "The rule holds for:", "- one case;", "- another.");
    expect(errorsOf({ specs: { [X_DDD]: `# X\n\n## Invariants\n\n${listed}` } })).toEqual([]);
    const nested = `# X\n\n## Published language\n\n### Invariants\n\n${marker("x.z", "The rule.")}`;
    expect(errorsOf({ specs: { [X_DDD]: nested } })).toEqual([]);
  });

  // r[verify platform.trace.placement+2]
  it("ends an Invariants block at the next heading of the same or a higher level", () => {
    const after = `# X\n\n## Invariants\n\n${marker("x.y", "The rule.")}\n## Decided\n\n${PROSE}\n`;
    expect(errorsOf({ specs: { [X_DDD]: after } })).toEqual([]);
    const deeper = `# X\n\n## Invariants\n\n#### Detail\n\n${PROSE}\n`;
    expect(errorsOf({ specs: { [X_DDD]: deeper } })).toEqual([
      expect.stringMatching(/x\.md:7: prose under an Invariants heading \(X › Invariants › Detail\)/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("passes a context with no DDD file", () => {
    const noDdd = CORE_CONTEXTS.map((c) => (c.namespace === "x" ? { ...c, ddd: null } : c));
    expect(errorsOf({ core: noDdd })).toEqual([]);
    expect(errorsOf({})).toEqual([]);
  });

  // r[verify platform.trace.placement+2]
  it("checks an EE context's DDD file the same way", () => {
    const prose = `# Tenancy\n\n## Invariants\n\n${PROSE}\n`;
    expect(errorsOf({ specs: { [TENANCY_DDD]: prose } })).toEqual([
      expect.stringMatching(/^ee\/docs\/specs\/ddd\/tenancy\.md:5: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("fails a violation even when a placement-baseline.md lists it: there is no baseline", () => {
    const listed = [
      "| File | Heading path | Kind | Block |",
      "| --- | --- | --- | --- |",
      `| ${X_DDD} | X › Invariants | prose-under-invariants | ${hashBody(PROSE).slice(0, 12)} |`,
      "",
    ].join("\n");
    const specs = { [X_DDD]: proseUnder("## Invariants"), "docs/specs/placement-baseline.md": listed };
    expect(errorsOf({ specs })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:5: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("tracks a fence opened inside a marker body, as the marker parser does", () => {
    const fenced = [
      "# X", "", "## Invariants", "", "r[x.y]", "The rule:", "```ts", "code", "", "# a comment", "```",
      "", "## Aggregate", "", marker("x.z", "Outside."),
    ].join("\n");
    // The body ends at the fence's blank line, so the code after it is a block of its own.
    expect(errorsOf({ specs: { [X_DDD]: fenced } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:10: prose under an Invariants heading \(X › Invariants\)/),
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:15: requirement x\.z sits outside an Invariants heading \(X › Aggregate\)/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("ends a marker body at a blank line inside a fence, as the marker parser does", () => {
    const after = [
      "# X", "", "## Invariants", "", "r[x.y]", "The rule:", "```", "code", "", "more", "```",
      "Stray prose rule.",
    ].join("\n");
    expect(errorsOf({ specs: { [X_DDD]: after } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:10: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("ends a marker body exactly where the marker parser does: at a heading or marker in a fence, or one in a comment", () => {
    const fencedHeading = "# X\n\n## Invariants\n\nr[x.y]\nRule:\n```\n# c\nStray rule.\n```\n";
    expect(errorsOf({ specs: { [X_DDD]: fencedHeading } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:8: prose under an Invariants heading/),
    ]);
    const commented = "# X\n\n## Invariants\n\nr[x.y]\nRule.\n<!--\n## Old\n-->\nStray rule.\n";
    expect(errorsOf({ specs: { [X_DDD]: commented } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:10: prose under an Invariants heading \(X › Invariants\)/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("closes a comment on its own line when that line holds `-->`, and tracks fences inside one", () => {
    const empty = `# X\n\n## Invariants\n\n<!-->\n\nStray rule.\n\n## Aggregate\n\n${marker("x.q", "Out.")}`;
    expect(errorsOf({ specs: { [X_DDD]: empty } })).toEqual([
      expect.stringMatching(/x\.md:7: prose under an Invariants heading/),
      expect.stringMatching(/x\.md:11: requirement x\.q sits outside/),
    ]);
    // parseMarkers sees the fence the comment holds, so it reads no x.y; placement agrees.
    const fenceInComment = `# X\n\n## Aggregate\n\n<!--\n\`\`\`\n-->\n\n${marker("x.y", "Rule.")}\n\`\`\`\n`;
    expect(errorsOf({ specs: { [X_DDD]: fenceInComment } })).toEqual([]);
  });

  // r[verify platform.trace.placement+2]
  it("ignores an HTML comment block whole: its blank lines, headings, markers, or no closer", () => {
    const comment = "# X\n\n## Invariants\n\n<!--\nA retired rule.\n\nMore of it.\n-->\n";
    expect(errorsOf({ specs: { [X_DDD]: comment } })).toEqual([]);
    const retired = `# X\n\n## Invariants\n\n<!--\nOld:\n\n## Old\n\n-->\n\n${marker("x.z", "Rule.")}`;
    expect(errorsOf({ specs: { [X_DDD]: retired } })).toEqual([]);
    const unclosed = "# X\n\n## Invariants\n\n<!--\nretired\n";
    expect(errorsOf({ specs: { [X_DDD]: unclosed } })).toEqual([]);
    const inline = "# X\n\n## Invariants\n\nUse `<!--` here.\n\nSecond prose.\n";
    expect(errorsOf({ specs: { [X_DDD]: inline } })).toEqual([
      expect.stringMatching(/x\.md:5: prose under/),
      expect.stringMatching(/x\.md:7: prose under/),
    ]);
    const between = "# X\n\n## Invariants\n\n<!-- a -->\nA hidden rule.\n<!-- b -->\n";
    expect(errorsOf({ specs: { [X_DDD]: between } })).toEqual([
      expect.stringMatching(/^docs\/specs\/ddd\/x\.md:6: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.placement+2]
  it("reads headings as CommonMark does: no 7-hash heading, a closing run only after a space", () => {
    const sevenHashes = `# X\n\n## Invariants\n\n####### Not a heading\n`;
    expect(errorsOf({ specs: { [X_DDD]: sevenHashes } })).toEqual([
      expect.stringMatching(/x\.md:5: prose under an Invariants heading \(X › Invariants\)/),
    ]);
    const closing = `# X\n\n## Aggregate C# ##\n\n${marker("x.y", "The rule.")}`;
    expect(errorsOf({ specs: { [X_DDD]: closing } })).toEqual([
      expect.stringMatching(/requirement x\.y sits outside an Invariants heading \(X › Aggregate C#\)/),
    ]);
  });
});
