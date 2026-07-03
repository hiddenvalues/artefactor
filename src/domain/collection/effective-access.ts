import type { Artefact } from "../artefact/artefact";
import type { ViewableArtefact } from "../artefact/access";
import type { Collection } from "./collection";

// Effective access resolution (CL5/AH20). An artefact inside a collection is
// governed by its tree **root's** (visibility, sharedWith); its own lie dormant.
// The result is the same viewer-facing slice the unchanged access matrix
// (`canViewArtefact`) already takes — inheritance is resolved at read time, so
// there is a single source of truth and no denormalized access copy.
//
// `root` is the artefact's collection tree root (two lookups via the immutable
// `rootId`), or null for a top-level artefact. The archive cascade (CL7) keeps
// the artefact's own `status` consistent with its tree, but an archived root
// still renders the slice archived (belt-and-braces: even if an artefact were
// restored out of step with its tree, an archived tree serves nothing — AH7).
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
    // CL1 — a contained artefact and its tree share owner and tenant, so the
    // artefact's own tenant is the effective one (the AccessPolicy's input).
    tenantId: artefact.tenantId,
    visibility: root.visibility,
    sharedWith: root.sharedWith,
  };
}

// The tier an artefact is effectively served under (AH20) — what the owner UI
// shows in the "Inherited" state and what MCP reads report.
export function effectiveVisibility(
  artefact: Artefact,
  root: Collection | null,
): Artefact["visibility"] {
  return root === null ? artefact.visibility : root.visibility;
}
