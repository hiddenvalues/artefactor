// Requirement placement (`docs/specs/README.md` *Placement*): in a context's DDD file a rule exists
// only as a marker under an Invariants heading, so every block there is a requirement body and
// every marker sits under one. Every violation fails.
import { closesFence, fenceOpener, MARKER_LINE, parseMarkers } from "./markers";
import type { SourceFile, TreeInput } from "./model";
import { splitVersion } from "./references";
import type { Registry } from "./registry";

export type PlacementKind =
  | "prose-under-invariants"
  | "table-under-invariants"
  | "marker-outside-invariants";

export interface Violation {
  file: string;
  line: number;
  /** The heading texts from the H1 down, joined with ` › `. */
  path: string;
  kind: PlacementKind;
  /** The marker's id (no version), for a marker outside an Invariants heading. */
  id?: string;
}

const SEPARATOR = " › ";
/**
 * An ATX heading, as `parseMarkers` ends a body at one (whitespace or the end after the hashes):
 * its level and text, without an optional closing `#` run that follows whitespace.
 */
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const INVARIANTS = /^Invariants\b/;
const TABLE = /^ {0,3}\|/;
/** An HTML comment block's first line (CommonMark HTML block type 2). */
const COMMENT_OPEN = /^ {0,3}<!--/;

/** The placement violations of one DDD file. */
export function placementViolations(file: SourceFile): Violation[] {
  const lines = file.text.split(/\r?\n/);
  const violations: Violation[] = [];
  const headings: { level: number; text: string }[] = [];
  const path = () => headings.map((h) => h.text).join(SEPARATOR);
  const underInvariants = () => headings.some((h) => INVARIANTS.test(h.text));

  // A marker body is exactly what `parseMarkers` reads as one (and hashes into the lock), so the
  // two can never disagree about where a body ends.
  const bodyLines = new Set<number>();
  for (const r of parseMarkers(file).requirements) {
    const n = r.body.split("\n").length;
    for (let k = 1; k <= n; k++) bodyLines.add(r.line + k);
  }

  /** The lines of the current segment: a block that is no marker body. */
  let segment: { line: number; text: string[] } | null = null;
  /** The open fence, tracked exactly as `parseMarkers` tracks it (comments included). */
  let fence: string | null = null;
  /** Whether an HTML comment block is open: its lines, headings and markers included, are skipped. */
  let comment = false;

  const flush = () => {
    if (segment !== null && underInvariants()) {
      violations.push({
        file: file.path,
        path: path(),
        kind: TABLE.test(segment.text[0]!) ? "table-under-invariants" : "prose-under-invariants",
        line: segment.line,
      });
    }
    segment = null;
  };

  /** Adds a line outside any comment and marker body to the current segment. */
  const push = (text: string, i: number) => {
    if (comment || bodyLines.has(i)) return;
    if (segment === null) {
      if (text.trim() === "") return;
      segment = { line: i, text: [] };
    }
    segment.text.push(text);
  };

  lines.forEach((text, index) => {
    const i = index + 1;
    if (fence !== null) {
      if (closesFence(text, fence)) fence = null;
      push(text, i);
      return;
    }
    const opener = fenceOpener(text);
    if (opener !== null) {
      fence = opener;
      push(text, i);
      return;
    }
    if (comment) {
      if (text.includes("-->")) comment = false;
      return;
    }
    if (COMMENT_OPEN.test(text)) {
      // An HTML comment is ignored: it ends the block before it and runs to its `-->` line.
      flush();
      comment = !text.includes("-->");
      return;
    }
    const heading = HEADING.exec(text);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      while (headings.length > 0 && headings[headings.length - 1]!.level >= level) headings.pop();
      headings.push({ level, text: heading[2] ?? "" });
      return;
    }
    if (text.trim() === "") {
      flush();
      return;
    }
    const marker = MARKER_LINE.exec(text);
    if (marker) {
      flush();
      if (!underInvariants()) {
        violations.push({
          file: file.path,
          path: path(),
          kind: "marker-outside-invariants",
          id: splitVersion(marker[1]!).id,
          line: i,
        });
      }
      return;
    }
    push(text, i);
  });
  flush();
  return violations;
}

const MESSAGE: Record<PlacementKind, (v: Violation) => string> = {
  "prose-under-invariants": (v) =>
    `prose under an Invariants heading (${v.path}) — write the rule as an r[…] marker, or move the description out`,
  "table-under-invariants": (v) =>
    `table under an Invariants heading (${v.path}) — move each rule into a marker and the table out`,
  "marker-outside-invariants": (v) =>
    `requirement ${v.id} sits outside an Invariants heading (${v.path}) — move it under one`,
};

// r[impl platform.trace.placement+2]
/** Checks every registered context's DDD file. */
export function checkPlacement(registry: Registry, trees: TreeInput[]): string[] {
  const byPath = new Map(trees.flatMap((t) => t.specs).map((f) => [f.path, f]));
  const dddFiles = [
    ...new Set(registry.contexts.map((c) => c.ddd).filter((f): f is string => f !== null)),
  ];
  return dddFiles.flatMap((path) => {
    const file = byPath.get(path);
    if (file === undefined) return [];
    return placementViolations(file).map((v) => `${v.file}:${v.line}: ${MESSAGE[v.kind](v)}`);
  });
}
