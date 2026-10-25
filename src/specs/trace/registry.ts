// The `## Requirement contexts` table of each catalog: the namespaces a requirement id may start
// with, the files each is defined in and its legacy prefix.
import { posix } from "node:path";
import type { SourceFile } from "./model";
import type { TreeName } from "./scan";

export interface RequirementContext {
  namespace: string;
  /** Repo-relative path of the DDD file, or `null` for `—`. */
  ddd: string | null;
  slices: string | null;
  legacyPrefix: string | null;
  tree: TreeName;
  catalog: string;
  line: number;
}

/** One catalog table's header row: its column names, for the completeness check. */
export interface RegistryTable {
  catalog: string;
  line: number;
  columns: string[];
}

export interface Registry {
  contexts: RequirementContext[];
  tables: RegistryTable[];
  byNamespace: Map<string, RequirementContext>;
  errors: string[];
}

const SECTION = /^ {0,3}## (.+?)\s*$/;
const ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^[\s|:-]+$/;
const LINK = /^\[[^\]]*\]\(([^)\s]+)\)$/;
const NAMESPACE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NONE = "—";

/** The files a context's requirements may be defined in. */
export const namespaceFiles = (c: RequirementContext) =>
  [c.ddd, c.slices].filter((f): f is string => f !== null);

/** Parses both catalogs' tables. Link targets resolving is `markdown-links.test.ts`'s check. */
export function parseRegistry(catalogs: { tree: TreeName; catalog: SourceFile }[]): Registry {
  const registry: Registry = { contexts: [], tables: [], byNamespace: new Map(), errors: [] };
  for (const { tree, catalog } of catalogs) {
    const dir = posix.dirname(catalog.path);
    let section: string | null = null;
    let header = false;
    let found = false;
    catalog.text.split(/\r?\n/).forEach((text, i) => {
      const heading = SECTION.exec(text);
      if (heading) {
        section = heading[1]!;
        header = false;
        if (section === "Requirement contexts") found = true;
        return;
      }
      if (section !== "Requirement contexts") return;
      const row = ROW.exec(text);
      if (!row) return;
      if (!header) {
        header = true;
        const columns = row[1]!.split("|").map((cell) => cell.trim());
        registry.tables.push({ catalog: catalog.path, line: i + 1, columns });
        return;
      }
      if (SEPARATOR.test(row[1]!)) return;
      const where = `${catalog.path}:${i + 1}`;
      const [namespace = "", ddd = "", slices = "", prefix = ""] = row[1]!
        .split("|")
        .map((cell) => cell.trim());
      const file = (cell: string) => {
        if (cell === NONE) return null;
        const target = LINK.exec(cell)?.[1];
        if (target === undefined) {
          registry.errors.push(`${where}: "${cell}" is neither a Markdown link nor —`);
          return null;
        }
        return posix.normalize(posix.join(dir, target));
      };
      const context: RequirementContext = {
        namespace,
        ddd: file(ddd),
        slices: file(slices),
        legacyPrefix: prefix === NONE || prefix === "" ? null : prefix,
        tree,
        catalog: catalog.path,
        line: i + 1,
      };
      if (!NAMESPACE.test(namespace)) {
        registry.errors.push(`${where}: namespace "${namespace}" is not one lowercase kebab-case segment`);
      }
      const first = registry.byNamespace.get(namespace);
      if (first) {
        registry.errors.push(
          `${where}: namespace ${namespace} is registered twice (${first.catalog}:${first.line})`,
        );
        return;
      }
      registry.contexts.push(context);
      registry.byNamespace.set(namespace, context);
    });
    if (!found) registry.errors.push(`${catalog.path}: no ## Requirement contexts table`);
  }
  return registry;
}
