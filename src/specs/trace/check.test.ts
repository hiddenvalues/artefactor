import { describe, expect, it } from "vitest";
import { traceCheck } from "./check";
import {
  catalogOf,
  CORE_CONTEXTS,
  EE_CONTEXTS,
  fixture,
  marker,
  slice,
  sliceFile,
  type FixtureOptions,
} from "./fixture";

const X_DDD = "docs/specs/ddd/x.md";
const X_SLICES = "docs/specs/fdd/slices/x.md";
const HOSTING_DDD = "docs/specs/ddd/artefact-hosting.md";

/** A DDD file body: `blocks` under `## Invariants`, so the first block starts on line 3. */
const inv = (...blocks: string[]) => ["## Invariants", "", ...blocks].join("\n");

const errorsOf = (options: FixtureOptions) => traceCheck(fixture(options)).errors;
const reportOf = (options: FixtureOptions) => traceCheck(fixture(options)).report;

/** `x.y` in the x DDD file, claimed by slice S1 of `status` through `Delivers:`. */
const claimed = (status: string, sources: Record<string, string>, id = "x.y"): FixtureOptions => ({
  specs: {
    [X_DDD]: `# X\n\n## Invariants\n\n${marker(id, "The rule.")}`,
    [X_SLICES]: sliceFile(slice("S1", status, [], [`- **Delivers:** ${id}`])),
  },
  sources,
});

const verify = (id = "x.y") => `// r[verify ${id}]\nit("holds", () => {});\n`;
const impl = (id = "x.y") => `// r[impl ${id}]\nexport const rule = 1;\n`;

describe("requirement ids", () => {
  // r[verify platform.trace.id-shape]
  it("rejects an id that isn't 2–4 lowercase kebab-case segments", () => {
    for (const id of ["Hosting.x", "hosting", "a.b.c.d.e", "hosting.x_y"]) {
      expect(errorsOf({ specs: { [HOSTING_DDD]: inv(marker(id, "Body.")) } })).toEqual([
        expect.stringMatching(new RegExp(`${HOSTING_DDD}:3: .*${id.replace(/\./g, "\\.")}.*id`)),
      ]);
    }
  });

  // r[verify platform.trace.id-shape]
  it("accepts ids of two to four segments with digits and hyphens", () => {
    const specs = {
      [HOSTING_DDD]: inv(
        marker("hosting.slug", "A."),
        marker("hosting.access.no-existence-leak", "B."),
        marker("hosting.a2.b-3.c4d", "C."),
      ),
    };
    expect(errorsOf({ specs })).toEqual([]);
  });

  // r[verify platform.trace.id-shape]
  it("rejects a namespace no catalog registers", () => {
    expect(errorsOf({ specs: { [X_DDD]: inv(marker("nope.x", "Body.")) } })).toEqual([
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:3: .*nope\.x.*namespace nope.*not registered/),
    ]);
  });

  // r[verify platform.trace.id-shape]
  it("rejects a requirement defined outside its namespace's files", () => {
    expect(errorsOf({ specs: { [HOSTING_DDD]: inv(marker("data.x", "Body.")) } })).toEqual([
      expect.stringMatching(
        /artefact-hosting\.md:3: data\.x .*docs\/specs\/ddd\/artefact-data\.md.*docs\/specs\/fdd\/slices\/artefact-data\.md/,
      ),
    ]);
  });

  // r[verify platform.trace.id-shape]
  it("rejects the same id defined twice, across files and trees", () => {
    const specs = { [X_DDD]: inv(marker("x.y", "One.")), [X_SLICES]: marker("x.y", "Two.") };
    expect(errorsOf({ specs })).toEqual([
      expect.stringMatching(/duplicate requirement x\.y \(docs\/specs\/ddd\/x\.md:3, .*slices\/x\.md:1\)/),
    ]);
  });
});

