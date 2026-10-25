// `r[verify <id>]` / `r[impl <id>]` references, read from the comments of scanned files.
import { lex } from "./lexer";
import { at, type Reference, type Requirement, type SourceFile } from "./model";
import { isTestFile } from "./scan";

/** The id part holds id characters only, so a placeholder in prose (`…`, `<id>`) is not a reference. */
const REFERENCE = /r\[(verify|impl) ([A-Za-z0-9._+-]+)\]/g;
const VERSIONED = /^(.*?)(?:\+(\d+))?$/;

/** `x.y` → `{ id: "x.y", version: 1 }`; `x.y+2` → version 2. */
export function splitVersion(raw: string): { id: string; version: number } {
  const [, id, version] = VERSIONED.exec(raw)!;
  return { id: id!, version: version === undefined ? 1 : Number(version) };
}

/** How a reference is written back in messages: kind, id and a `+N` suffix from version 2 on. */
export const written = (r: { kind: string; id: string; version: number }) =>
  `r[${r.kind} ${r.id}${r.version === 1 ? "" : `+${r.version}`}]`;

export function parseReferences(file: SourceFile): Reference[] {
  const refs: Reference[] = [];
  for (const comment of lex(file).comments) {
    for (const match of comment.text.matchAll(REFERENCE)) {
      const { id, version } = splitVersion(match[2]!);
      refs.push({ kind: match[1] as Reference["kind"], id, version, file: file.path, line: comment.line });
    }
  }
  return refs;
}

export interface ReferenceCheck {
  errors: string[];
  broken: Reference[];
  stale: Reference[];
  /** The references that count toward coverage: current, known, and a verify only in a test file. */
  current: Reference[];
}

// r[impl platform.trace.references]
/** Broken, stale and misplaced references against the known requirements (first definitions). */
export function checkReferences(refs: Reference[], requirements: Map<string, Requirement>): ReferenceCheck {
  const result: ReferenceCheck = { errors: [], broken: [], stale: [], current: [] };
  for (const ref of refs) {
    const req = requirements.get(ref.id);
    if (!req) {
      result.broken.push(ref);
      result.errors.push(`${at(ref)}: broken reference ${written(ref)} — no requirement ${ref.id}`);
      continue;
    }
    if (ref.kind === "verify" && !isTestFile(ref.file)) {
      result.errors.push(`${at(ref)}: ${written(ref)} outside a *.test.ts or *.test.tsx file`);
      continue;
    }
    if (ref.version !== req.version) {
      result.stale.push(ref);
      result.errors.push(
        `${at(ref)}: stale reference ${written(ref)} — ${ref.id} is at +${req.version} (${at(req)}); revisit this site, then cite +${req.version}`,
      );
      continue;
    }
    result.current.push(ref);
  }
  return result;
}
