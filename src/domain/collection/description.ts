import { CollectionInvariantViolation } from "./errors";

// S74 — the longest description a collection may carry, after trimming. Its own
// module so the client's counter can share it without pulling in the aggregate.
export const COLLECTION_DESCRIPTION_MAX = 280;

// The text a description is stored and measured as: trimmed, with every
// whitespace run (line breaks included) collapsed to one space — a one-line blurb.
export function collapseDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ");
}

// Collapsed; blank is none. Over the limit is refused, naming it.
// r[impl collections.collection.description+2]
export function normalizeDescription(description: string | null | undefined): string | null {
  const collapsed = collapseDescription(description ?? "");
  if (collapsed.length === 0) return null;
  if (collapsed.length > COLLECTION_DESCRIPTION_MAX) {
    throw new CollectionInvariantViolation(
      `description must be at most ${COLLECTION_DESCRIPTION_MAX} characters`,
    );
  }
  return collapsed;
}