describe("the lock", () => {
  const spec = (body: string) => ({ [X_DDD]: `# X\n\n## Invariants\n\n${marker("x.y", body)}` });

  // r[verify platform.trace.lock]
  it("passes a body reflowed at the same version", () => {
    const locked = fixture({ specs: spec("A rule that\nwraps.") }).trees[0]!.lock.text;
    expect(errorsOf({ specs: spec("A rule\nthat wraps."), locks: { core: locked } })).toEqual([]);
  });

  // r[verify platform.trace.lock]
  it("fails a body changed at the same version, naming the id and spec:bump", () => {
    const locked = fixture({ specs: spec("A rule that wraps.") }).trees[0]!.lock.text;
    expect(errorsOf({ specs: spec("A rule that bends."), locks: { core: locked } })).toEqual([
      expect.stringMatching(
        /docs\/specs\/ddd\/x\.md:5: x\.y text changed without a version bump — run `pnpm spec:bump`/,
      ),
    ]);
  });

  // r[verify platform.trace.lock]
  it("fails a duplicated id line (a union merge), naming pnpm spec:bump as the fix", () => {
    const locked = fixture({ specs: spec("A rule.") }).trees[0]!.lock.text;
    const doubled = `${locked}${locked}`;
    expect(errorsOf({ specs: spec("A rule."), locks: { core: doubled } })).toEqual([
      expect.stringMatching(
        /docs\/specs\/requirements\.lock:2: duplicate line for x\.y.*`pnpm spec:bump`/,
      ),
    ]);
  });

  // r[verify platform.trace.lock]
  it("fails a requirement missing from the lock, a line naming no requirement and a version mismatch", () => {
    const hash = "0".repeat(64);
    expect(errorsOf({ specs: spec("A rule."), locks: { core: "" } })).toEqual([
      expect.stringMatching(/x\.md:5: x\.y is not in docs\/specs\/requirements\.lock — run `pnpm spec:bump`/),
    ]);
    const stray = `${fixture({ specs: spec("A rule.") }).trees[0]!.lock.text}x.gone 1 ${hash}\n`;
    expect(errorsOf({ specs: spec("A rule."), locks: { core: stray } })).toEqual([
      expect.stringMatching(/requirements\.lock:2: x\.gone names no requirement — run `pnpm spec:bump`/),
    ]);
    const behind = fixture({ specs: spec("A rule.") }).trees[0]!.lock.text.replace(" 1 ", " 2 ");
    expect(errorsOf({ specs: spec("A rule."), locks: { core: behind } })).toEqual([
      expect.stringMatching(/x\.md:5: x\.y is version 1 but .*requirements\.lock records 2 — run `pnpm spec:bump`/),
    ]);
  });

  // r[verify platform.trace.lock]
  it("checks each tree against its own lock", () => {
    const specs = { "ee/docs/specs/ddd/tenancy.md": inv(marker("tenancy.x", "Body.")) };
    const core = fixture({ specs }).trees[0]!.lock.text;
    expect(core).toBe("");
    expect(errorsOf({ specs, locks: { ee: "" } })).toEqual([
      expect.stringMatching(/tenancy\.x is not in ee\/docs\/specs\/requirements\.lock/),
    ]);
  });
});

describe("references", () => {
  const specs = { [X_DDD]: inv(marker("x.y", "The rule.")) };

  // r[verify platform.trace.references]
  it("fails a reference to an unknown id as broken", () => {
    expect(errorsOf({ specs, sources: { "src/a.test.ts": verify("x.unknown") } })).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:1: broken reference r\[verify x\.unknown\]/),
    ]);
  });

  // r[verify platform.trace.references]
  it("fails a verify outside a test file", () => {
    expect(errorsOf({ specs, sources: { "src/a.ts": verify() } })).toEqual([
      expect.stringMatching(/src\/a\.ts:1: r\[verify x\.y\] outside a \*\.test\.ts/),
    ]);
    expect(errorsOf({ specs, sources: { "src/a.test.tsx": verify(), "src/b.ts": impl() } })).toEqual(
      [],
    );
  });

  // r[verify platform.trace.references]
  it("fails a reference to an older version as stale, naming the site", () => {
    const bumped = { [X_DDD]: inv(marker("x.y+2", "The rule.")) };
    expect(errorsOf({ specs: bumped, sources: { "src/a.test.ts": `\n${verify()}` } })).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:2: stale reference r\[verify x\.y\] — x\.y is at \+2/),
    ]);
    expect(
      errorsOf({ specs: bumped, sources: { "src/a.test.ts": verify("x.y+2"), "src/b.ts": impl("x.y+2") } }),
    ).toEqual([]);
  });
});

