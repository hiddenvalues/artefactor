// The design catalog's naming rules, shared by the coverage test, the catalog
// page and the export step (vite.design.config.ts) so all three agree on what a
// component is, what its preview is called and which group it belongs to.

/** Where the components live, repo-relative. */
export const COMPONENTS_DIR = "src/client/lib/components";

const PREVIEW = /\.preview\.tsx$/;
const COMPONENT = /\.tsx$/;

const isPreview = (path: string) => PREVIEW.test(path);
const isComponent = (path: string) => COMPONENT.test(path) && !isPreview(path);
const previewOf = (component: string) => component.replace(COMPONENT, ".preview.tsx");
const componentOf = (preview: string) => preview.replace(PREVIEW, ".tsx");

/** The components among `files` with no sibling `*.preview.tsx`. */
export function missingPreviews(files: readonly string[]): string[] {
  const all = new Set(files);
  return files.filter((f) => isComponent(f) && !all.has(previewOf(f)));
}

/** The previews among `files` whose component no longer exists. */
export function orphanPreviews(files: readonly string[]): string[] {
  const all = new Set(files);
  return files.filter((f) => isPreview(f) && !all.has(componentOf(f)));
}

/** A preview's stable id, from its file name: `ui/button` → `ui-button`, `ArtefactCard` → `artefact-card`. */
export function previewId(path: string): string {
  const [, sub = "", name = ""] = /(?:^|\/)components\/((?:[^/]+\/)*)([^/]+)\.preview\.tsx$/.exec(path) ?? [];
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return [...sub.split("/").filter(Boolean), name].map(kebab).join("-");
}

/** The catalog group: the stock shadcn/ui primitives, the theme specimen, or the app's own components. */
export function previewGroup(path: string): "UI" | "App" | "Theme" {
  if (/\/components\/ui\//.test(path)) return "UI";
  return /\/components\/theme\//.test(path) ? "Theme" : "App";
}
