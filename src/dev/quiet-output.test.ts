/**
 * What the wrapper prints, and how every path is held to the ceiling.
 *
 * Split from `quiet-core.test.ts` to keep each file to one concern:
 * that one covers how the wrapper reads its arguments, its log and its
 * environment, this one covers the bytes it emits — the summary, the budget the
 * entry point leaves it, and the early failures that print before there is
 * anything to summarise.
 */
import { describe, expect, it } from "vitest";

import {
  STDOUT_BUDGET_BYTES,
  parseArgs,
  renderErrorLine,
  renderSummary,
  scanLines,
  summaryBudget,
} from "./quiet-core";

/** A scan of `lines` under the default options, for tests that only vary the log body. */
function scan(lines: string[], overrides: Partial<Parameters<typeof scanLines>[1]> = {}) {
  const { matchPattern, tailLines, matchLimit } = parseArgs(["true"]);
  return scanLines(lines, { matchPattern, tailLines, matchLimit, ...overrides });
}

describe("renderSummary", () => {
  const logPath = "/fake/logs/pnpm-lint-20260921T101530Z.log";

  it("prints only the summary and tail on a green run", () => {
    const result = scan(["warning: one", "warning: two", "done"]);
    const out = renderSummary(result, { exitCode: 0, logPath, summaryOnly: false, forceMatch: false });
    expect(out).toContain("exit=0 lines=3");
    expect(out).toContain(logPath);
    expect(out).toContain("done");
    // The whole point: hundreds of spec:trace lines must not surface on a green run.
    expect(out).not.toMatch(/matches/);
  });

  it("prints the match section on a red run", () => {
    const lines = [...Array.from({ length: 100 }, (_, i) => `noise ${String(i)}`), "Error: boom"];
    const out = renderSummary(scan(lines), { exitCode: 2, logPath, summaryOnly: false, forceMatch: false });
    expect(out).toContain("exit=2");
    expect(out).toContain("Error: boom");
  });

  it("prints matches on a green run when --match was explicit", () => {
    // The match must sit outside the tail window, or dedup removes it correctly.
    const lines = ["deprecated thing", ...Array.from({ length: 100 }, (_, i) => `ok ${String(i)}`)];
    const result = scan(lines, { matchPattern: /deprecated/i });
    const out = renderSummary(result, { exitCode: 0, logPath, summaryOnly: false, forceMatch: true });
    expect(out).toMatch(/matches/);
    expect(out).toContain("deprecated thing");
  });

  it("caps the match section and reports how many more are in the log", () => {
    const lines = Array.from({ length: 412 }, (_, i) => `error number ${String(i + 1)}`);
    const out = renderSummary(scan(lines), { exitCode: 1, logPath, summaryOnly: false, forceMatch: false });
    expect(out).toMatch(/more matching lines in log/);
    expect(out).toContain("412");
  });

  it("does not repeat a match that is already visible in the tail", () => {
    const out = renderSummary(scan(["Error: only failure"]), {
      exitCode: 1,
      logPath,
      summaryOnly: false,
      forceMatch: false,
    });
    // One line long, so the tail already shows it; the match section adds nothing.
    expect(out.match(/Error: only failure/g)).toHaveLength(1);
  });

  it("omits both sections under --summary-only", () => {
    const out = renderSummary(scan(["Error: boom", "tail line"]), {
      exitCode: 1,
      logPath,
      summaryOnly: true,
      forceMatch: false,
    });
    expect(out).toContain("exit=1");
    expect(out).not.toContain("tail line");
    expect(out).not.toContain("Error: boom");
  });

  it("always names the log path, so a truncated summary stays actionable", () => {
    const out = renderSummary(scan(["x"]), { exitCode: 0, logPath, summaryOnly: true, forceMatch: false });
    expect(out).toContain(logPath);
  });

  describe("the 3KB budget", () => {
    const budgetOf = (out: string) => Buffer.byteLength(out, "utf8");

    it("holds against a log of very long lines", () => {
      const lines = Array.from({ length: 2000 }, () => "e".repeat(5000));
      const out = renderSummary(scan(lines), { exitCode: 1, logPath, summaryOnly: false, forceMatch: false });
      expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
      expect(out).toContain("[truncated]");
    });

    it("holds when --tail asks for far more than fits", () => {
      const lines = Array.from({ length: 5000 }, (_, i) => `line ${String(i)} ${"x".repeat(200)}`);
      const result = scan(lines, { tailLines: 4000 });
      const out = renderSummary(result, { exitCode: 0, logPath, summaryOnly: false, forceMatch: false });
      expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
    });

    it("holds for multi-byte output", () => {
      const lines = Array.from({ length: 500 }, () => "✗ ");
      const out = renderSummary(scan(lines), { exitCode: 1, logPath, summaryOnly: false, forceMatch: false });
      expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
    });

    it("drops the match section before the tail when trimming", () => {
      const lines = Array.from({ length: 400 }, (_, i) => `error ${String(i)} ${"y".repeat(300)}`);
      const out = renderSummary(scan(lines), { exitCode: 1, logPath, summaryOnly: false, forceMatch: false });
      expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
      expect(out).toContain("exit=1");
    });

    // The log path is environment-derived, so nothing bounds its length. Both
    // the `--summary-only` branch and the fully trimmed fallback return the
    // header without going through the trimming loops, so each has to fit the
    // header itself — and must keep the file name, or the log is unfindable.
    describe("an unbounded log path", () => {
      const basename = "pnpm-spec-trace-20260921T101530Z.log";
      const longPath = `/jobs/${"deeply-nested-directory/".repeat(300)}${basename}`;

      it("holds under --summary-only", () => {
        const out = renderSummary(scan(["x"]), {
          exitCode: 0,
          logPath: longPath,
          summaryOnly: true,
          forceMatch: false,
        });
        expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
        expect(out).toContain(basename);
      });

      it("holds in the fully trimmed fallback, and still names the log file", () => {
        const lines = Array.from({ length: 400 }, (_, i) => `error ${String(i)} ${"y".repeat(3000)}`);
        const out = renderSummary(scan(lines), {
          exitCode: 1,
          logPath: longPath,
          summaryOnly: false,
          forceMatch: false,
        });
        expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
        expect(out).toContain(basename);
        expect(out).toContain("[truncated]");
      });

      it("cuts the path on a character boundary rather than mid-sequence", () => {
        const out = renderSummary(scan(["x"]), {
          exitCode: 0,
          logPath: `/jobs/${"ü".repeat(4000)}/gate.log`,
          summaryOnly: true,
          forceMatch: false,
        });
        expect(budgetOf(out)).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
        expect(out).not.toContain("�");
      });
    });
  });
});

