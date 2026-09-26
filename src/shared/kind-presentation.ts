// Per-kind presentation metadata (label, accent colour and tint in light and
// dark, icon paths), ported from the Artefactor.dc.html design source. The
// server-rendered host shell (`/a/:slug`) draws its chrome from all of it, in
// the viewer's theme (S45); the React SPA takes the labels, and its kind
// colours are the `--kind-*` tokens in src/client/app.css — the Mint garden
// `:root` and `.dark` values — kept equal to these by
// src/client/lib/tokens.test.ts.
// Pure data — no framework imports.

import type { ArtefactKind } from "../domain/artefact/kind";

export interface KindPresentation {
  label: string;
  color: string;
  tint: string;
  darkColor: string;
  darkTint: string;
  icon: string[];
}

export const KIND_PRESENTATION: Record<ArtefactKind, KindPresentation> = {
  prototype: {
    label: "Prototype",
    color: "oklch(0.51 0.09 170)",
    tint: "oklch(0.51 0.09 170 / 12%)",
    darkColor: "oklch(0.85 0.06 170)",
    darkTint: "oklch(0.85 0.06 170 / 16%)",
    icon: [
      "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      "M3 9h18",
    ],
  },
  "slide-deck": {
    label: "Slide deck",
    color: "oklch(0.53 0.13 55)",
    tint: "oklch(0.53 0.13 55 / 13%)",
    darkColor: "oklch(0.80 0.11 60)",
    darkTint: "oklch(0.80 0.11 60 / 16%)",
    icon: ["M2 3h20", "M21 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3", "M7 21l5-4 5 4"],
  },
  form: {
    label: "Form",
    color: "oklch(0.52 0.11 240)",
    tint: "oklch(0.52 0.11 240 / 12%)",
    darkColor: "oklch(0.78 0.08 240)",
    darkTint: "oklch(0.78 0.08 240 / 16%)",
    icon: [
      "M9 2h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
      "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
      "M9 12h6",
      "M9 16h6",
    ],
  },
  "interactive-doc": {
    label: "Interactive doc",
    color: "oklch(0.54 0.14 350)",
    tint: "oklch(0.54 0.14 350 / 12%)",
    darkColor: "oklch(0.80 0.09 350)",
    darkTint: "oklch(0.80 0.09 350 / 16%)",
    icon: [
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
      "M14 2v6h6",
      "M10 12l-2 2 2 2",
      "M14 12l2 2-2 2",
    ],
  },
  other: {
    label: "Other",
    color: "oklch(0.52 0.02 160)",
    tint: "oklch(0.52 0.02 160 / 12%)",
    darkColor: "oklch(0.74 0.02 160)",
    darkTint: "oklch(0.74 0.02 160 / 16%)",
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
