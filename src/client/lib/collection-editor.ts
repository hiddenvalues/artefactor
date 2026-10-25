import { COLLECTION_DESCRIPTION_MAX, collapseDescription } from "../../domain/collection/description";
import type { Visibility } from "./format";

// S74 — the collection editor dialog's form: the description's live counter and
// what Save submits. The server holds the rule
// (collections.collection.description); this mirrors it so Save is blocked
// before a round trip. Tested without a DOM.

export interface EditorFields {
  name: string;
  description: string;
  isRoot: boolean;
  visibility: Visibility;
}

export interface EditorInput {
  name: string;
  description: string | null;
  visibility?: Visibility;
}

export type EditorSubmission =
  | { input: EditorInput }
  | { errors: { name?: string; description?: string } };

// The counter counts what would be saved: the collapsed text, as the server
// measures it.
export function descriptionCount(description: string): { label: string; over: boolean } {
  const length = collapseDescription(description).length;
  return {
    label: `${length} / ${COLLECTION_DESCRIPTION_MAX}`,
    over: length > COLLECTION_DESCRIPTION_MAX,
  };
}

export function editorSubmission(fields: EditorFields): EditorSubmission {
  const name = fields.name.trim();
  const description = collapseDescription(fields.description);
  const errors: { name?: string; description?: string } = {};
  if (!name) errors.name = "Give your collection a name.";
  if (descriptionCount(description).over) {
    errors.description = `Keep the description to ${COLLECTION_DESCRIPTION_MAX} characters.`;
  }
  if (errors.name || errors.description) return { errors };
  return {
    input: {
      name,
      description: description || null,
      visibility: fields.isRoot ? fields.visibility : undefined,
    },
  };
}