describe("direction", () => {
  const specs = { "ee/docs/specs/ddd/tenancy.md": inv(marker("tenancy.x", "The rule.")) };

  // r[verify platform.trace.direction]
  it("fails a core file referencing an EE-defined requirement in the EE gate", () => {
    expect(errorsOf({ specs, sources: { "src/a.test.ts": verify("tenancy.x") } })).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:1: .*tenancy\.x.*EE.*core file/),
    ]);
  });

  // r[verify platform.trace.direction]
  it("accepts the same reference under ee/, and an ee/ file citing a core requirement", () => {
    const both = { ...specs, [X_DDD]: inv(marker("x.y", "Core rule.")) };
    const sources = { "ee/a.test.ts": `${verify("tenancy.x")}${verify("x.y")}` };
    expect(errorsOf({ specs: both, sources })).toEqual([]);
  });

  // r[verify platform.trace.direction]
  it("fails a core spec defining a requirement in an EE namespace", () => {
    expect(errorsOf({ specs: { [X_DDD]: inv(marker("tenancy.y", "The rule.")) } })).toEqual([
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:3: .*tenancy\.y.*EE namespace tenancy.*core/),
    ]);
  });

  // r[verify platform.trace.direction]
  it("counts an ee/ test verifying a core requirement in the EE gate only", () => {
    const options = claimed("done", { "ee/a.test.ts": verify(), "src/b.ts": impl() });
    expect(errorsOf(options)).toEqual([]);
    expect(errorsOf({ ...options, ee: null, sources: { "src/b.ts": impl() } })).toEqual([
      expect.stringMatching(/x\.y .*done.*no current r\[verify x\.y\]/),
    ]);
  });
});

describe("coverage", () => {
  // r[verify platform.trace.coverage]
  it("requires nothing of an unclaimed requirement, and reports it", () => {
    const options: FixtureOptions = { specs: { [X_DDD]: inv(marker("x.y", "The rule.")) } };
    expect(errorsOf(options)).toEqual([]);
    expect(reportOf(options).requirements).toMatchObject([{ id: "x.y", status: "unclaimed" }]);
  });

  // r[verify platform.trace.coverage]
  it("reports a requirement claimed by a specced slice as planned", () => {
    expect(errorsOf(claimed("specced", {}))).toEqual([]);
    expect(reportOf(claimed("specced", {})).requirements).toMatchObject([
      { id: "x.y", status: "planned", claimants: ["S1"] },
    ]);
  });

  // r[verify platform.trace.coverage]
  it("fails an in-progress claim with no verify, or with two impls", () => {
    expect(errorsOf(claimed("in progress", {}))).toEqual([
      expect.stringMatching(/x\.md:5: x\.y \(in progress, S1\) has no current r\[verify x\.y\]/),
    ]);
    const twoImpls = { "src/a.test.ts": verify(), "src/b.ts": impl(), "src/c.ts": impl() };
    expect(errorsOf(claimed("in progress", twoImpls))).toEqual([
      expect.stringMatching(/x\.y \(in progress, S1\) has 2 current r\[impl x\.y\] .*src\/b\.ts:1, src\/c\.ts:1/),
    ]);
    expect(errorsOf(claimed("in progress", { "src/a.test.ts": verify() }))).toEqual([]);
  });

  // r[verify platform.trace.coverage]
  it("fails a done claim without exactly one impl", () => {
    expect(errorsOf(claimed("done", { "src/a.test.ts": verify() }))).toEqual([
      expect.stringMatching(/x\.y \(done, S1\) has 0 current r\[impl x\.y\] — exactly 1 needed/),
    ]);
    expect(errorsOf(claimed("done", { "src/a.test.ts": verify(), "src/b.ts": impl() }))).toEqual([]);
  });

  // r[verify platform.trace.coverage]
  it("applies the strictest claimant: done beats specced", () => {
    const options: FixtureOptions = {
      specs: {
        [X_DDD]: inv(marker("x.y", "The rule.")),
        [X_SLICES]: sliceFile(
          slice("S1", "specced", [], ["- **Delivers:** x.y"]),
          slice("S2", "done", [], ["- **Delivers:** x.y"]),
        ),
      },
      sources: { "src/a.test.ts": verify() },
    };
    expect(errorsOf(options)).toEqual([expect.stringMatching(/x\.y \(done, S2\) has 0 current r\[impl/)]);
  });

  // r[verify platform.trace.coverage]
  it("treats a requirement defined in a slice's own section like one it delivers", () => {
    const options: FixtureOptions = {
      specs: { [X_SLICES]: sliceFile(slice("S1", "done", [marker("x.y", "The rule.")])) },
      sources: { "src/a.test.ts": verify() },
    };
    expect(errorsOf(options)).toEqual([expect.stringMatching(/x\.y \(done, S1\) has 0 current r\[impl/)]);
    expect(
      errorsOf({ ...options, sources: { "src/a.test.ts": verify(), "src/b.ts": impl() } }),
    ).toEqual([]);
  });

  // r[verify platform.trace.coverage]
  it("counts only current references toward coverage", () => {
    const options: FixtureOptions = {
      specs: {
        [X_DDD]: inv(marker("x.y+2", "The rule.")),
        [X_SLICES]: sliceFile(slice("S1", "done", [], ["- **Delivers:** x.y"])),
      },
      sources: { "src/a.test.ts": verify(), "src/b.ts": impl("x.y+2") },
    };
    expect(errorsOf(options)).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:1: stale reference/),
      expect.stringMatching(/x\.y \(done, S1\) has no current r\[verify x\.y\+2\]/),
    ]);
  });

  // r[verify platform.trace.coverage]
  it("lets a dropped slice claim nothing, and fails a Delivers id that names no requirement", () => {
    const dropped = {
      specs: {
        [X_DDD]: inv(marker("x.y", "The rule.")),
        [X_SLICES]: sliceFile(slice("S1", "dropped", [], ["- **Delivers:** x.y"])),
      },
    };
    expect(errorsOf(dropped)).toEqual([]);
    expect(reportOf(dropped).requirements).toMatchObject([{ id: "x.y", status: "unclaimed" }]);
    const unknown = {
      specs: { [X_SLICES]: sliceFile(slice("S1", "specced", [], ["- **Delivers:** x.nope"])) },
    };
    expect(errorsOf(unknown)).toEqual([
      expect.stringMatching(/slices\/x\.md:5: S1 delivers x\.nope, which names no requirement/),
    ]);
  });
});

