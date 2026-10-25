// Core never depends on EE: a core-tree file (outside `ee/`) neither defines nor references a
// requirement of an EE namespace. An `ee/` file may verify and implement core requirements.
import { namespaceOf } from "./definitions";
import { at, ownerTree, type Reference, type Requirement } from "./model";
import { written } from "./references";
import type { Registry } from "./registry";

// r[impl platform.trace.direction]
export function checkDirection(requirements: Requirement[], refs: Reference[], registry: Registry): string[] {
  const isEe = (id: string) => registry.byNamespace.get(namespaceOf(id))?.tree === "ee";
  const errors: string[] = [];
  for (const req of requirements) {
    if (ownerTree(req.file) === "core" && isEe(req.id)) {
      errors.push(
        `${at(req)}: ${req.id} is in EE namespace ${namespaceOf(req.id)}, defined in a core file — EE requirements live under ee/docs/specs/`,
      );
    }
  }
  for (const ref of refs) {
    if (ownerTree(ref.file) === "core" && isEe(ref.id)) {
      errors.push(
        `${at(ref)}: ${written(ref)} names a requirement of EE namespace ${namespaceOf(ref.id)} from a core file (outside ee/)`,
      );
    }
  }
  return errors;
}
