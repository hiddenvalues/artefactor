import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "markdownlint-cli2/markdownlint/promise";
import jsoncParse from "markdownlint-cli2/parsers/jsonc";
import { describe, expect, it } from "vitest";

// docs/design/ — the design side's home in the repo, in the design system's three layers: the
// README, the foundations, the component and template specs, and a blank form per hand-back kind.
// Linted with the repo's markdownlint config, as `pnpm lint:md` does.
const DIR = "docs/design";

// r[impl platform.design.docs-tree]
// The tree the hand-back skills expect; the README's *Hand-back formats* table states it for people.
const TREE = {
  files: [
    "README.md",
    "foundations/color.md",
    "foundations/typography.md",
    "foundations/layout.md",
    "foundations/icons.md",
    "hand-back-forms/foundation-spec.md",
    "hand-back-forms/component-spec.md",
    "hand-back-forms/template-spec.md",
  ],
  folders: ["components", "templates"],
  gone: ["theme", "rules", "screens", "templates/theme-spec.md", "templates/screen-spec.md", "templates/component-spec.md"],
  kinds: { foundation: "foundations", component: "components", template: "templates" },
};

/** The rows of the README's *Hand-back formats* table: the kind and the folder it lands in. */
function handBackRows(readme: string): { kind: string; folder: string }[] {
  const section = readme.split(/^## /m).find((s) => s.startsWith("Hand-back formats")) ?? "";
  return section
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*(Kind|-)/.test(l))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return { kind: cells[1]!, folder: /\[`([^`]+)\/`\]/.exec(cells[3] ?? "")?.[1] ?? cells[3]! };
    });
}

describe("the design docs", () => {
  // r[verify platform.design.docs-tree]
  it("has the README, the foundations, the spec folders and the hand-back forms, and none of the old tree", () => {
    for (const f of TREE.files) expect(existsSync(join(DIR, f)), f).toBe(true);
    for (const d of TREE.folders) expect(existsSync(join(DIR, d)), d).toBe(true);
    for (const p of TREE.gone) expect(existsSync(join(DIR, p)), p).toBe(false);
  });

  // r[verify platform.design.docs-tree]
  it("maps exactly the kinds foundation, component and template to folders that exist", () => {
    const rows = handBackRows(readFileSync(join(DIR, "README.md"), "utf8"));
    const kinds = Object.keys(TREE.kinds);
    expect(rows).toHaveLength(kinds.length);
    expect(new Set(rows.map((r) => r.kind)).size).toBe(rows.length);
    expect(Object.fromEntries(rows.map((r) => [r.kind, r.folder]))).toEqual(TREE.kinds);
    for (const { folder } of rows) expect(existsSync(join(DIR, folder)), folder).toBe(true);
  });

  it("passes the markdown lint, the foundations and the templates included", async () => {
    const { config } = jsoncParse(readFileSync(".markdownlint-cli2.jsonc", "utf8")) as { config: Record<string, unknown> };
    const files = readdirSync(DIR, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(DIR, f));
    const results = await lint({ strings: Object.fromEntries(files.map((f) => [f, readFileSync(f, "utf8")])), config });
    const issues = Object.entries(results).flatMap(([f, errs]) => errs.map((e) => `${f}:${e.lineNumber} ${e.ruleNames[0]}`));
    for (const folder of ["foundations", "templates"])
      expect(files.some((f) => f.startsWith(join(DIR, folder, "/"))), folder).toBe(true);
    expect(issues).toEqual([]);
  });
});
