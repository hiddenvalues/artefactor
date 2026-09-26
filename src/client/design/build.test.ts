import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOG_MARKER, PREVIEW_MARKER } from "./preview";

// The one stylesheet a build emitted under `assets/`.
function builtCss(out: string): string {
  const [css, ...more] = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".css"));
  expect(css).toBeDefined();
  expect(more).toEqual([]);
  return readFileSync(join(out, "assets", css ?? ""), "utf8");
}

// Escaped selectors, spelled in pieces: the app build's Tailwind scans this
// file too, and a whole class name here would land in dist/client. No piece
// may be a class on its own either (hence `bg-sidebar-r` + `ing`).
const selectors = (pieces: [string, string][]) => pieces.map(([family, value]) => `.${family}${value}`);

// Classes only the design safelist (safelist.css) carries: the app uses none.
// If the app ever adopts one, swap it for another safelist-only class.
const SAFELIST_ONLY = selectors([
  ["col-span-", "11"],
  ["lg\\:grid-cols-", "12"],
  ["bg-sidebar-r", "ing\\/20"],
]);

// The design catalog is dev-only (docs/design/README.md): `pnpm build`'s
// dist/client carries the app and nothing of the previews or the catalog.
describe("the production client build", { timeout: 120_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "artefactor-client-build-"));
  let files: string[] = [];

  beforeAll(async () => {
    const { build } = await import("vite");
    await build({ configFile: resolve("vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    files = readdirSync(out, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(out, join(e.parentPath, e.name)));
  }, 120_000);

  it("has the app's one HTML entry and no catalog page", () => {
    expect(files.filter((f) => f.endsWith(".html"))).toEqual(["index.html"]);
    expect(files.filter((f) => /preview|catalog/i.test(f))).toEqual([]);
  });

  it("bundles no preview or catalog code", () => {
    const leaking = files.filter((f) => {
      const text = readFileSync(join(out, f), "latin1");
      return text.includes(PREVIEW_MARKER) || text.includes(CATALOG_MARKER);
    });
    expect(leaking).toEqual([]);
  });

  it("carries no design-only component", () => {
    // ThemeSpecimen (lib/components/theme/) is catalog-only: the app never imports it.
    const slot = ["theme", "specimen"].join("-");
    expect(files.filter((f) => readFileSync(join(out, f), "latin1").includes(slot))).toEqual([]);
  });

  it("carries none of the design safelist", () => {
    const css = builtCss(out);
    expect(SAFELIST_ONLY.filter((selector) => css.includes(selector))).toEqual([]);
  });
});

// The design export's stylesheet is what `/design-sync` ships to Claude design,
// so it also carries the safelist: common utilities the app may not use.
describe("the design export", { timeout: 120_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "artefactor-design-export-"));
  let css = "";

  beforeAll(async () => {
    const { build } = await import("vite");
    await build({ configFile: resolve("vite.design.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    css = builtCss(out);
  }, 120_000);

  it("carries the safelisted utilities", () => {
    const wanted = [
      ...selectors([
        ["grid-cols-", "3"],
        ["max-w-", "5xl"],
        ["md\\:grid-cols-", "2"],
        ["p-", "10"],
        ["col-span-", "7"],
        ["text-", "5xl"],
        ["bg-primary\\/", "10"],
        ["hover\\:bg-", "muted:hover"],
      ]),
      ...SAFELIST_ONLY,
    ];
    expect(wanted.filter((selector) => !css.includes(selector))).toEqual([]);
  });

  it("stays at most 300,000 bytes raw", () => {
    expect(Buffer.byteLength(css)).toBeLessThanOrEqual(300_000);
  });
});
