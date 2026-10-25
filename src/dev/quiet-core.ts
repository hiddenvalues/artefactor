/**
 * Pure logic for the `quiet` wrapper. Kept free of I/O so the output budget and
 * the line-selection rules can be unit-tested; the CLI entry (quiet.ts) does the
 * spawning and the file writing.
 *
 * Why this exists: a tool result is not read once — it stays in the
 * conversation for every later call in that session, so a 40KB gate log read
 * early in a long session is re-read hundreds of times.
 *
 * The contract that makes this work is the budget, not the formatting: an
 * invocation never emits more than {@link STDOUT_BUDGET_BYTES} in total,
 * whatever the flags say — including what the package-manager entry point
 * prints around the summary, which {@link summaryBudget} subtracts. Everything
 * else is recoverable from the log file, whose path is always printed.
 */
import { constants, tmpdir } from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";

/** Hard ceiling on everything an invocation prints. No flag raises it. */
export const STDOUT_BUDGET_BYTES = 3072;

export const DEFAULT_TAIL_LINES = 15;
export const DEFAULT_MATCH_LIMIT = 30;

/**
 * Most lines `--tail` or `--match-limit` may ask for.
 *
 * Not a guess and not a defence against anyone: a displayed line costs at least
 * the newline that ends it, so the budget cannot hold more than
 * {@link STDOUT_BUDGET_BYTES} lines however the flags are set. A larger figure
 * is unsatisfiable by construction, and the wrapper refuses it for the same
 * reason no flag raises the ceiling. Bounding the request also keeps
 * {@link scanLines}' retained tail finite and stops {@link renderSummary}'s
 * one-entry-at-a-time trim loop, which reassembles the summary per dropped
 * line, from being asked to do so a million times.
 *
 * It carries its own value rather than aliasing {@link STDOUT_BUDGET_BYTES}: the
 * two share a number for the reason above, but one counts lines and the other
 * bytes, and an alias both conflates the units and reads as a duplicate export.
 */
export const MAX_SHOWN_LINES = 3072;

/**
 * Per-line display width. A single 5,000-character line would otherwise consume
 * the whole budget on its own and crowd out every other line, so each displayed
 * line is cut here and the full text stays in the log.
 */
const MAX_LINE_CHARS = 160;

const MAX_SLUG_CHARS = 60;

/**
 * The shapes gate tools actually use to report trouble. Word-bounded so
 * "terrorism" and "failsafe" do not register as failures; `warning:` keeps its
 * colon because a bare "warning" matches far too much prose.
 */
const DEFAULT_FAILURE_PATTERN =
  /(?:\berrors?\b|\bfail(?:s|ed|ure|ures|ing)?\b|[✗✖]|\bwarning:)/i;

export interface ParsedArgs {
  tailLines: number;
  matchLimit: number;
  matchPattern: RegExp;
  summaryOnly: boolean;
  /** True when `--match` was given explicitly, which prints matches even on a green run. */
  forceMatch: boolean;
  command: string[];
}

/**
 * Split the wrapper's own flags from the command to run.
 *
 * Flags are recognised only *before* the command word: `pnpm quiet -- pnpm lint
 * --summary-only` passes `--summary-only` to `pnpm lint`, which is the only
 * reading that lets the wrapper front any command without stealing its flags. An
 * explicit `--` forces the split for a command whose own name starts with a dash.
 */
/** The wrapper's own words, which can never be the operand of one of its flags. */
const WRAPPER_WORDS = new Set(["--", "--summary-only", "--tail", "--match", "--match-limit"]);

