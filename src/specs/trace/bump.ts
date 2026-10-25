// `pnpm spec:bump`: bring a tree's lock up to date with its specs. A requirement whose body changed
// at its locked version gets its marker raised to the next version, in place; references are left
// alone, so the check then lists every site that cites the old version. `--editorial <id>` records
// a changed body's hash without a bump.
import { formatLock, parseLock, type LockEntry } from "./lock";
import { parseMarkers } from "./markers";
import { at, type Requirement, type SourceFile } from "./model";

export interface BumpInput {
  /** The tree's spec Markdown. */
  specs: SourceFile[];
  lock: SourceFile;
  editorial: string[];
}

export interface BumpResult {
  /** The spec files whose markers changed, with their new text. */
  files: SourceFile[];
  lock: string;
  messages: string[];
  /** Nothing should be written when this is non-empty. */
  errors: string[];
}

// r[impl platform.trace.bump]
export function bumpRequirements({ specs, lock, editorial }: BumpInput): BumpResult {
  const messages: string[] = [];
  const errors: string[] = [];
  // A malformed lock line or marker would silently drop out of the rewritten lock: refuse instead.
  const parsedLock = parseLock(lock);
  errors.push(...parsedLock.errors);
  const locked = new Map<string, LockEntry>();
  for (const e of parsedLock.entries) if (!locked.has(e.id)) locked.set(e.id, e);

  const firsts = new Map<string, Requirement>();
  for (const file of specs) {
    const parsed = parseMarkers(file);
    errors.push(...parsed.errors);
    for (const r of parsed.requirements) if (!firsts.has(r.id)) firsts.set(r.id, r);
  }

  const rewritten = new Map<string, string[]>();
  const next: LockEntry[] = [];
  for (const req of firsts.values()) {
    const entry = locked.get(req.id);
    if (!entry || entry.version !== req.version) {
      next.push({ id: req.id, version: req.version, hash: req.hash });
      messages.push(`recorded ${req.id} at version ${req.version}`);
    } else if (entry.hash === req.hash) {
      next.push(entry);
      if (editorial.includes(req.id)) errors.push(`--editorial ${req.id}: its body is unchanged`);
    } else if (editorial.includes(req.id)) {
      next.push({ id: req.id, version: req.version, hash: req.hash });
      messages.push(`editorial ${req.id}: new hash recorded, version ${req.version} kept`);
    } else {
      const version = entry.version + 1;
      const file = specs.find((f) => f.path === req.file)!;
      // Split as parseMarkers does, so line numbers agree; the file's endings are restored on join.
      const lines = rewritten.get(file.path) ?? file.text.split(/\r?\n/);
      lines[req.line - 1] = `r[${req.id}+${version}]`;
      rewritten.set(file.path, lines);
      next.push({ id: req.id, version, hash: req.hash });
      messages.push(`bumped ${req.id} to +${version} (${at(req)})`);
    }
  }
  for (const id of editorial) {
    if (!firsts.has(id)) errors.push(`--editorial ${id}: no such requirement`);
  }
  for (const entry of locked.values()) {
    if (!firsts.has(entry.id)) messages.push(`removed ${entry.id} (no requirement)`);
  }

  return {
    files: [...rewritten].map(([path, lines]) => {
      const eol = specs.find((f) => f.path === path)!.text.includes("\r\n") ? "\r\n" : "\n";
      return { path, text: lines.join(eol) };
    }),
    lock: formatLock(next),
    messages,
    errors,
  };
}
