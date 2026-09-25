// Per-kind presentation metadata (label, accent colour, tint, icon paths),
// ported from the Artefactor.dc.html design source. The server-rendered host
// shell (`/a/:slug`) draws its chrome from all of it; the React SPA takes the
// labels, and its kind colours are the `--kind-*` tokens in
// src/client/app.css, kept equal to these by src/client/lib/tokens.test.ts.
// Pure data — no framework imports.

import type { ArtefactKind } from "../domain/artefact/kind";

export interface KindPresentation {
  label: string;
  color: string;
  tint: string;
  icon: string[];
}

export const KIND_PRESENTATION: Record<ArtefactKind, KindPresentation> = {
  prototype: {
    label: "Prototype",
    color: "#2563eb",
    tint: "rgba(37,99,235,0.12)",
    icon: [
      "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      "M3 9h18",
    ],
  },
  "slide-deck": {
    label: "Slide deck",
    color: "#d97706",
    tint: "rgba(217,119,6,0.13)",
    icon: ["M2 3h20", "M21 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3", "M7 21l5-4 5 4"],
  },
  form: {
    label: "Form",
    color: "#16a34a",
    tint: "rgba(22,163,74,0.12)",
    icon: [
      "M9 2h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
      "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
      "M9 12h6",
      "M9 16h6",
    ],
  },
  "interactive-doc": {
    label: "Interactive doc",
    color: "#7c3aed",
    tint: "rgba(124,58,237,0.13)",
    icon: [
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
      "M14 2v6h6",
      "M10 12l-2 2 2 2",
      "M14 12l2 2-2 2",
    ],
  },
  other: {
    label: "Other",
    color: "#64748b",
    tint: "rgba(100,116,139,0.12)",
    icon: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  },
};

export const KIND_ORDER: ArtefactKind[] = [
  "prototype",
  "slide-deck",
  "form",
  "interactive-doc",
  "other",
];

export function kindPresentation(kind: string): KindPresentation {
  return KIND_PRESENTATION[kind as ArtefactKind] ?? KIND_PRESENTATION.other;
}