export function parseArgs(argv: string[]): ParsedArgs {
  let tailLines = DEFAULT_TAIL_LINES;
  let matchLimit = DEFAULT_MATCH_LIMIT;
  let matchPattern = DEFAULT_FAILURE_PATTERN;
  let summaryOnly = false;
  let forceMatch = false;
  let i = 0;

  const count = (flag: string, raw: string | undefined): number => {
    const n = Number(raw);
    if (raw === undefined || !Number.isInteger(n) || n < 0 || n > MAX_SHOWN_LINES) {
      throw new Error(`${flag} requires an integer between 0 and ${String(MAX_SHOWN_LINES)}`);
    }
    return n;
  };

  // `pnpm quiet -- …` forwards that `--` rather than eating it, so the wrapper
  // sees it as its own first token. Treating it as the separator would end flag
  // parsing before it began and make `pnpm quiet -- --summary-only -- pnpm test`
  // try to run `--summary-only`; skipping it instead leaves both documented
  // forms working, and a command whose own name starts with a dash is still
  // reachable through a second `--`.
  if (argv[0] === "--") i = 1;

  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      i++;
      break;
    } else if (a === "--summary-only") {
      summaryOnly = true;
    } else if (a === "--tail") {
      tailLines = count("--tail", argv[++i]);
    } else if (a === "--match-limit") {
      matchLimit = count("--match-limit", argv[++i]);
    } else if (a === "--match") {
      const raw = argv[++i];
      // `--match --summary-only -- pnpm lint` otherwise compiles the flag as the
      // pattern and then eats the separator, silently leaving --summary-only off.
      // Only the wrapper's own words are rejected: `-foo` is a valid regex.
      if (raw === undefined || WRAPPER_WORDS.has(raw)) {
        throw new Error("--match requires a regular expression");
      }
      try {
        matchPattern = new RegExp(raw, "i");
      } catch (err) {
        throw new Error(`--match is not a valid regular expression: ${(err as Error).message}`, {
          cause: err,
        });
      }
      forceMatch = true;
    } else {
      break; // the command starts here
    }
  }

  const command = argv.slice(i);
  if (command.length === 0) throw new Error("No command given. Usage: quiet [flags] -- <command…>");
  return { tailLines, matchLimit, matchPattern, summaryOnly, forceMatch, command };
}

interface MatchedLine {
  /** 1-based line number in the log file. */
  line: number;
  text: string;
}

export interface LogScan {
  totalLines: number;
  /** The last `tailLines` lines, in order. */
  tail: string[];
  /** The *earliest* matches, capped at `matchLimit` — the first failure explains the rest. */
  matches: MatchedLine[];
  /** How many lines matched in total, which is what the trailer counts against. */
  matchTotal: number;
}

/**
 * Split a byte stream into lines.
 *
 * One `StringDecoder` spans the whole stream rather than one decode per chunk:
 * a multi-byte character straddling a read boundary would otherwise become
 * replacement characters on both sides of it, so an explicit `--match` on a
 * non-ASCII diagnostic would miss the line and the tail would show damage the
 * log itself does not have. The decoder holds the incomplete sequence back
 * until the bytes that finish it arrive.
 *
 * Each chunk is decoded before the next is pulled, so a caller reading into one
 * reused buffer is safe.
 */
export function* decodeLines(chunks: Iterable<Uint8Array>): Generator<string> {
  const decoder = new StringDecoder("utf8");
  let carry = "";
  for (const chunk of chunks) {
    const text = carry + decoder.write(chunk);
    const lines = text.split("\n");
    carry = lines.pop() ?? "";
    yield* lines;
  }
  // Whatever the decoder still holds is an incomplete sequence at EOF, which
  // cannot be a newline, so it only ever extends the last line.
  carry += decoder.end();
  if (carry !== "") yield carry;
}

export interface ScanOptions {
  tailLines: number;
  matchLimit: number;
  matchPattern: RegExp;
}

/**
 * Walk the log once, keeping only a tail ring buffer and a capped match list, so
 * memory stays flat whatever the log's size.
 */
export function scanLines(lines: Iterable<string>, options: ScanOptions): LogScan {
  const tail: string[] = [];
  const matches: MatchedLine[] = [];
  let totalLines = 0;
  let matchTotal = 0;

  for (const text of lines) {
    totalLines++;
    if (options.tailLines > 0) {
      tail.push(text);
      if (tail.length > options.tailLines) tail.shift();
    }
    if (options.matchPattern.test(text)) {
      matchTotal++;
      if (matches.length < options.matchLimit) matches.push({ line: totalLines, text });
    }
  }

  return { totalLines, tail, matches, matchTotal };
}

