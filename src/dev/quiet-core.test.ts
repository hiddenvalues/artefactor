import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCH_LIMIT,
  DEFAULT_TAIL_LINES,
  MAX_SHOWN_LINES,
  commandSlug,
  decodeLines,
  exitCodeFrom,
  logDirectory,
  logFileName,
  parseArgs,
  scanLines,
} from "./quiet-core";

/** A scan of `lines` under the default options, for tests that only vary the log body. */
function scan(lines: string[], overrides: Partial<Parameters<typeof scanLines>[1]> = {}) {
  const { matchPattern, tailLines, matchLimit } = parseArgs(["true"]);
  return scanLines(lines, { matchPattern, tailLines, matchLimit, ...overrides });
}

describe("parseArgs", () => {
  it("treats the first non-flag token as the start of the command", () => {
    const args = parseArgs(["--tail", "5", "pnpm", "test", "--filter", "@artefactor/ee"]);
    expect(args.tailLines).toBe(5);
    expect(args.command).toEqual(["pnpm", "test", "--filter", "@artefactor/ee"]);
  });

  it("does not consume flags that belong to the wrapped command", () => {
    // `--summary-only` here sits after the command word, so it is the command's.
    const args = parseArgs(["pnpm", "lint", "--summary-only"]);
    expect(args.summaryOnly).toBe(false);
    expect(args.command).toEqual(["pnpm", "lint", "--summary-only"]);
  });

  it("honours an explicit -- separator", () => {
    const args = parseArgs(["--summary-only", "--", "--weird-binary", "-x"]);
    expect(args.summaryOnly).toBe(true);
    expect(args.command).toEqual(["--weird-binary", "-x"]);
  });

  // `pnpm run quiet -- …` forwards the separator instead of consuming it, so
  // every invocation through the package script arrives with a leading `--`.
  describe("the separator pnpm forwards", () => {
    it("still reads the flags that follow it", () => {
      const args = parseArgs(["--", "--summary-only", "--", "pnpm", "test"]);
      expect(args.summaryOnly).toBe(true);
      expect(args.command).toEqual(["pnpm", "test"]);
    });

    it("leaves a plain command untouched", () => {
      expect(parseArgs(["--", "pnpm", "lint"]).command).toEqual(["pnpm", "lint"]);
    });

    it("still lets a second -- protect a dash-named command", () => {
      expect(parseArgs(["--", "--", "--weird-binary", "-x"]).command).toEqual([
        "--weird-binary",
        "-x",
      ]);
    });
  });

  it("records that --match was given so a green run still prints matches", () => {
    expect(parseArgs(["true"]).forceMatch).toBe(false);
    const args = parseArgs(["--match", "deprecated", "true"]);
    expect(args.forceMatch).toBe(true);
    expect(args.matchPattern.test("a deprecated thing")).toBe(true);
  });

  it("defaults tail and match limits", () => {
    const args = parseArgs(["true"]);
    expect(args.tailLines).toBe(DEFAULT_TAIL_LINES);
    expect(args.matchLimit).toBe(DEFAULT_MATCH_LIMIT);
  });

  it("rejects an empty command", () => {
    expect(() => parseArgs([])).toThrow(/command/i);
    expect(() => parseArgs(["--tail", "5"])).toThrow(/command/i);
  });

  it("rejects a non-numeric or negative --tail", () => {
    expect(() => parseArgs(["--tail", "abc", "true"])).toThrow(/--tail/);
    expect(() => parseArgs(["--tail", "-2", "true"])).toThrow(/--tail/);
  });

  // A displayed line costs at least its newline, so the budget can never hold
  // more than STDOUT_BUDGET_BYTES of them. Above that the request is
  // unsatisfiable, and honouring it only makes scanLines retain a tail nothing
  // can print and renderSummary reassemble the summary once per dropped line.
  it("rejects a line count the budget could never print", () => {
    expect(() => parseArgs(["--tail", "1000000", "true"])).toThrow(/--tail/);
    expect(() => parseArgs(["--match-limit", "1000000", "true"])).toThrow(/--match-limit/);
    expect(parseArgs(["--tail", String(MAX_SHOWN_LINES), "true"]).tailLines).toBe(MAX_SHOWN_LINES);
    expect(parseArgs(["--match-limit", String(MAX_SHOWN_LINES), "true"]).matchLimit).toBe(
      MAX_SHOWN_LINES,
    );
    expect(() => parseArgs(["--tail", String(MAX_SHOWN_LINES + 1), "true"])).toThrow(/--tail/);
  });

  it("rejects an invalid --match regex rather than silently matching nothing", () => {
    expect(() => parseArgs(["--match", "[unclosed", "true"])).toThrow(/--match/);
  });

  it("rejects a wrapper flag or the separator as the --match operand", () => {
    // Compiling `--summary-only` as the pattern would then eat the `--` as the
    // separator and leave summary-only quietly off.
    expect(() => parseArgs(["--match", "--summary-only", "--", "pnpm", "lint"])).toThrow(/--match/);
    expect(() => parseArgs(["--match", "--", "pnpm", "lint"])).toThrow(/--match/);
  });

  it("still accepts a dash-prefixed pattern, which is a valid regex", () => {
    const args = parseArgs(["--match", "-foo", "true"]);
    expect(args.matchPattern.test("a -foo line")).toBe(true);
    expect(args.command).toEqual(["true"]);
  });
});

