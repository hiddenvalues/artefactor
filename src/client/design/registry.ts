// The design catalog's naming rules, shared by the coverage test, the catalog
// page and the export step (vite.design.config.ts) so all three agree on what a
// component or screen is, what its preview is called and which group it belongs to.

/** Where the components live, repo-relative. */
export const COMPONENTS_DIR = "src/client/lib/components";

/** S70 — where the screens live, repo-relative. */
export const SCREENS_DIR = "src/client/screens";

/** S70 — the screens with no preview of their own, each with the reason. */
export const SCREENS_WITHOUT_PREVIEW: Readonly<Record<string, string>> = {
  OrganizationSettings: "Previewed as the Organization variant of AccountScreen.preview.tsx.",
};

const PREVIEW = /\.preview\.tsx$/;
const COMPONENT = /\.tsx$/;

const isPreview = (path: string) => PREVIEW.test(path);
const isComponent = (path: string) => COMPONENT.test(path) && !isPreview(path);
const previewOf = (component: string) => component.replace(COMPONENT, ".preview.tsx");
const componentOf = (preview: string) => preview.replace(PREVIEW, ".tsx");

const SCREEN = new RegExp(`(?:^|/)${SCREENS_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)\\.tsx$`);
/** A screen listed in `SCREENS_WITHOUT_PREVIEW`: `src/client/screens/<Name>.tsx`, that file only. */
export const exempt = (path: string) => {
  const name = SCREEN.exec(path)?.[1];
  return name !== undefined && Object.hasOwn(SCREENS_WITHOUT_PREVIEW, name);
};

/** The components and screens among `files` with no sibling `*.preview.tsx`. */
// r[impl platform.design.screen-previews]
export function missingPreviews(files: readonly string[]): string[] {
  const all = new Set(files);
  return files.filter((f) => isComponent(f) && !exempt(f) && !all.has(previewOf(f)));
}

/** The previews among `files` whose component no longer exists. */
export function orphanPreviews(files: readonly string[]): string[] {
  const all = new Set(files);
  return files.filter((f) => isPreview(f) && !all.has(componentOf(f)));
}

/**
 * A preview's stable id, from its file name: `ui/button` → `ui-button`, `ArtefactCard` → `artefact-card`,
 * and a screen's with a `screen-` prefix: `screens/Home` → `screen-home`.
 */
export function previewId(path: string): string {
  const [, dir = "", sub = "", name = ""] =
    /(?:^|\/)(components|screens)\/((?:[^/]+\/)*)([^/]+)\.preview\.tsx$/.exec(path) ?? [];
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return [...(dir === "screens" ? ["screen"] : []), ...sub.split("/").filter(Boolean), name].map(kebab).join("-");
}

/** The catalog groups, in the order the catalog shows them. */
export const GROUPS = ["UI", "App", "Templates", "Theme"] as const;

/**
 * The catalog group: the stock shadcn/ui primitives, the app's own components,
 * (S70) a built screen, or the theme specimen.
 */
export function previewGroup(path: string): (typeof GROUPS)[number] {
  if (/(?:^|\/)screens\//.test(path)) return "Templates";
  if (/\/components\/ui\//.test(path)) return "UI";
  return /\/components\/theme\//.test(path) ? "Theme" : "App";
}
