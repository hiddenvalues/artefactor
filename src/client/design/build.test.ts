import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOG_MARKER, PREVIEW_MARKER } from "./preview";

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
});