describe("the default failure pattern", () => {
  const { matchPattern } = parseArgs(["true"]);

  it("matches the shapes gate tools actually emit", () => {
    expect(matchPattern.test("Error: boom")).toBe(true);
    expect(matchPattern.test("1 test failed")).toBe(true);
    expect(matchPattern.test("✗ typecheck")).toBe(true);
    expect(matchPattern.test("warning: stale annotation")).toBe(true);
  });

  it("does not match words that merely contain them", () => {
    expect(matchPattern.test("terrorism")).toBe(false);
    expect(matchPattern.test("failsafe mode")).toBe(false);
  });
});

describe("decodeLines", () => {
  /** The bytes of `text`, cut at `at` — the boundary a 64KB read would land on. */
  function chunksCutAt(text: string, at: number): Uint8Array[] {
    const buffer = Buffer.from(text, "utf8");
    return [buffer.subarray(0, at), buffer.subarray(at)];
  }

  it("preserves a character split across a read boundary", () => {
    // "före" is f | ö (two bytes) | r | e, so byte 2 lands inside the ö. Decoding
    // each chunk on its own turns both halves into replacement characters.
    const chunks = chunksCutAt("före\nefter\n", 2);
    expect([...decodeLines(chunks)]).toEqual(["före", "efter"]);
  });

  it("preserves a four-byte character split across a read boundary", () => {
    const chunks = chunksCutAt("✗ 𝄞 failed\n", 6);
    expect([...decodeLines(chunks)]).toEqual(["✗ 𝄞 failed"]);
  });

  it("keeps an explicit --match on a non-ASCII diagnostic matchable", () => {
    const chunks = chunksCutAt("ok\nkörning misslyckades\n", 5);
    const result = scanLines(decodeLines(chunks), {
      matchPattern: /misslyckades/i,
      tailLines: 1,
      matchLimit: 5,
    });
    expect(result.matchTotal).toBe(1);
    expect(result.matches[0]?.text).toBe("körning misslyckades");
  });

  it("yields a final line that has no trailing newline", () => {
    expect([...decodeLines([Buffer.from("a\nb", "utf8")])]).toEqual(["a", "b"]);
  });

  it("yields nothing for an empty stream", () => {
    expect([...decodeLines([])]).toEqual([]);
    expect([...decodeLines([Buffer.alloc(0)])]).toEqual([]);
  });
});

describe("scanLines", () => {
  it("counts every line while keeping only the tail", () => {
    const result = scan(Array.from({ length: 500 }, (_, i) => `line ${String(i + 1)}`));
    expect(result.totalLines).toBe(500);
    expect(result.tail).toHaveLength(DEFAULT_TAIL_LINES);
    expect(result.tail.at(-1)).toBe("line 500");
    expect(result.tail[0]).toBe("line 486");
  });

  it("keeps the earliest matches and counts all of them", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `error ${String(i + 1)}`);
    const result = scan(lines);
    expect(result.matchTotal).toBe(200);
    expect(result.matches).toHaveLength(DEFAULT_MATCH_LIMIT);
    expect(result.matches[0]).toEqual({ line: 1, text: "error 1" });
  });

  it("handles a log shorter than the tail window", () => {
    const result = scan(["only line"]);
    expect(result.totalLines).toBe(1);
    expect(result.tail).toEqual(["only line"]);
  });

  it("handles an empty log", () => {
    const result = scan([]);
    expect(result.totalLines).toBe(0);
    expect(result.tail).toEqual([]);
    expect(result.matchTotal).toBe(0);
  });
});