describe("completeness", () => {
  const TENANCY_SLICES = "ee/docs/specs/fdd/slices/tenancy.md";
  const numbered = "# X\n\n## Invariants\n\n1. **X1 — A rule.** Text.\n2. Another.\n";
  const doneClaimingNothing = sliceFile(slice("S1", "done", ["Prose only."]));

  // r[verify platform.trace.completeness]
  it("fails numbered invariants in any registered context, with no way to opt out", () => {
    expect(errorsOf({ specs: { [X_DDD]: numbered } })).toEqual([
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:5: numbered invariants list in context x — write each/),
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:5: prose under an Invariants heading/),
    ]);
  });

  // r[verify platform.trace.completeness]
  it("fails a done slice claiming no requirement, in a core or an EE context", () => {
    expect(errorsOf({ specs: { [X_SLICES]: doneClaimingNothing } })).toEqual([
      expect.stringMatching(/slices\/x\.md:5: S1 is done but claims no requirement$/),
    ]);
    expect(errorsOf({ specs: { [TENANCY_SLICES]: doneClaimingNothing } })).toEqual([
      expect.stringMatching(/slices\/tenancy\.md:5: S1 is done but claims no requirement$/),
    ]);
  });

  // r[verify platform.trace.completeness]
  it("ignores numbered lists outside an Invariants heading", () => {
    const otherList = "# X\n\n## Rules\n\n1. Not an invariant list.\n";
    expect(errorsOf({ specs: { [X_DDD]: otherList } })).toEqual([]);
  });

  // r[verify platform.trace.completeness]
  it("fails a catalog whose Requirement contexts table still has a Migrated column", () => {
    for (const tree of [0, 1]) {
      const input = fixture({});
      const t = input.trees[tree]!;
      const withColumn = catalogOf(t.catalog.path, tree === 0 ? CORE_CONTEXTS : EE_CONTEXTS)
        .replace("| Legacy prefix |", "| Legacy prefix | Migrated |")
        .replace("| --- | --- | --- | --- |", "| --- | --- | --- | --- | --- |")
        .replace(/^(\| [a-z]+ \|.*\|)$/gm, "$1 no |");
      t.catalog.text = withColumn;
      t.specs = t.specs.map((f) => (f.path === t.catalog.path ? t.catalog : f));
      expect(traceCheck(input).errors).toEqual([
        expect.stringMatching(
          new RegExp(`${t.catalog.path.replace(/\./g, "\\.")}:5: .*Migrated column — column removed; completeness applies to every context$`),
        ),
      ]);
    }
  });
});

