import { describe, expect, it } from "vitest";
import { traceCheck } from "./check";
import { fixture, marker, slice, sliceFile } from "./fixture";
import { formatReport, untracedTests } from "./report";

const X_DDD = "docs/specs/ddd/x.md";
const X_SLICES = "docs/specs/fdd/slices/x.md";

const input = () =>
  fixture({
    specs: {
      [X_DDD]: `# X\n\n## Invariants\n\n${marker("x.y", "The rule.")}\n${marker("x.z+2", "Another.")}`,
      [X_SLICES]: sliceFile(slice("S1", "done", [], ["- **Delivers:** x.y"])),
    },
    sources: {
      "src/a.test.ts": [
        'describe("the rule", () => {',
        "  // r[verify x.y]",
        '  it("holds", () => {});',
        '  it("holds again", () => {});',
        "  // r[verify x.gone]",
        '  it("cites a broken id", () => {});',
        "});",
        "// r[verify x.z]",
        'test("cites an old version", () => {});',
      ].join("\n"),
      "src/b.ts": "// r[impl x.y]\nexport const rule = 1;\n",
    },
  });

describe("traceReport", () => {
  // r[verify platform.trace.report]
  it("maps each requirement to its claimants, verify sites and impl site", () => {
    const { report } = traceCheck(input());
    expect(report.requirements).toEqual([
      expect.objectContaining({
        id: "x.y",
        version: 1,
        status: "done",
        claimants: ["S1"],
        verify: ["src/a.test.ts:2"],
        impl: ["src/b.ts:1"],
      }),
      expect.objectContaining({
        id: "x.z",
        version: 2,
        status: "unclaimed",
        verify: [],
        impl: [],
      }),
    ]);
  });

  // r[verify platform.trace.report]
  it("lists stale and broken references and coverage per namespace", () => {
    const { report } = traceCheck(input());
    expect(report.stale).toEqual(["src/a.test.ts:8: r[verify x.z] — x.z is at +2"]);
    expect(report.broken).toEqual(["src/a.test.ts:5: r[verify x.gone]"]);
    expect(report.namespaces).toContainEqual({
      namespace: "x",
      tree: "core",
      total: 2,
      unclaimed: 1,
      planned: 0,
      inProgress: 0,
      done: 1,
      verified: 1,
      implemented: 1,
    });
  });

  // r[verify platform.trace.report]
  it("lists tests that cite no requirement without failing on them", () => {
    const traced = fixture({
      specs: { [X_DDD]: `## Invariants\n\n${marker("x.y", "The rule.")}` },
      sources: { "src/a.test.ts": 'it("holds", () => {});\n// r[verify x.y]\nit("cites", f);\n' },
    });
    const { errors, report } = traceCheck(traced);
    expect(errors).toEqual([]);
    expect(report.untraced).toEqual([{ file: "src/a.test.ts", line: 1, title: "holds" }]);
  });

  // r[verify platform.trace.report]
  it("treats a verify above a describe as covering every test inside it", () => {
    const file = {
      path: "src/a.test.ts",
      text: [
        "// r[verify x.y]",
        'describe("the rule", () => {',
        '  it("one", () => {});',
        '  describe("nested", () => {',
        '    it("two", () => {});',
        "  });",
        "});",
        "",
        'describe("another", () => {',
        "  it.each([1, 2])(\"three %i\", (n) => {});",
        "});",
      ].join("\n"),
    };
    expect(untracedTests([file])).toEqual([{ file: "src/a.test.ts", line: 10, title: "three %i" }]);
  });

  // r[verify platform.trace.report]
  it("prints coverage, the reference problems and the untraced tests", () => {
    const { errors, report } = traceCheck(input());
    const summary = formatReport(report, errors).join("\n");
    expect(summary).toMatch(/Coverage[\s\S]*x \(core\): 2 requirements — 1 done, 0 in progress, 0 planned, 1 unclaimed/);
    expect(summary).toMatch(/Stale references[\s\S]*src\/a\.test\.ts:8/);
    expect(summary).toMatch(/Broken references[\s\S]*src\/a\.test\.ts:5/);
    expect(summary).toMatch(/Untraced tests: 1 in 1 file[\s\S]*src\/a\.test\.ts: 1/);
    expect(summary).toMatch(/Errors \(\d+\)/);
    const listed = formatReport(report, errors, { untraced: true }).join("\n");
    expect(listed).toMatch(/src\/a\.test\.ts:4 holds again/);
  });
});