describe("summaryBudget", () => {
  // The supported entry point is `pnpm quiet`, and pnpm echoes `$ <script>`
  // before the run and an `[ELIFECYCLE]` line after a red one. Both land in the
  // same tool result as the summary, so they come out of the budget rather than
  // sitting on top of it.
  const script = "tsx src/dev/quiet.ts -- pnpm spec:trace";

  it("keeps the whole budget when the wrapper is run directly", () => {
    expect(summaryBudget({})).toBe(STDOUT_BUDGET_BYTES);
    expect(summaryBudget({ npm_lifecycle_script: "" })).toBe(STDOUT_BUDGET_BYTES);
  });

  it("subtracts what pnpm prints around the summary", () => {
    const echoed = Buffer.byteLength(`$ ${script}\n`, "utf8");
    expect(summaryBudget({ npm_lifecycle_script: script })).toBe(
      STDOUT_BUDGET_BYTES - echoed - 48,
    );
  });

  it("holds the total under the ceiling for a real invocation", () => {
    const budget = summaryBudget({ npm_lifecycle_script: script });
    const lines = Array.from({ length: 900 }, (_, i) => `error ${String(i)} ${"z".repeat(400)}`);
    const out = renderSummary(scan(lines), {
      exitCode: 1,
      logPath: "/fake/logs/pnpm-spec-trace-20260921T101530Z.log",
      summaryOnly: false,
      forceMatch: false,
      budgetBytes: budget,
    });
    const total =
      Buffer.byteLength(out, "utf8") +
      Buffer.byteLength(`$ ${script}\n`, "utf8") +
      Buffer.byteLength("[ELIFECYCLE] Command failed with exit code 1.\n", "utf8");
    expect(total).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
  });

  it("still leaves the summary room when the echoed script is absurdly long", () => {
    expect(summaryBudget({ npm_lifecycle_script: "x".repeat(10_000) })).toBeGreaterThan(0);
  });
});

describe("renderErrorLine", () => {
  const script = "tsx src/dev/quiet.ts -- pnpm spec:trace";

  it("passes a short message through untouched", () => {
    expect(renderErrorLine("No command given.", STDOUT_BUDGET_BYTES)).toBe("No command given.\n");
  });

  // The failure path is where the unbounded text lives: Node quotes a rejected
  // pattern back in full, so an invalid `--match` used to print whatever the
  // caller typed.
  it("holds a quoted-back invalid pattern under the ceiling", () => {
    let message = "";
    try {
      new RegExp("(".repeat(4000), "i");
    } catch (err) {
      message = `--match is not a valid regular expression: ${(err as Error).message}`;
    }
    expect(Buffer.byteLength(`${message}\n`, "utf8")).toBeGreaterThan(STDOUT_BUDGET_BYTES);

    const budget = summaryBudget({ npm_lifecycle_script: script });
    const out = renderErrorLine(message, budget);
    const total =
      Buffer.byteLength(out, "utf8") +
      Buffer.byteLength(`$ ${script}\n`, "utf8") +
      Buffer.byteLength("[ELIFECYCLE] Command failed with exit code 2.\n", "utf8");
    expect(total).toBeLessThanOrEqual(STDOUT_BUDGET_BYTES);
    expect(out.startsWith("--match is not a valid regular expression:")).toBe(true);
    expect(out.endsWith("…\n")).toBe(true);
  });

  // `$TMPDIR` and `$CLAUDE_JOB_DIR` carry no length bound, so the log-open
  // failure could print a path longer than the whole budget.
  it("holds an environment-derived log path under the ceiling", () => {
    const logPath = `${"/deeply/nested".repeat(400)}/run.log`;
    const budget = summaryBudget({ npm_lifecycle_script: script });
    const out = renderErrorLine(`quiet: cannot write a log to ${logPath}: EACCES`, budget);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(budget);
    expect(out.startsWith("quiet: cannot write a log to ")).toBe(true);
  });

  it("never cuts a multi-byte character in half", () => {
    const out = renderErrorLine("🚀".repeat(100), 10);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(10);
    expect(out).not.toContain("�");
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });

  it("drops the ellipsis rather than the message when the budget is tiny", () => {
    expect(renderErrorLine("cannot write", 5)).toBe("c…\n");
    // Below the ellipsis's own cost, the opening words are all there is to keep.
    const out = renderErrorLine("cannot write", 3);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3);
    expect(out).toBe("ca\n");
  });

  it("prints nothing at all rather than overrunning a zero budget", () => {
    expect(renderErrorLine("cannot write", 0)).toBe("");
  });
});