describe("the legacy-id ban", () => {
  const hosting = {
    legacy: { core: { hosting: [["AH99", "hosting.slug.retained"]] as [string, string][] } },
  };

  // r[verify platform.trace.legacy-ban+2]
  it("fails a registered context's legacy id anywhere in either tree", () => {
    expect(errorsOf({ ...hosting, sources: { "src/a.test.ts": 'it("keeps the slug (AH99)", f);' } })).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:1: legacy id AH99 .*hosting\.slug\.retained/),
    ]);
    expect(errorsOf({ ...hosting, sources: { "ee/a.ts": 'const why = "AH99";' } })).toEqual([
      expect.stringMatching(/ee\/a\.ts:1: legacy id AH99/),
    ]);
    expect(errorsOf({ ...hosting, markdown: { "docs/notes.md": "\n\nPer AH99, …" } })).toEqual([
      expect.stringMatching(/docs\/notes\.md:3: legacy id AH99/),
    ]);
  });

  // r[verify platform.trace.legacy-ban+2]
  it("allows it in the legacy maps, and matches it word-bounded", () => {
    expect(errorsOf(hosting)).toEqual([]);
    expect(errorsOf({ ...hosting, sources: { "src/a.ts": "// AH990 and XAH99 and AH99a" } })).toEqual([]);
  });

  // r[verify platform.trace.legacy-ban+2]
  it("bans an EE context's legacy id too, from the EE map", () => {
    const tenancy = { legacy: { ee: { tenancy: [["T99", "tenancy.x.y"]] as [string, string][] } } };
    expect(errorsOf({ ...tenancy, sources: { "ee/a.test.ts": 'it("T99", f);' } })).toEqual([
      expect.stringMatching(/ee\/a\.test\.ts:1: legacy id T99 of context tenancy/),
    ]);
  });

  // r[verify platform.trace.legacy-ban+2]
  it("matches a one-letter-prefix id only in Markdown, comments and test titles", () => {
    const quota = {
      legacy: { ee: { quota: [["Q3", "quota.meter.created-only"]] as [string, string][] } },
    };
    expect(errorsOf({ ...quota, sources: { "ee/a.ts": 'const t = "Q3 roadmap";' } })).toEqual([]);
    expect(errorsOf({ ...quota, sources: { "ee/a.svg.ts": 'const d = "M0 0 Q3 4 5 6";' } })).toEqual([]);
    expect(errorsOf({ ...quota, sources: { "ee/a.ts": "// Q3 caps creation" } })).toEqual([
      expect.stringMatching(/ee\/a\.ts:1: legacy id Q3/),
    ]);
    expect(errorsOf({ ...quota, sources: { "ee/a.test.ts": 'describe("Q3", () => {});' } })).toEqual([
      expect.stringMatching(/ee\/a\.test\.ts:1: legacy id Q3/),
    ]);
    expect(errorsOf({ ...quota, markdown: { "ee/docs/x.md": "Q3 holds." } })).toEqual([
      expect.stringMatching(/ee\/docs\/x\.md:1: legacy id Q3/),
    ]);
  });

  // r[verify platform.trace.legacy-ban+2]
  it("fails a legacy map that lacks a registered namespace's section", () => {
    const input = fixture({});
    input.trees[0]!.legacy.text = "# Legacy requirement ids\n";
    input.trees[0]!.specs = input.trees[0]!.specs.map((f) =>
      f.path === input.trees[0]!.legacy.path ? input.trees[0]!.legacy : f,
    );
    expect(traceCheck(input).errors).toEqual([
      expect.stringMatching(/legacy-ids\.md: no section for namespace x/),
      expect.stringMatching(/legacy-ids\.md: no section for namespace hosting/),
      expect.stringMatching(/legacy-ids\.md: no section for namespace data/),
    ]);
  });
});
