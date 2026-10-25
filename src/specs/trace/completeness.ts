// Completeness: every registered context has left positional ids behind, so its DDD file carries
// no numbered invariant list and every live slice of its slice file claims at least one
// requirement. There is no opt-out, so a catalog table with a `Migrated` column is an error.
// (The legacy-id ban is `legacy.ts`'s.)
import type { Claims } from "./coverage";
import { at, type SourceFile } from "./model";
import type { Registry } from "./registry";

const INVARIANTS = /^ {0,3}## Invariants/;
const SECTION_END = /^ {0,3}#{1,2}\s/;
const NUMBERED = /^ {0,3}\d+[.)]\s/;

// r[impl platform.trace.completeness]
export function checkCompleteness(registry: Registry, specs: SourceFile[], claims: Claims): string[] {
  const errors: string[] = [];
  for (const table of registry.tables) {
    if (table.columns.includes("Migrated")) {
      errors.push(
        `${table.catalog}:${table.line}: Requirement contexts has a Migrated column — column removed; completeness applies to every context`,
      );
    }
  }
  const byPath = new Map(specs.map((f) => [f.path, f]));
  for (const context of registry.contexts) {
    const ddd = context.ddd === null ? undefined : byPath.get(context.ddd);
    if (ddd) {
      // One error per Invariants section: its first numbered item.
      let inside = false;
      ddd.text.split(/\r?\n/).forEach((text, i) => {
        if (INVARIANTS.test(text)) inside = true;
        else if (SECTION_END.test(text)) inside = false;
        else if (inside && NUMBERED.test(text)) {
          inside = false;
          errors.push(
            `${ddd.path}:${i + 1}: numbered invariants list in context ${context.namespace} — write each as an r[…] marker`,
          );
        }
      });
    }
    for (const slice of claims.slices) {
      if (slice.file !== context.slices) continue;
      if (slice.status !== "done" && slice.status !== "in progress") continue;
      if ((claims.bySlice.get(slice) ?? []).length === 0) {
        errors.push(`${at(slice)}: ${slice.id} is ${slice.status} but claims no requirement`);
      }
    }
  }
  return errors;
}
