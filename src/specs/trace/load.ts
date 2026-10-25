// Fills a `TraceInput` from disk for the given trees: each tree's catalog, legacy map, spec Markdown
// and lock, the files the gate scans and the Markdown the legacy ban reads. It walks the working
// tree rather than asking git, so a file not yet committed is checked too.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile, TraceInput, TreeInput } from "./model";
import { isMarkdown, selectScanned, TREES, type TreeName } from "./scan";

/** Never walked: dependencies, build output and VCS data. */
const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo", ".vite"]);

/** Repo-relative paths of the repository root's own files, not its directories. */
function rootFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/** Repo-relative POSIX paths of every file under `dir`. */
function walk(root: string, dir: string): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function loadTrace(root: string, trees: TreeName[]): TraceInput {
  const read = (path: string): SourceFile => ({
    path,
    text: existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "",
  });

  const inputs: TreeInput[] = trees.map((name) => {
    const layout = TREES[name];
    const specs = walk(root, layout.specsDir).filter(isMarkdown).sort().map(read);
    const find = (path: string) => specs.find((f) => f.path === path) ?? read(path);
    return {
      name,
      catalog: find(layout.catalog),
      legacy: find(layout.legacy),
      specs,
      lock: read(layout.lock),
    };
  });

  const sources = [
    ...trees.flatMap((t) => TREES[t].sourceDirs.flatMap((d) => walk(root, d))),
    ...(trees.some((t) => TREES[t].rootFiles) ? rootFiles(root) : []),
  ];
  const markdownDirs = [...new Set(trees.flatMap((t) => TREES[t].markdownDirs))];
  return {
    trees: inputs,
    sources: selectScanned(sources, trees).sort().map(read),
    markdown: markdownDirs
      .flatMap((d) => walk(root, d))
      .filter(isMarkdown)
      .sort()
      .map(read),
  };
}
