// Where a requirement may be defined: a well-formed id, a registered namespace, that namespace's
// files, once across both trees. The direction rule (a core file defining an EE id) is
// `direction.ts`'s, so a definition it reports is not reported here again.
import { at, ownerTree, type Requirement } from "./model";
import { namespaceFiles, type Registry } from "./registry";

/** 2–4 dot-separated kebab-case segments, each starting with a letter. */
export const REQUIREMENT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*){1,3}$/;

export const namespaceOf = (id: string) => id.split(".")[0]!;

export interface Definitions {
  errors: string[];
  /** The first well-formed definition of each id: what references and coverage resolve against. */
  byId: Map<string, Requirement>;
}

// r[impl platform.trace.id-shape]
export function checkDefinitions(requirements: Requirement[], registry: Registry): Definitions {
  const errors: string[] = [];
  const byId = new Map<string, Requirement>();
  for (const req of requirements) {
    if (!REQUIREMENT_ID.test(req.id)) {
      errors.push(
        `${at(req)}: r[${req.id}] is not a valid requirement id — 2–4 dot-separated lowercase kebab-case segments, e.g. hosting.access.no-existence-leak`,
      );
      continue;
    }
    const first = byId.get(req.id);
    if (first) {
      errors.push(`duplicate requirement ${req.id} (${at(first)}, ${at(req)})`);
      continue;
    }
    byId.set(req.id, req);
    const context = registry.byNamespace.get(namespaceOf(req.id));
    if (!context) {
      errors.push(
        `${at(req)}: ${req.id}: namespace ${namespaceOf(req.id)} is not registered in a ## Requirement contexts table`,
      );
    } else if (context.tree === "ee" && ownerTree(req.file) === "core") {
      // The direction rule's to report.
    } else if (!namespaceFiles(context).includes(req.file)) {
      errors.push(
        `${at(req)}: ${req.id} is defined outside namespace ${context.namespace}'s files (${namespaceFiles(context).join(", ")})`,
      );
    }
  }
  return { errors, byId };
}
