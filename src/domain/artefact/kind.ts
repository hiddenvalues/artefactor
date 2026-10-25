export const ARTEFACT_KINDS = [
  "prototype",
  "slide-deck",
  "form",
  "interactive-doc",
  "other",
] as const;

export type ArtefactKind = (typeof ARTEFACT_KINDS)[number];

// r[impl hosting.kind.closed-set]
export function isArtefactKind(value: string): value is ArtefactKind {
  return (ARTEFACT_KINDS as readonly string[]).includes(value);
}
