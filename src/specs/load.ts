// Loads a slice DAG from disk: the catalog, every catalogued context file that exists, the slices
// they hold (union, in catalog order, each tagged with its file) and the catalog ↔ files drift.
// DAG-level checks stay with the caller (`validateSliceDag`), which may add external slices.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSliceCatalog,
  parseSliceDag,
  validateSliceCatalog,
  type ContextFile,
  type Slice,
  type SliceCatalog,
} from "./slice-dag";

export interface LoadedSliceDag {
  catalog: SliceCatalog;
  files: ContextFile[];
  slices: Slice[];
  /** Catalog ↔ files drift (`validateSliceCatalog`); empty when they agree. */
  violations: string[];
}

export interface LoadOptions {
  /** Paths in messages are relative to this directory. Defaults to the working directory. */
  root?: string;
}

/** The directory, next to the catalog, whose `.md` files must all be catalogued. */
const SLICES_DIR = "slices";

export function loadSliceDag(catalogPath: string | URL, options: LoadOptions = {}): LoadedSliceDag {
  const root = resolve(options.root ?? process.cwd());
  const absolute = resolve(typeof catalogPath === "string" ? catalogPath : fileURLToPath(catalogPath));
  const display = (path: string) => relative(root, path).split(sep).join("/");

  const catalog = parseSliceCatalog(readFileSync(absolute, "utf8"), display(absolute));
  const dir = dirname(absolute);

  const files: ContextFile[] = [];
  for (const context of catalog.contexts) {
    const path = join(dir, context.file);
    if (existsSync(path)) files.push({ path: display(path), markdown: readFileSync(path, "utf8") });
  }
  const slicesDir = join(dir, SLICES_DIR);
  const listed = existsSync(slicesDir)
    ? readdirSync(slicesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => display(join(slicesDir, name)))
    : [];

  // A file in two rows is read once; `validateSliceCatalog` reports the repeat.
  const unique = [...new Map(files.map((f) => [f.path, f])).values()];
  return {
    catalog,
    files: unique,
    slices: unique.flatMap((f) => parseSliceDag(f.markdown, f.path)),
    violations: validateSliceCatalog(catalog, unique, listed),
  };
}
