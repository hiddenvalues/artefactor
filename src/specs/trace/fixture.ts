// In-memory trees for the traceability tests: a core catalog (and optionally an EE one) with a
// `## Requirement contexts` table, spec files, scanned sources and locks that match the specs
// unless a test passes its own.
import { formatLock } from "./lock";
import { parseMarkers } from "./markers";
import type { SourceFile, TraceInput, TreeInput } from "./model";
import { TREES, type TreeName } from "./scan";

export interface FixtureContext {
  namespace: string;
  /** Repo-relative path of the DDD file, or `null` for `—`. */
  ddd: string | null;
  /** Repo-relative path of the slice file, or `null` for `—`. */
  slices: string | null;
  legacyPrefix?: string;
}

const coreContext = (namespace: string, file: string, legacyPrefix: string): FixtureContext => ({
  namespace,
  ddd: `docs/specs/ddd/${file}`,
  slices: `docs/specs/fdd/slices/${file}`,
  legacyPrefix,
});

const eeContext = (namespace: string, file: string, legacyPrefix: string): FixtureContext => ({
  namespace,
  ddd: `ee/docs/specs/ddd/${file}`,
  slices: `ee/docs/specs/fdd/slices/${file}`,
  legacyPrefix,
});

export const CORE_CONTEXTS: FixtureContext[] = [
  coreContext("x", "x.md", "X"),
  coreContext("hosting", "artefact-hosting.md", "AH"),
  coreContext("data", "artefact-data.md", "AD"),
];

export const EE_CONTEXTS: FixtureContext[] = [
  eeContext("tenancy", "tenancy.md", "T"),
  eeContext("quota", "usage-quota.md", "Q"),
];

/** `target` relative to the catalog's directory, as a catalog link cell writes it. */
function relativeTo(catalog: string, target: string): string {
  const from = catalog.split("/").slice(0, -1);
  const to = target.split("/");
  let common = 0;
  while (common < from.length && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

/** A catalog holding only a `## Requirement contexts` table of `contexts`. */
export function catalogOf(path: string, contexts: FixtureContext[]): string {
  const link = (target: string | null) =>
    target === null ? "—" : `[${target.split("/").pop()}](${relativeTo(path, target)})`;
  return [
    "# Catalog",
    "",
    "## Requirement contexts",
    "",
    "| Namespace | DDD | Slices | Legacy prefix |",
    "| --- | --- | --- | --- |",
    ...contexts.map(
      (c) => `| ${c.namespace} | ${link(c.ddd)} | ${link(c.slices)} | ${c.legacyPrefix ?? "—"} |`,
    ),
    "",
  ].join("\n");
}

/** A legacy-ids map with one section per namespace, holding `rows` (`[old, new]`) where given. */
export function legacyOf(
  namespaces: string[],
  rows: Record<string, [string, string][]> = {},
): string {
  return [
    "# Legacy requirement ids",
    "",
    ...namespaces.flatMap((ns) => [
      `## ${ns}`,
      "",
      "| Old | New | Summary |",
      "| --- | --- | --- |",
      ...(rows[ns] ?? []).map(([old, id]) => `| ${old} | ${id} | Summary. |`),
      "",
    ]),
  ].join("\n");
}

/** The lock that matches `specs` exactly: every requirement at its version and current hash. */
export function lockFor(specs: SourceFile[]): string {
  return formatLock(
    specs.flatMap((f) =>
      parseMarkers(f).requirements.map((r) => ({ id: r.id, version: r.version, hash: r.hash })),
    ),
  );
}

export interface FixtureOptions {
  /** Spec Markdown by repo path; the tree follows the path (`ee/…` is EE). */
  specs?: Record<string, string>;
  /** Scanned source files by repo path. */
  sources?: Record<string, string>;
  /** Further Markdown in the trees (outside the specs), by repo path. */
  markdown?: Record<string, string>;
  core?: FixtureContext[];
  /** The EE contexts; `null` builds a core-only input (the core gate). */
  ee?: FixtureContext[] | null;
  /** A lock's text per tree, replacing the one that matches the specs. */
  locks?: Partial<Record<TreeName, string>>;
  /** Legacy rows per tree, by namespace. */
  legacy?: Partial<Record<TreeName, Record<string, [string, string][]>>>;
}

const files = (record: Record<string, string> = {}): SourceFile[] =>
  Object.entries(record).map(([path, text]) => ({ path, text }));

export function fixture(options: FixtureOptions = {}): TraceInput {
  const specs = files(options.specs);
  const contexts: Record<TreeName, FixtureContext[] | null> = {
    core: options.core ?? CORE_CONTEXTS,
    ee: options.ee === undefined ? EE_CONTEXTS : options.ee,
  };
  const trees: TreeInput[] = [];
  for (const name of ["core", "ee"] as const) {
    const ctxs = contexts[name];
    if (ctxs === null) continue;
    const layout = TREES[name];
    const own = specs.filter((f) => f.path.startsWith(`${layout.specsDir}/`));
    const catalog = { path: layout.catalog, text: catalogOf(layout.catalog, ctxs) };
    const legacy = {
      path: layout.legacy,
      text: legacyOf(
        ctxs.map((c) => c.namespace),
        options.legacy?.[name],
      ),
    };
    trees.push({
      name,
      catalog,
      legacy,
      specs: [catalog, legacy, ...own],
      lock: { path: layout.lock, text: options.locks?.[name] ?? lockFor(own) },
    });
  }
  return {
    trees,
    sources: files(options.sources),
    markdown: [...trees.flatMap((t) => t.specs), ...files(options.markdown)],
  };
}

/** A slice section: heading, metadata block and `body` lines. */
export function slice(
  id: string,
  status: string,
  body: string[] = [],
  extra: string[] = [],
): string {
  return [
    `### ${id} — Title of ${id}`,
    "",
    `- **Status:** ${status}`,
    "- **Depends on:** —",
    ...extra,
    "",
    ...body,
    "",
  ].join("\n");
}

/** A slice file: an H1, `## Slices` and the given sections. */
export const sliceFile = (...sections: string[]) =>
  ["# Context", "", "## Slices", "", ...sections].join("\n");

/** A marker and its body. */
export const marker = (id: string, ...body: string[]) => [`r[${id}]`, ...body, ""].join("\n");