export interface RenderOptions {
  exitCode: number;
  logPath: string;
  summaryOnly: boolean;
  forceMatch: boolean;
  /**
   * Bytes this summary may occupy. Defaults to the full {@link STDOUT_BUDGET_BYTES};
   * the CLI passes a smaller figure so that what the package-manager entry point
   * prints around the wrapper fits inside the same ceiling.
   */
  budgetBytes?: number;
}

function clip(text: string): { text: string; clipped: boolean } {
  const flat = text.replace(/\s+$/, "");
  if (flat.length <= MAX_LINE_CHARS) return { text: flat, clipped: false };
  return { text: `${flat.slice(0, MAX_LINE_CHARS)}…`, clipped: true };
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

const ELLIPSIS = "…";

const TRUNCATION_MARKER = "[truncated] — full output in the log above";

/**
 * The last `maxBytes` bytes of `text`, cut on a code-point boundary so the
 * result is never a half-written UTF-8 sequence.
 */
function suffixWithinBytes(text: string, maxBytes: number): string {
  const chars = [...text];
  let used = 0;
  let start = chars.length;
  while (start > 0) {
    const size = bytes(chars[start - 1] ?? "");
    if (used + size > maxBytes) break;
    used += size;
    start--;
  }
  return chars.slice(start).join("");
}

/**
 * `exit=… lines=… log=…`, fitted to `maxBytes`.
 *
 * The log path comes from `$CLAUDE_JOB_DIR` or `$TMPDIR` and so carries no
 * length bound of its own, yet it is the one part of the summary that has to
 * survive trimming — it is how the full output is recovered. An overlong path
 * is therefore cut from the left behind an ellipsis, keeping the file name
 * rather than dropping the path or letting it push the header past the budget.
 */
function renderHeader(
  exitCode: number,
  totalLines: number,
  logPath: string,
  maxBytes: number,
): string {
  const prefix = `exit=${String(exitCode)} lines=${String(totalLines)} log=`;
  const full = `${prefix}${logPath}`;
  if (bytes(full) <= maxBytes) return full;
  const room = maxBytes - bytes(prefix) - bytes(ELLIPSIS);
  // A budget too small even for the prefix leaves nothing to preserve but the
  // tail of the path itself, which is still the most actionable thing here.
  if (room <= 0) return suffixWithinBytes(full, maxBytes);
  return `${prefix}${ELLIPSIS}${suffixWithinBytes(logPath, room)}`;
}

/** `[ELIFECYCLE] Command failed with exit code 255.` plus its newline. */
const ELIFECYCLE_LINE_BYTES = 48;

/** However costly the entry point, the summary keeps at least this much room. */
const MIN_SUMMARY_BYTES = 256;

/**
 * How many bytes the summary itself may use, given what the entry point will
 * print around it.
 *
 * The supported entry point is the `quiet` package script, and `pnpm run` is not
 * silent: it echoes `$ <script>` before running and, on a non-zero exit, adds an
 * `[ELIFECYCLE]` line after. Both land in the same tool result as the summary,
 * so a ceiling that counted only the wrapper's own writes would not be the
 * ceiling an agent actually pays. `npm_lifecycle_script` holds exactly the text
 * pnpm echoes, so the cost is measured rather than guessed; a direct `tsx
 * src/dev/quiet.ts` run sets no such variable and keeps the whole budget.
 */
export function summaryBudget(env: NodeJS.ProcessEnv): number {
  const script = env.npm_lifecycle_script;
  if (script === undefined || script === "") return STDOUT_BUDGET_BYTES;
  const overhead = bytes(`$ ${script}\n`) + ELIFECYCLE_LINE_BYTES;
  return Math.max(MIN_SUMMARY_BYTES, STDOUT_BUDGET_BYTES - overhead);
}

/**
 * The first `maxBytes` bytes of `text`, cut on a code-point boundary so the
 * result is never a half-written UTF-8 sequence. The counterpart to
 * {@link suffixWithinBytes}, for text whose front is the part worth keeping.
 */
function prefixWithinBytes(text: string, maxBytes: number): string {
  let used = 0;
  let end = 0;
  for (const ch of text) {
    const size = bytes(ch);
    if (used + size > maxBytes) break;
    used += size;
    end += ch.length;
  }
  return text.slice(0, end);
}

/**
 * An error line fitted to `maxBytes`, its newline included.
 *
 * The failures that happen before there is anything to summarise — an
 * unparseable flag, a log that cannot be opened — still carry unbounded text:
 * Node quotes a rejected pattern back in full (a 4,000-character `--match`
 * produces a ~4KB message), and the log path is built from `$CLAUDE_JOB_DIR` or
 * `$TMPDIR` and has no length bound at all. The ceiling is the whole contract,
 * and nothing about failing exempts an invocation from it, so these go through
 * the same budget as the summary. An error leads with what went wrong, so it is
 * the head that is kept.
 */
export function renderErrorLine(message: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const line = `${message}\n`;
  if (bytes(line) <= maxBytes) return line;
  const room = maxBytes - bytes(`${ELLIPSIS}\n`);
  // Too tight even for the ellipsis: drop it rather than the message's opening
  // words, which are the only thing that says what failed.
  if (room <= 0) return `${prefixWithinBytes(message, maxBytes - 1)}\n`;
  return `${prefixWithinBytes(message, room)}${ELLIPSIS}\n`;
}

/**
 * Assemble the summary, then fit it to the budget by dropping the match section
 * before the tail — a failing gate's last lines usually name the failing check,
 * whereas the matches are a convenience the log already holds.
 *
 * The match section is suppressed entirely on a green run unless `--match` was
 * explicit. That is deliberate and is the difference between this being useful
 * and being noise: `spec:trace` exits 0 after hundreds of report lines, and
 * printing 30 matches plus a trailer on every green run would reintroduce
 * exactly the reading burden the wrapper exists to remove. On green, the exit
 * code is the evidence.
 */
export function renderSummary(scan: LogScan, options: RenderOptions): string {
  const budget = options.budgetBytes ?? STDOUT_BUDGET_BYTES;
  // The header is fitted once, against the tightest thing it appears in — the
  // final fallback, which prints the header and the truncation marker and
  // nothing else. Every other branch prints that same header with more room
  // left over, so fitting it here is what makes all of them provably within
  // budget, including `--summary-only`, which returns before any trimming.
  const header = renderHeader(
    options.exitCode,
    scan.totalLines,
    options.logPath,
    budget - bytes(`\n${TRUNCATION_MARKER}\n`),
  );
  if (options.summaryOnly) return `${header}\n`;

  let truncated = false;

  const tailBody = scan.tail.map((t) => {
    const c = clip(t);
    truncated ||= c.clipped;
    return c.text;
  });

  // A match already visible in the tail is not worth a second copy. The trailer
  // still counts it, because it is genuinely in the log.
  const tailStartLine = scan.totalLines - scan.tail.length + 1;
  const showMatches = options.forceMatch || options.exitCode !== 0;
  const matchBody = showMatches
    ? scan.matches
        .filter((m) => m.line < tailStartLine)
        .map((m) => {
          const c = clip(m.text);
          truncated ||= c.clipped;
          return `${String(m.line).padStart(6)}: ${c.text}`;
        })
    : [];

  const assemble = (tailKeep: number, matchKeep: number): string => {
    const parts = [header];
    if (tailKeep > 0 && tailBody.length > 0) {
      const shown = tailBody.slice(tailBody.length - tailKeep);
      parts.push(`--- tail ${String(shown.length)}/${String(scan.totalLines)} ---`, ...shown);
    }
    if (matchKeep > 0 && matchBody.length > 0) {
      const shown = matchBody.slice(0, matchKeep);
      parts.push(`--- matches ${String(shown.length)}/${String(scan.matchTotal)} ---`, ...shown);
      const remaining = scan.matchTotal - shown.length;
      if (remaining > 0) parts.push(`… ${String(remaining)} more matching lines in log`);
    }
    const dropped =
      truncated || tailKeep < tailBody.length || (showMatches && matchKeep < matchBody.length);
    if (dropped) parts.push(TRUNCATION_MARKER);
    return `${parts.join("\n")}\n`;
  };

  let out = assemble(tailBody.length, matchBody.length);
  if (bytes(out) <= budget) return out;

  for (let matchKeep = matchBody.length - 1; matchKeep >= 0; matchKeep--) {
    out = assemble(tailBody.length, matchKeep);
    if (bytes(out) <= budget) return out;
  }
  for (let tailKeep = tailBody.length - 1; tailKeep >= 0; tailKeep--) {
    out = assemble(tailKeep, 0);
    if (bytes(out) <= budget) return out;
  }
  // The header alone carries the log path, so even here the run stays actionable.
  return `${header}\n${TRUNCATION_MARKER}\n`;
}

/** Map a finished child process to the exit code a shell would report. */
export function exitCodeFrom(result: { status: number | null; signal: string | null }): number {
  if (result.status !== null) return result.status;
  if (result.signal !== null) {
    const signum = (constants.signals as Record<string, number | undefined>)[result.signal];
    if (signum !== undefined) return 128 + signum;
  }
  // Spawn failed, or the signal is one this platform does not name. Either way
  // the command did not succeed, and reporting 0 here would open every gate.
  return 1;
}

/**
 * Where the log goes. `CLAUDE_JOB_DIR` wins because background jobs run in
 * parallel against a shared `$TMPDIR`, which has produced real collisions.
 * `os.tmpdir()` is only reached when neither is set; the harness always sets
 * `$TMPDIR`, and an unwritable directory surfaces as a clear exit 2 rather than
 * as a silently swallowed command.
 */
export function logDirectory(env: NodeJS.ProcessEnv): string {
  const jobDir = env.CLAUDE_JOB_DIR;
  if (jobDir !== undefined && jobDir !== "") return path.join(jobDir, "tmp");
  const tmp = env.TMPDIR;
  if (tmp !== undefined && tmp !== "") return tmp;
  return tmpdir();
}

/**
 * A filesystem-safe, recognisable stem for the log: `pnpm`, `node`, `docker`.
 *
 * Only the executable's own name goes in. A file name is not protected by the
 * log's `0o600` mode — it is visible to anyone who can list a shared `$TMPDIR`,
 * and it outlives the run — so folding the arguments in would publish whatever
 * the caller passed: `--token=…`, a connection string, a URL carrying a query
 * token. Arguments are where secrets live, and no rule over them is safe enough
 * to be worth the sharper name; a caller identifies its log by the path printed
 * in the summary, not by browsing the directory, so the stem only has to say
 * which tool produced it. The timestamp and the random suffix carry uniqueness.
 */
export function commandSlug(command: string[]): string {
  const [binary = ""] = command;
  const slug = path
    .basename(binary)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "");
  return slug === "" ? "command" : slug;
}

/**
 * `pnpm-20260921T101530Z-4f1a9c.log` — sortable, and it names the tool that
 * produced it.
 *
 * The timestamp is second-resolution, so it alone cannot tell two runs apart:
 * background jobs run in parallel, and two `pnpm quiet -- pnpm lint` calls
 * starting in the same second would take the same path and truncate each
 * other's output. `unique` is what keeps them apart — the caller supplies it, so
 * the name stays a pure function of its inputs.
 */
export function logFileName(command: string[], now: Date, unique: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${commandSlug(command)}-${stamp}-${unique}.log`;
}
