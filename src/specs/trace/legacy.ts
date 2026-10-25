// The legacy-id maps (`legacy-ids.md`, one per tree): a `## <namespace>` section per registered
// context, each a frozen `| Old | New | Summary |` table. A context's old ids may appear only there.
import { lex } from "./lexer";
import { isMarkdown } from "./scan";
import type { SourceFile } from "./model";
import type { Registry } from "./registry";

export interface LegacyRow {
  old: string;
  id: string;
  file: string;
  line: number;
}

const SECTION = /^ {0,3}## (.+?)\s*$/;
const ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^[\s|:-]+$/;

/** Each map's rows by namespace, plus a missing or unregistered section as an error. */
export function parseLegacy(
  maps: { tree: string; file: SourceFile }[],
  registry: Registry,
): { rows: Map<string, LegacyRow[]>; errors: string[] } {
  const rows = new Map<string, LegacyRow[]>();
  const errors: string[] = [];
  for (const { tree, file } of maps) {
    const sections = new Set<string>();
    let section: string | null = null;
    let header = false;
    file.text.split(/\r?\n/).forEach((text, i) => {
      const heading = SECTION.exec(text);
      if (heading) {
        section = heading[1]!;
        header = false;
        sections.add(section);
        const context = registry.byNamespace.get(section);
        if (!context || context.tree !== tree) {
          errors.push(`${file.path}:${i + 1}: section ${section} is not a namespace of this tree`);
        }
        return;
      }
      const row = section === null ? null : ROW.exec(text);
      if (!row) return;
      if (!header) {
        header = true;
        return;
      }
      if (SEPARATOR.test(row[1]!)) return;
      const [old = "", id = ""] = row[1]!.split("|").map((cell) => cell.trim().replace(/^`|`$/g, ""));
      rows.set(section!, [...(rows.get(section!) ?? []), { old, id, file: file.path, line: i + 1 }]);
    });
    for (const context of registry.contexts.filter((c) => c.tree === tree)) {
      if (!sections.has(context.namespace)) {
        errors.push(`${file.path}: no section for namespace ${context.namespace}`);
      }
    }
  }
  return { rows, errors };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A one-letter-prefix id also reads as an SVG path command or a quarter, so it is matched narrowly. */
const ONE_LETTER = /^[A-Z]\d/;

// r[impl platform.trace.legacy-ban+2]
/** Mentions of any registered context's legacy ids outside the legacy maps. */
export function checkLegacyBan(
  registry: Registry,
  rows: Map<string, LegacyRow[]>,
  files: { markdown: SourceFile[]; sources: SourceFile[] },
  maps: string[],
): string[] {
  const banned = registry.contexts
    .flatMap((c) => (rows.get(c.namespace) ?? []).map((r) => ({ ...r, namespace: c.namespace })))
    .filter((r) => r.old !== "");
  if (banned.length === 0) return [];
  const byOld = new Map(banned.map((r) => [r.old, r]));
  const pattern = (ids: string[]) =>
    new RegExp(`(?<![A-Za-z0-9_])(${ids.map(escape).join("|")})(?![A-Za-z0-9_])`, "g");
  const any = pattern([...byOld.keys()]);
  const oneLetter = [...byOld.keys()].filter((old) => ONE_LETTER.test(old));
  const narrow = oneLetter.length > 0 ? pattern(oneLetter) : null;

  const errors: string[] = [];
  const report = (file: string, line: number, old: string) => {
    const row = byOld.get(old)!;
    errors.push(
      `${file}:${line}: legacy id ${old} of context ${row.namespace} — cite ${row.id || "its requirement"} instead`,
    );
  };
  const scan = (file: string, line: number, text: string, regex: RegExp, skip?: (old: string) => boolean) => {
    for (const match of text.matchAll(regex)) if (!skip?.(match[1]!)) report(file, line, match[1]!);
  };

  for (const file of [...files.markdown, ...files.sources]) {
    if (maps.includes(file.path)) continue;
    if (isMarkdown(file.path)) {
      file.text.split(/\r?\n/).forEach((text, i) => scan(file.path, i + 1, text, any));
      continue;
    }
    // Multi-letter ids anywhere in the file; one-letter ids only in comments and test titles.
    file.text
      .split(/\r?\n/)
      .forEach((text, i) => scan(file.path, i + 1, text, any, (old) => ONE_LETTER.test(old)));
    if (narrow === null) continue;
    const lexed = lex(file);
    for (const c of lexed.comments) scan(file.path, c.line, c.text, narrow);
    for (const t of lexed.titles) scan(file.path, t.line, t.text, narrow);
  }
  return errors;
}
