// The per-tree requirements lock: one sorted `<id> <version> <sha256>` line per requirement the
// tree defines. It is what makes a changed body visible: a hash that moves at the same version is
// a change without a bump. Both locks are `merge=union`, so a union merge may leave a duplicated
// line, which `pnpm spec:bump` collapses.
import { at, type Requirement, type SourceFile } from "./model";

export interface LockEntry {
  id: string;
  version: number;
  hash: string;
}

export interface LockLine extends LockEntry {
  line: number;
}

const LOCK_LINE = /^(\S+) (\d+) ([0-9a-f]{64})$/;
const BUMP = "run `pnpm spec:bump`";

export function parseLock(lock: SourceFile): { entries: LockLine[]; errors: string[] } {
  const entries: LockLine[] = [];
  const errors: string[] = [];
  lock.text.split(/\r?\n/).forEach((text, i) => {
    if (text.trim() === "") return;
    const match = LOCK_LINE.exec(text);
    if (!match) {
      errors.push(`${lock.path}:${i + 1}: malformed lock line "${text}" — ${BUMP}`);
      return;
    }
    entries.push({ id: match[1]!, version: Number(match[2]), hash: match[3]!, line: i + 1 });
  });
  return { entries, errors };
}

/** The lock's text: one line per id (the first given), sorted, each ending in a newline. */
export function formatLock(entries: LockEntry[]): string {
  const firsts = new Map<string, LockEntry>();
  for (const e of entries) if (!firsts.has(e.id)) firsts.set(e.id, e);
  return [...firsts.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => `${e.id} ${e.version} ${e.hash}\n`)
    .join("");
}

// r[impl platform.trace.lock]
/** A tree's requirements (first definitions only) against its lock. */
export function checkLock(requirements: Requirement[], lock: SourceFile): string[] {
  const { entries, errors } = parseLock(lock);
  const locked = new Map<string, LockLine>();
  for (const entry of entries) {
    if (locked.has(entry.id)) {
      errors.push(
        `${lock.path}:${entry.line}: duplicate line for ${entry.id} (left by a union merge?) — ${BUMP} to rewrite the lock`,
      );
    } else {
      locked.set(entry.id, entry);
    }
  }
  const defined = new Set(requirements.map((r) => r.id));
  for (const req of requirements) {
    const entry = locked.get(req.id);
    if (!entry) {
      errors.push(`${at(req)}: ${req.id} is not in ${lock.path} — ${BUMP}`);
    } else if (entry.version !== req.version) {
      errors.push(
        `${at(req)}: ${req.id} is version ${req.version} but ${lock.path} records ${entry.version} — ${BUMP}`,
      );
    } else if (entry.hash !== req.hash) {
      errors.push(
        `${at(req)}: ${req.id} text changed without a version bump — ${BUMP} (or \`pnpm spec:bump --editorial ${req.id}\` for an editorial fix)`,
      );
    }
  }
  for (const entry of locked.values()) {
    if (!defined.has(entry.id)) {
      errors.push(`${lock.path}:${entry.line}: ${entry.id} names no requirement — ${BUMP}`);
    }
  }
  return errors;
}
