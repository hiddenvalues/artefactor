import type { CSSProperties } from "react";
import { collectionColor, kindMeta } from "./format";

// The one form of inline style the client allows (S43, `pnpm lint`): CSS custom
// properties carrying a per-item colour token, read by Tailwind classes such as
// `text-(--kind)` or `bg-(--kind-tint)`.

/** `--kind` / `--kind-tint` for an artefact kind. */
export function kindVars(kind: string): CSSProperties {
  const m = kindMeta(kind);
  return { "--kind": m.color, "--kind-tint": m.tint } as CSSProperties;
}

/** `--hue` for a collection. */
export function hueVars(collectionId: string): CSSProperties {
  return { "--hue": collectionColor(collectionId) } as CSSProperties;
}
