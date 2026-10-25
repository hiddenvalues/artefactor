import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENTS_DIR,
  missingPreviews,
  orphanPreviews,
  previewGroup,
  previewId,
  SCREENS_DIR,
  SCREENS_WITHOUT_PREVIEW,
} from "./registry";

// The design catalog (docs/design/README.md): every component under
// src/client/lib/components has a sibling `*.preview.tsx` rendering its
// variants and states, so the catalog and the Claude design sync never miss one.
// S70 — so does every screen under src/client/screens, in the Templates group.

/** Every file under a directory, repo-relative with `/` separators. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
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

  it("puts the theme specimen in its own Theme group", () => {
    expect(previewId(`${base}/theme/ThemeSpecimen.preview.tsx`)).toBe("theme-theme-specimen");
    expect(previewGroup(`${base}/theme/ThemeSpecimen.preview.tsx`)).toBe("Theme");
  });

  it("finds a preview for every component and screen in the client as it stands", () => {
    for (const dir of [COMPONENTS_DIR, SCREENS_DIR]) {
      const files = tree(dir);
      expect(files.length, dir).toBeGreaterThan(0);
      expect(missingPreviews(files), dir).toEqual([]);
      expect(orphanPreviews(files), dir).toEqual([]);
    }
  });
});

describe("screen preview coverage", () => {
  const screens = "src/client/screens";

  // r[verify platform.design.screen-previews]
  it("reports a screen with no sibling preview, and passes once it is added", () => {
    expect(missingPreviews([`${screens}/Home.tsx`])).toEqual([`${screens}/Home.tsx`]);
    expect(missingPreviews([`${screens}/Home.tsx`, `${screens}/Home.preview.tsx`])).toEqual([]);
  });

  // r[verify platform.design.screen-previews]
  it("skips a screen listed without a preview, which says why", () => {
    const [name, reason] = Object.entries(SCREENS_WITHOUT_PREVIEW)[0] ?? [];
    expect(name).toBeDefined();
    expect(reason?.trim()).not.toBe("");
    expect(missingPreviews([`${screens}/${name}.tsx`])).toEqual([]);
    // Only a screen: a component of the same name still needs its preview.
    expect(missingPreviews([`src/client/lib/components/${name}.tsx`])).toEqual([`src/client/lib/components/${name}.tsx`]);
  });

  it("lists only screens that exist and still have no preview of their own", () => {
    for (const name of Object.keys(SCREENS_WITHOUT_PREVIEW)) {
      expect(existsSync(join(SCREENS_DIR, `${name}.tsx`)), name).toBe(true);
      expect(existsSync(join(SCREENS_DIR, `${name}.preview.tsx`)), name).toBe(false);
    }
  });

  it("exempts only the listed screen's own file, not a namesake elsewhere", () => {
    const [name] = Object.keys(SCREENS_WITHOUT_PREVIEW);
    expect(missingPreviews([`${screens}/org/${name}.tsx`])).toEqual([`${screens}/org/${name}.tsx`]);
    const component = `src/client/lib/components/screens/${name}.tsx`;
    expect(missingPreviews([component])).toEqual([component]);
  });

  // r[verify platform.design.screen-previews]
  it("groups a screen preview under Templates while a component keeps its group", () => {
    expect(previewGroup(`${screens}/Home.preview.tsx`)).toBe("Templates");
    expect(previewGroup(`../screens/AccountScreen.preview.tsx`)).toBe("Templates");
    expect(previewGroup(`src/client/lib/components/ArtefactCard.preview.tsx`)).toBe("App");
    expect(previewGroup(`src/client/lib/components/ui/button.preview.tsx`)).toBe("UI");
    expect(previewId(`${screens}/Home.preview.tsx`)).toBe("screen-home");
    expect(previewId(`../screens/OAuthConsentScreen.preview.tsx`)).toBe("screen-oauth-consent-screen");
  });
});
