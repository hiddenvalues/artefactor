/**
 * Run a command, keep its output on disk, and print a fixed-size summary.
 *
 * Gate commands are the loudest thing an agent session runs, and a tool result
 * is not read once — it stays in the conversation for every later call in that
 * session. A green `pnpm test` is quiet, but a red one prints every failing
 * assertion's diff, `pnpm spec:trace` prints ~26KB on a passing run, and a CI
 * job log runs to hundreds of kilobytes. Piping through `tail` or `grep` by hand
 * works, but only when the agent remembers to. This makes it the default.
 *
 * Usage:
 *   pnpm quiet -- <command…>
 *   pnpm quiet -- --tail 40 --match 'TS[0-9]+' -- pnpm check
 *
 * Flags (before the command; everything after the command word belongs to it):
 *   --tail N          lines of tail to show (default 15, max 3072)
 *   --match <regex>   failure pattern; also forces the section on a green run
 *   --match-limit N   most matching lines to show (default 30, max 3072)
 *   --summary-only    print the one-line verdict and nothing else
 *
 * The exit code is the wrapped command's own, so `&&` chains and gate logic are
 * unaffected. A `pnpm quiet` invocation never emits more than 3KB in total —
 * pnpm's own `$ …` and `[ELIFECYCLE]` lines are counted against that ceiling,
 * not added on top of it — whatever the flags say. That ceiling is the feature;
 * the log file holds everything else and its path is always printed.
 *
 * Reading discipline: on green, read nothing else. On red, `grep -n` the log for
 * the failing check, then `sed -n` that range. Never `cat` the log.
 *
 * The `quiet` root package script runs this entry via `tsx`. The reading rules
 * agents follow are in the root CLAUDE.md, under *Commands*.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
} from "node:fs";
import * as path from "node:path";

import {
  decodeLines,
  exitCodeFrom,
  logDirectory,
  logFileName,
  parseArgs,
  renderErrorLine,
  renderSummary,
  scanLines,
  summaryBudget,
} from "./quiet-core";

const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Owner-only. The log holds the wrapped command's complete stdout and stderr,
 * and the default mode under a permissive umask leaves that readable by every
 * local user of a shared `$TMPDIR`.
 */
const LOG_FILE_MODE = 0o600;

/**
 * Yield the file's bytes a chunk at a time, without holding it in memory. The
 * log can be hundreds of kilobytes — buffering it here to summarise it would
 * defeat the point. Turning the chunks into lines is `decodeLines`' job, which
 * is where the UTF-8 boundary handling lives and can be tested.
 */
function* readChunks(filePath: string): Generator<Uint8Array> {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(READ_CHUNK_BYTES);
    for (;;) {
      const read = readSync(fd, buffer, 0, READ_CHUNK_BYTES, null);
      if (read === 0) break;
      // Safe to hand out a view of the reused buffer: `decodeLines` decodes the
      // chunk into a string before this generator is resumed for the next read.
      yield buffer.subarray(0, read);
    }
  } finally {
    closeSync(fd);
  }
}

function main(): void {
  // Both early failures print unbounded text of their own — a rejected `--match`
  // is quoted back in full, and the log path comes from the environment — so
  // both are fitted to the same ceiling the summary answers to.
  const budget = summaryBudget(process.env);

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(renderErrorLine((err as Error).message, budget));
    process.exit(2);
  }

  const directory = logDirectory(process.env);
  const logPath = path.join(
    directory,
    logFileName(args.command, new Date(), randomBytes(3).toString("hex")),
  );
  let fd: number;
  try {
    // Owner-only, to match the log's own mode. This applies to the directory the
    // wrapper creates under `$CLAUDE_JOB_DIR`; a pre-existing `$TMPDIR` keeps
    // whatever the system gave it, which is why the file name carries no
    // argument text.
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // `wx` rather than `w`: with the random suffix a collision should be
    // impossible, and if one ever happens it must fail loudly rather than
    // truncate a concurrent run's log out from under it.
    fd = openSync(logPath, "wx", LOG_FILE_MODE);
  } catch (err) {
    // Without a log there is nothing to summarise from, and silently swallowing
    // the command's output would be worse than running it plainly.
    process.stderr.write(
      renderErrorLine(`quiet: cannot write a log to ${logPath}: ${(err as Error).message}`, budget),
    );
    process.exit(2);
  }

  const [binary = "", ...rest] = args.command;
  // One fd for both streams, so stdout and stderr interleave in real order and
  // nothing is buffered in this process while the command runs.
  const result = spawnSync(binary, rest, { stdio: ["inherit", fd, fd] });
  closeSync(fd);

  if (result.error !== undefined) {
    appendFileSync(logPath, `quiet: ${result.error.message}\n`);
  }

  const exitCode = exitCodeFrom({ status: result.status, signal: result.signal });
  const scan = scanLines(decodeLines(readChunks(logPath)), {
    tailLines: args.tailLines,
    matchLimit: args.matchLimit,
    matchPattern: args.matchPattern,
  });

  process.stdout.write(
    renderSummary(scan, {
      exitCode,
      logPath,
      summaryOnly: args.summaryOnly,
      forceMatch: args.forceMatch,
      budgetBytes: budget,
    }),
  );
  process.exit(exitCode);
}

main();
