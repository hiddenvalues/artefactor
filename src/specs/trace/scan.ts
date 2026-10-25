// Where each tree's traceability inputs live, and which files a gate scans for references.

export type TreeName = "core" | "ee";

export interface TreeLayout {
  /** Every Markdown file under it is read for markers. */
  specsDir: string;
  catalog: string;
  lock: string;
  legacy: string;
  /** The scanned source files live under these directories. */
  sourceDirs: string[];
  /** Whether the repository root's own files (tool configs, the Dockerfile) are scanned too. */
  rootFiles: boolean;
  /** The Markdown the legacy-id ban reads, beyond the specs. */
  markdownDirs: string[];
}

export const TREES: Record<TreeName, TreeLayout> = {
  core: {
    specsDir: "docs/specs",
    catalog: "docs/specs/fdd/slice-dag.md",
    lock: "docs/specs/requirements.lock",
    legacy: "docs/specs/legacy-ids.md",
    sourceDirs: ["src", "deploy"],
    rootFiles: true,
    markdownDirs: ["docs", "src"],
  },
  ee: {
    specsDir: "ee/docs/specs",
    catalog: "ee/docs/specs/fdd/slice-dag.md",
    lock: "ee/docs/specs/requirements.lock",
    legacy: "ee/docs/specs/legacy-ids.md",
    sourceDirs: ["ee"],
    rootFiles: false,
    markdownDirs: ["ee"],
  },
};

const SCANNED_EXTENSION = /\.(ts|tsx|js|mjs|sql|sh|yml)$/;
const DOCKERFILE = /(^|\/)Dockerfile[^/]*$/;
/** Dependencies and generated output: never an author's reference. */
const SKIPPED_DIR = /(^|\/)(node_modules|dist|build|coverage|\.turbo|\.vite)\//;

// r[impl platform.trace.scan+3]
/** Whether a file is read for references: code, config, SQL, shell, YAML or a Dockerfile, not generated. */
export function isScanned(path: string): boolean {
  if (SKIPPED_DIR.test(path)) return false;
  return SCANNED_EXTENSION.test(path) || DOCKERFILE.test(path);
}

/** The scanned files among `paths` that live in the gate's `trees`. */
export function selectScanned(paths: string[], trees: TreeName[]): string[] {
  const dirs = trees.flatMap((t) => TREES[t].sourceDirs.map((d) => `${d}/`));
  const root = trees.some((t) => TREES[t].rootFiles);
  const inTree = (p: string) => dirs.some((d) => p.startsWith(d)) || (root && !p.includes("/"));
  return paths.filter((p) => inTree(p) && isScanned(p));
}

export const isTestFile = (path: string) => /\.test\.tsx?$/.test(path);

export const isMarkdown = (path: string) => path.endsWith(".md");