describe("exitCodeFrom", () => {
  it("passes a normal exit code through", () => {
    expect(exitCodeFrom({ status: 0, signal: null })).toBe(0);
    expect(exitCodeFrom({ status: 2, signal: null })).toBe(2);
  });

  it("maps a signal to 128+signum the way a shell does", () => {
    expect(exitCodeFrom({ status: null, signal: "SIGKILL" })).toBe(137);
    expect(exitCodeFrom({ status: null, signal: "SIGTERM" })).toBe(143);
  });

  it("reports a failure to spawn at all as 1, never as success", () => {
    expect(exitCodeFrom({ status: null, signal: null })).toBe(1);
  });

  it("does not report an unknown signal as success", () => {
    expect(exitCodeFrom({ status: null, signal: "SIGNOPE" })).toBe(1);
  });
});

describe("logDirectory", () => {
  it("prefers CLAUDE_JOB_DIR so parallel background jobs cannot collide", () => {
    expect(logDirectory({ CLAUDE_JOB_DIR: "/jobs/a7", TMPDIR: "/fake/tmpdir" })).toBe("/jobs/a7/tmp");
  });

  it("falls back to TMPDIR", () => {
    expect(logDirectory({ TMPDIR: "/fake/tmpdir" })).toBe("/fake/tmpdir");
  });

  it("falls back to the OS temp dir when neither is set", () => {
    expect(logDirectory({})).toBe(tmpdir());
  });

  it("ignores an empty CLAUDE_JOB_DIR", () => {
    expect(logDirectory({ CLAUDE_JOB_DIR: "", TMPDIR: "/fake/tmpdir" })).toBe("/fake/tmpdir");
  });
});

describe("commandSlug", () => {
  it("names the tool that produced the run", () => {
    expect(commandSlug(["pnpm", "spec:trace"])).toBe("pnpm");
  });

  it("strips a path prefix from the binary", () => {
    expect(commandSlug(["/usr/local/bin/pnpm", "lint"])).toBe("pnpm");
  });

  // A file name is not covered by the log's 0o600 mode: anyone who can list a
  // shared $TMPDIR reads it, and it outlives the run. Arguments are where
  // secrets travel, so none of them reaches the name.
  it("keeps every argument out of the name, whatever it carries", () => {
    expect(commandSlug(["curl", "--token=s3cret", "https://api.example/x?key=s3cret"])).toBe(
      "curl",
    );
    expect(commandSlug(["psql", "postgres://user:s3cret@host/db"])).toBe("psql");
    expect(commandSlug(["pnpm", "test", "--filter", "@artefactor/ee"])).toBe("pnpm");
  });

  it("replaces characters that are not safe in a filename", () => {
    expect(commandSlug(["./weird name+v2"])).not.toMatch(/[/+ ]/);
  });

  it("stays short enough for any filesystem", () => {
    expect(commandSlug(["segment".repeat(40)]).length).toBeLessThanOrEqual(60);
  });

  it("never yields an empty slug", () => {
    expect(commandSlug(["///"])).not.toBe("");
  });
});

describe("logFileName", () => {
  const sameSecond = new Date("2026-09-21T10:15:30.000Z");

  it("carries the slug and a sortable timestamp", () => {
    expect(logFileName(["pnpm", "lint"], sameSecond, "4f1a9c")).toBe(
      "pnpm-20260921T101530Z-4f1a9c.log",
    );
  });

  // The timestamp is second-resolution, and parallel background jobs really do
  // start the same gate within one second. Without the suffix both runs open the
  // same path and one truncates the other's log.
  it("separates two runs of the same command in the same second", () => {
    expect(logFileName(["pnpm", "lint"], sameSecond, "4f1a9c")).not.toBe(
      logFileName(["pnpm", "lint"], sameSecond, "b70e22"),
    );
  });
});
