import type { Artefact } from "../artefact/artefact";
import type { ViewableArtefact } from "../artefact/access";
import type { LinkGate } from "../artefact/link-gate";
import type { Collection } from "./collection";

// Effective access resolution (hosting.access.effective-from-tree-root). An artefact inside a
// collection is governed by its tree **root's** (visibility, sharedWith); its own lie dormant. The
// result is the same viewer-facing slice the unchanged access matrix (`canViewArtefact`) already
// takes — inheritance is resolved at read time, so there is a single source of truth and no
// denormalized access copy.
//
// `root` is the artefact's collection tree root (two lookups via the immutable
// `rootId`), or null for a top-level artefact. The archive cascade keeps the
// artefact's own `status` consistent with its tree, but an archived root still
// renders the slice archived (belt-and-braces: even if an artefact were
// restored out of step with its tree, an archived tree serves nothing —
// hosting.lifecycle.archived-not-served).
// r[impl hosting.access.effective-from-tree-root]
// r[impl collections.access.root-governs-tree]
// r[impl collections.access.contained-own-tier-dormant]
// r[impl collections.access.archived-root-serves-nothing]
export function effectiveViewable(
  artefact: Artefact,
  root: Collection | null,
): ViewableArtefact {
  if (root === null) {
    return artefact;
  }
  return {
    status: root.status === "archived" ? "archived" : artefact.status,
    ownerId: artefact.ownerId,
    // A contained artefact and its tree share a tenant
    // (hosting.collection.same-tenant), so the artefact's own tenant is the
    // effective one (the AccessPolicy's input).
    tenantId: artefact.tenantId,
    visibility: root.visibility,
    sharedWith: root.sharedWith,
  };
}

// The tier an artefact is effectively served under (hosting.access.effective-from-tree-root) — what
// the owner UI shows in the "Inherited" state and what MCP reads report.
export function effectiveVisibility(
  artefact: Artefact,
  root: Collection | null,
): Artefact["visibility"] {
  return root === null ? artefact.visibility : root.visibility;
}

// The link gate an artefact is read under, and its holder — whose id the pass
// that opens it is issued for and the unlock rate limit counts against (S32b).
export interface EffectiveLinkGate {
  holderId: string;
  gate: LinkGate;
}

// S32b — the gate follows the tier (hosting.access.effective-from-tree-root): a top-level
// artefact holds its own; a contained artefact follows its tree root's, its own lying dormant until
// it is moved back to top level. One pass for the root therefore opens every artefact in the tree.
// `root` as for `effectiveViewable`.
// r[impl collections.link-gate.root-governs-tree]
export function effectiveLinkGate(
  artefact: Artefact,
  root: Collection | null,
): EffectiveLinkGate {
  return root === null
    ? { holderId: artefact.id, gate: artefact.linkGate }
    : { holderId: root.id, gate: root.linkGate };
}
