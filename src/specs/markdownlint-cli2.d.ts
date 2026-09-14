// Types for the two markdownlint-cli2 subpath exports `markdown-lint.test.ts` uses. The package
// ships them as untyped `.mjs`; importing through it (rather than a direct `markdownlint`
// dependency) keeps the test on the exact markdownlint version `pnpm lint:md` runs.

declare module "markdownlint-cli2/markdownlint/promise" {
  export interface LintError {
    lineNumber: number;
    ruleNames: string[];
    ruleDescription: string;
    errorDetail: string | null;
  }
  export function lint(options: {
    strings?: Record<string, string>;
    config?: Record<string, unknown>;
  }): Promise<Record<string, LintError[]>>;
}

declare module "markdownlint-cli2/parsers/jsonc" {
  /** Parses JSONC (comments, trailing commas); throws on invalid input. */
  export default function jsoncParse(text: string): unknown;
}
