import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTS_DIR, missingPreviews, orphanPreviews, previewGroup, previewId } from "./registry";

// The design catalog (docs/design/README.md): every component under
// src/client/lib/components has a sibling `*.preview.tsx` rendering its
// variants and states, so the catalog and the Claude design sync never miss one.

/** Every file under the components directory, repo-relative with `/` separators. */
function componentTree(): string[] {
  return readdirSync(COMPONENTS_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(process.cwd(), join(e.parentPath, e.name)).split("\\").join("/"));
}

describe("component preview coverage", () => {
  const base = "src/client/lib/components";

  it("reports a component with no matching preview", () => {
    expect(missingPreviews([`${base}/ui/button.tsx`, `${base}/Logo.tsx`, `${base}/Logo.preview.tsx`])).toEqual([
      `${base}/ui/button.tsx`,
    ]);
  });

  it("passes once the preview is added", () => {
    expect(missingPreviews([`${base}/ui/button.tsx`, `${base}/ui/button.preview.tsx`])).toEqual([]);
  });

  it("ignores files that are not components", () => {
    expect(missingPreviews([`${base}/helpers.ts`, `${base}/Thing.test.ts`, `${base}/README.md`])).toEqual([]);
  });

  it("reports a preview whose component is gone", () => {
    expect(orphanPreviews([`${base}/Gone.preview.tsx`, `${base}/Logo.tsx`, `${base}/Logo.preview.tsx`])).toEqual([
      `${base}/Gone.preview.tsx`,
    ]);
  });

  it("names and groups a preview by its path", () => {
    expect(previewId(`${base}/ui/button.preview.tsx`)).toBe("ui-button");
    expect(previewId(`../lib/components/ArtefactCard.preview.tsx`)).toBe("artefact-card");
    expect(previewGroup(`${base}/ui/button.preview.tsx`)).toBe("UI");
    expect(previewGroup(`${base}/ArtefactCard.preview.tsx`)).toBe("App");
  });

  it("finds a preview for every component in the client as it stands", () => {
    const tree = componentTree();
    expect(tree.length).toBeGreaterThan(0);
    expect(missingPreviews(tree)).toEqual([]);
    expect(orphanPreviews(tree)).toEqual([]);
  });
});
