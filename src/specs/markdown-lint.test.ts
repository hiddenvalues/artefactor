import { readFileSync } from "node:fs";
import { lint } from "markdownlint-cli2/markdownlint/promise";
import jsoncParse from "markdownlint-cli2/parsers/jsonc";
import { describe, expect, it } from "vitest";

// Every tracked Markdown file is linted by `pnpm lint:md` (markdownlint-cli2) with the repo config
// `.markdownlint-cli2.jsonc`. These tests pin what that config enforces, running markdownlint's
// programmatic API with the same `config` over inline fixtures.

const { config } = jsoncParse(
  readFileSync(new URL("../../.markdownlint-cli2.jsonc", import.meta.url), "utf8"),
) as { config: Record<string, unknown> };

/** The rule ids markdownlint reports for `body`, wrapped in an otherwise clean document. */
async function ruleIds(body: string): Promise<string[]> {
  const results = await lint({ strings: { fixture: `# Fixture\n\n${body}\n` }, config });
  return results.fixture!.map((error) => error.ruleNames[0]!);
}

/**
 * A prose line of exactly `length` characters ending in a one-letter word. MD013 lets a line's
 * last word run past the limit when it starts within it, so the word must start at the limit.
 */
const prose = (length: number) => `${"a ".repeat((length - 1) / 2)}b`.padStart(length, "a");

describe("markdown lint config", () => {
  it("limits prose lines to 100 characters", async () => {
    expect(prose(101)).toHaveLength(101);
    expect(prose(100)).toHaveLength(100);
    expect(await ruleIds(prose(101))).toEqual(["MD013"]);
    expect(await ruleIds(prose(100))).toEqual([]);
  });

  it("exempts table rows and fenced code from the line limit", async () => {
    const table = `| Column | Notes |\n| --- | --- |\n| row | ${prose(300 - 10)} |`;
    expect(table.split("\n")[2]).toHaveLength(300);
    expect(await ruleIds(table)).toEqual([]);
    expect(await ruleIds(`\`\`\`text\n${prose(150)}\n\`\`\``)).toEqual([]);
  });

  it("reports an indented heading", async () => {
    expect(await ruleIds("  ## Indented heading")).toContain("MD023");
  });

  it("allows a fenced code block nested in a list item", async () => {
    expect(await ruleIds("- A step:\n\n  ```bash\n  pnpm lint:md\n  ```")).toEqual([]);
  });

  it("wants a blank line between a slice heading and its metadata block", async () => {
    expect(await ruleIds("## Slices\n\n### S1 — Title\n\n- **Status:** done")).toEqual([]);
    expect(await ruleIds("## Slices\n\n### S1 — Title\n- **Status:** done")).toContain("MD022");
  });
});
