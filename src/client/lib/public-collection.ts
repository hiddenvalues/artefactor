import type { CollectionSummary } from "../../shared/contracts";

// S44 — the id a site uses to read a public collection tree
// (`GET /api/public/collections/:id`): a public root's slug, shown read-only in
// its access popover. A non-public root keeps its slug but has nothing to hand
// out, and a non-root is reached through its root.
export function publicCollectionId(c: CollectionSummary): string | null {
  if (c.parentId !== null || c.visibility !== "public") return null;
  return c.publicSlug ?? null;
}
