// The shared shapes of requirement traceability (`docs/specs/README.md` *Requirements*). Every
// checker module is pure over these; `load.ts` fills them from disk.
import type { TreeName } from "./scan";

/** A file by repo-relative POSIX path. */
export interface SourceFile {
  path: string;
  text: string;
}

/** One `r[<id>]` / `r[<id>+<N>]` marker and its body. */
export interface Requirement {
  id: string;
  version: number;
  body: string;
  /** sha256 of the normalized body (`normalizeBody`). */
  hash: string;
  file: string;
  /** 1-indexed line of the marker. */
  line: number;
}

export type ReferenceKind = "verify" | "impl";

/** One `r[verify …]` / `r[impl …]` in a comment of a scanned file. */
export interface Reference {
  kind: ReferenceKind;
  id: string;
  version: number;
  file: string;
  line: number;
}

/** One tree's specs: the core (`docs/specs`) or EE (`ee/docs/specs`). */
export interface TreeInput {
  name: TreeName;
  catalog: SourceFile;
  legacy: SourceFile;
  /** Every Markdown file under the tree's specs directory (catalog and legacy map included). */
  specs: SourceFile[];
  lock: SourceFile;
}

/** What a gate checks: its trees, the files it scans and the Markdown the legacy ban reads. */
export interface TraceInput {
  trees: TreeInput[];
  sources: SourceFile[];
  markdown: SourceFile[];
}

export const ownerTree = (path: string): TreeName => (path.startsWith("ee/") ? "ee" : "core");

/** `file:line`, the form every message names a site in. */
export const at = (site: { file: string; line: number }) => `${site.file}:${site.line}`;
