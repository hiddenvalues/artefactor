import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "markdownlint-cli2/markdownlint/promise";
import jsoncParse from "markdownlint-cli2/parsers/jsonc";
import { describe, expect, it } from "vitest";

// docs/design/ — the design side's home in the repo: the README, a template per
// hand-back, and a folder for each kind of hand-back to land in. Linted with the
// repo's markdownlint config, as `pnpm lint:md` does.
const DIR = "docs/design";

describe("the design docs", () => {
  it("has the README, the three hand-back templates and the hand-back folders", () => {
    for (const f of ["README.md", "templates/theme-spec.md", "templates/component-spec.md", "templates/screen-spec.md"])
      expect(existsSync(join(DIR, f)), f).toBe(true);
    for (const d of ["theme", "components", "screens", "rules"]) expect(existsSync(join(DIR, d)), d).toBe(true);
  });

  it("passes the markdown lint", async () => {
    const { config } = jsoncParse(readFileSync(".markdownlint-cli2.jsonc", "utf8")) as { config: Record<string, unknown> };
    const files = readdirSync(DIR, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(DIR, f));
    const results = await lint({ strings: Object.fromEntries(files.map((f) => [f, readFileSync(f, "utf8")])), config });
    const issues = Object.entries(results).flatMap(([f, errs]) => errs.map((e) => `${f}:${e.lineNumber} ${e.ruleNames[0]}`));
    expect(files.length).toBeGreaterThan(0);
    expect(issues).toEqual([]);
  });
});
