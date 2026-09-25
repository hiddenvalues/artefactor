import type { ReactNode } from "react";

// The shape of a `*.preview.tsx`: a component's name and every variant and
// state worth seeing, each rendered with fixture data. The catalog shows every
// preview on one page; the export writes each one out as its own HTML page.

export interface PreviewVariant {
  name: string;
  render: () => ReactNode;
}

export interface Preview {
  title: string;
  variants: PreviewVariant[];
}

/**
 * A string that lands in every bundle holding a preview. The build test looks
 * for it to prove `pnpm build` ships no preview code.
 */
export const PREVIEW_MARKER = "artefactor-design-preview";

/** Same, for the catalog page itself. */
export const CATALOG_MARKER = "artefactor-design-catalog";

export interface DefinedPreview extends Preview {
  marker: typeof PREVIEW_MARKER;
}

export function definePreview(p: Preview): DefinedPreview {
  return { ...p, marker: PREVIEW_MARKER };
}
