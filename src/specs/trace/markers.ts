// Requirement markers in spec Markdown: a line that is exactly `r[<id>]` or `r[<id>+<N>]` starts a
// requirement; its body runs to the first blank line, the next marker or a heading. Id shape and
// placement are `definitions.ts`'s; this only finds markers and their bodies.
import { createHash } from "node:crypto";
import type { Requirement, SourceFile } from "./model";
import { splitVersion } from "./references";

/** A candidate marker: the whole line is `r[…]`, with no whitespace inside. */
export const MARKER_LINE = /^r\[([^\]\s]+)\]$/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
/** A CommonMark fence line: ≤ 3 spaces, then 3+ backticks or tildes, then the rest. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// CommonMark fences: a closer uses the opener's character, at least as many of it, and nothing
// after; a backtick opener's info string holds no backtick.
/** The fence a line opens (its backtick or tilde run), or null. */
export function fenceOpener(text: string): string | null {
  const delimiter = FENCE.exec(text);
  if (delimiter === null || (delimiter[1]![0] === "`" && delimiter[2]!.includes("`"))) return null;
  return delimiter[1]!;
}

/** Whether `text` closes the open `fence`. */
export function closesFence(text: string, fence: string): boolean {
  const delimiter = FENCE.exec(text);
  return (
    delimiter !== null &&
    delimiter[1]![0] === fence[0] &&
    delimiter[1]!.length >= fence.length &&
    delimiter[2]!.trim() === ""
  );
}

/** Whitespace runs collapsed to one space, trimmed: what the lock hashes. */
export const normalizeBody = (body: string) => body.replace(/\s+/g, " ").trim();

export const hashBody = (body: string) =>
  createHash("sha256").update(normalizeBody(body)).digest("hex");

// r[impl platform.trace.marker-syntax]
export function parseMarkers(file: SourceFile): { requirements: Requirement[]; errors: string[] } {
  const lines = file.text.split(/\r?\n/);
  const requirements: Requirement[] = [];
  const errors: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (fence !== null) {
      if (closesFence(text, fence)) fence = null;
      continue;
    }
    fence = fenceOpener(text);
    if (fence !== null) continue;
    const marker = MARKER_LINE.exec(text);
    if (!marker) continue;

    const where = `${file.path}:${i + 1}`;
    const suffix = /\+(\d+)$/.exec(marker[1]!);
    const { id, version } = splitVersion(marker[1]!);
    if (suffix && version < 2) {
      errors.push(
        `${where}: marker r[${marker[1]}] — a version suffix is +2 or more; write r[${id}] for version 1`,
      );
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "" || MARKER_LINE.test(next) || HEADING.test(next)) break;
      body.push(next);
    }
    if (body.length === 0) {
      errors.push(`${where}: requirement ${id} has no body — its text follows the marker directly`);
      continue;
    }
    const joined = body.join("\n");
    requirements.push({ id, version, body: joined, hash: hashBody(joined), file: file.path, line: i + 1 });
  }
  return { requirements, errors };
}
