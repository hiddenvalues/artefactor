// Parser + validator for the FDD slice DAG: a catalog (`docs/specs/fdd/slice-dag.md`) listing the
// context files (`docs/specs/fdd/slices/*.md`) that hold the slices. Together they are the single
// source of truth for slice status and dependencies.
//
// Every slice is a `### <id> — <title>` heading followed, after at most one blank line, by a fixed
// metadata block of contiguous fields:
//
//   ### S31 — Agent edits data: `set_artefact_data` MCP tool
//
//   - **Status:** done
//   - **Depends on:** S11, S18, S30
//   - **Optional:** S19a
//   - **Linear:** ALI-268
//
// The heading starts at column 0; one indented by 1–3 spaces still renders as a heading, so it is
// parsed but reported rather than silently skipped. Any other heading (`# Artefact Data`,
// `### Out of scope`, …) is ignored, so a context file may keep prose sections.
//
// The catalog holds no slices. Its `## Contexts` table has one row per context file — the file's
// H1, a relative link to it and its slice ids in file order — and its `## High-water marks` list
// records, per id prefix, the highest number ever allocated:
//
//   | Context | File | Slices |
//   |---|---|---|
//   | Artefact Data | [artefact-data.md](slices/artefact-data.md) | S11, S12, S13 |
//
//   - **S:** S34
//
// Pure: no filesystem access here (see `load.ts` for the loader and `spec-dag.ts` for the CLI).
import { posix } from "node:path";

export const SLICE_STATUSES = ["specced", "in progress", "done", "dropped"] as const;
export type SliceStatus = (typeof SLICE_STATUSES)[number];

export interface Slice {
  id: string;
  title: string;
  /** The raw Status value; `null` when the field is missing. Validated by `validateSliceDag`. */
  status: string | null;
  /** Hard edges — this slice can't start before these are done. */
  dependsOn: string[];
  /** Whether the required Depends on field is present (`—` counts; an omitted field doesn't). */
  hasDependsOn: boolean;
  /** Non-blocking edges — recorded, never scheduled against. */
  optional: string[];
  linear: string | null;
  /** Whether any metadata field follows the heading, directly or after one blank line. */
  hasMetadata: boolean;
  /** Whether the heading is indented (1–3 spaces) instead of starting at column 0. */
  indented: boolean;
  /** 1-indexed line of the heading, for messages. */
  line: number;
  /** The file the slice was parsed from, for messages; `""` when parsed without one. */
  file: string;
}

const SLICE_HEADING = /^### ([A-Z]{1,3}\d+[a-z]?) — (.+)$/;
/** Up to three leading spaces, which CommonMark still renders as a heading (four is code). */
const HEADING_INDENT = /^ {0,3}(?! )/;
const METADATA_FIELD = /^- \*\*(Status|Depends on|Optional|Linear):\*\*\s*(.*)$/;
const NONE = "—";

const isSliceStatus = (s: string | null): s is SliceStatus =>
  (SLICE_STATUSES as readonly string[]).includes(s ?? "");

const parseIdList = (value: string): string[] =>
  value === NONE || value === ""
    ? []
    : value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "");

export function parseSliceDag(markdown: string, file = ""): Slice[] {
  const lines = markdown.split(/\r?\n/);
  const slices: Slice[] = [];
  for (let i = 0; i < lines.length; i++) {
    const unindented = lines[i]!.replace(HEADING_INDENT, "");
    const heading = SLICE_HEADING.exec(unindented);
    if (!heading) continue;
    const slice: Slice = {
      id: heading[1]!,
      title: heading[2]!.trim(),
      status: null,
      dependsOn: [],
      hasDependsOn: false,
      optional: [],
      linear: null,
      hasMetadata: false,
      indented: unindented !== lines[i],
      line: i + 1,
      file,
    };
    // At most one blank line separates the heading from the block (markdownlint's MD022 wants it).
    const first = lines[i + 1]?.trim() === "" ? i + 2 : i + 1;
    for (let j = first; j < lines.length; j++) {
      const field = METADATA_FIELD.exec(lines[j]!);
      if (!field) break;
      slice.hasMetadata = true;
      const value = field[2]!.trim();
      switch (field[1]) {
        case "Status":
          slice.status = value;
          break;
        case "Depends on":
          slice.dependsOn = parseIdList(value);
          slice.hasDependsOn = true;
          break;
        case "Optional":
          slice.optional = parseIdList(value);
          break;
        case "Linear":
          slice.linear = value === "" || value === NONE ? null : value;
          break;
      }
    }
    slices.push(slice);
  }
  return slices;
}

export interface ValidateOptions {
  /** Slices from another DAG file that ids may resolve against (e.g. core slices for the EE DAG). */
  external?: Slice[];
}

/** Human-readable violations; an empty list means the DAG is consistent. */
export function validateSliceDag(slices: Slice[], options: ValidateOptions = {}): string[] {
  const external = options.external ?? [];
  const violations: string[] = [];
  const label = (s: Slice) => `${s.id} (${where(s)})`;

  const byId = new Map<string, Slice>();
  for (const s of external) byId.set(s.id, s);
  const duplicates = findDuplicates(slices, byId);
  violations.push(...duplicates.violations);
  for (const [id, s] of duplicates.firsts) byId.set(id, s);

  for (const s of slices) {
    if (s.indented) {
      violations.push(`${label(s)} has an indented heading — start it at column 0`);
    }
    if (!s.hasMetadata) {
      violations.push(
        `${label(s)} lacks the metadata block under its heading (at most one blank line between)`,
      );
      continue;
    }
    if (s.status === null) {
      violations.push(`${label(s)} is missing its Status field`);
    } else if (!isSliceStatus(s.status)) {
      violations.push(
        `${label(s)} has invalid Status "${s.status}" (expected one of ${SLICE_STATUSES.join(" | ")})`,
      );
    }
    if (!s.hasDependsOn) {
      violations.push(`${label(s)} is missing its Depends on field (use — for none)`);
    }

    for (const id of s.optional) {
      if (!byId.has(id)) violations.push(`${label(s)} lists optional unknown slice ${id}`);
    }
    for (const id of s.dependsOn) {
      const dep = byId.get(id);
      if (!dep) {
        violations.push(`${label(s)} depends on unknown slice ${id}`);
      } else if (dep.status === "dropped") {
        // A dropped slice keeps its historical edges; only live slices can't build on one.
        if (s.status !== "dropped") {
          violations.push(`${label(s)} depends on dropped slice ${id}`);
        }
      } else if ((s.status === "done" || s.status === "in progress") && dep.status !== "done") {
        violations.push(
          `${label(s)} is ${s.status} but its dependency ${id} is ${dep.status ?? "missing a Status"}`,
        );
      }
    }
  }

  violations.push(...findCycles(slices));
  return violations;
}

/** Where a slice sits: `file:line`, or `line N` when it was parsed without a file. */
const where = (s: Slice) => (s.file === "" ? `line ${s.line}` : `${s.file}:${s.line}`);

/**
 * Duplicate-id violations among `slices`, each naming the first occurrence (in `known`, or earlier
 * in `slices`) and the repeat. `firsts` holds the first occurrence of every id new to `known`.
 */
function findDuplicates(slices: Slice[], known: ReadonlyMap<string, Slice> = new Map()) {
  const firsts = new Map<string, Slice>();
  const violations: string[] = [];
  for (const s of slices) {
    const first = known.get(s.id) ?? firsts.get(s.id);
    if (first) {
      violations.push(`duplicate slice id ${s.id} (${where(first)}, ${where(s)})`);
    } else {
      firsts.set(s.id, s);
    }
  }
  return { violations, firsts };
}

/** Cycles in the hard-dependency graph among `slices` (external slices are leaves). */
function findCycles(slices: Slice[]): string[] {
  const local = new Map(slices.map((s) => [s.id, s]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const cycles: string[] = [];

  const visit = (id: string) => {
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of local.get(id)!.dependsOn) {
      if (!local.has(dep)) continue;
      const depState = state.get(dep);
      if (depState === "visiting") {
        const path = [...stack.slice(stack.indexOf(dep)), dep];
        cycles.push(`hard-dependency cycle: ${path.join(" → ")}`);
      } else if (depState === undefined) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const s of slices) if (!state.has(s.id)) visit(s.id);
  return cycles;
}

/**
 * Parallel build waves: each wave holds the not-done, not-dropped slices whose hard dependencies
 * are all done or scheduled in an earlier wave. Slices that can't be scheduled (no Depends on
 * field, an unknown or dropped dependency, or a cycle) are left out — `validateSliceDag` reports
 * those.
 */
export function computeWaves(slices: Slice[], options: ValidateOptions = {}): Slice[][] {
  const resolved = new Set(
    [...(options.external ?? []), ...slices].filter((s) => s.status === "done").map((s) => s.id),
  );
  let pending = slices.filter(
    (s) => s.hasDependsOn && s.status !== "done" && s.status !== "dropped",
  );
  const waves: Slice[][] = [];
  for (;;) {
    const wave = pending.filter((s) => s.dependsOn.every((id) => resolved.has(id)));
    if (wave.length === 0) return waves;
    waves.push(wave);
    for (const s of wave) resolved.add(s.id);
    pending = pending.filter((s) => !wave.includes(s));
  }
}

export interface CatalogContext {
  /** The Context cell; must equal the context file's H1. */
  title: string;
  /** The File cell's link target, relative to the catalog's directory; `""` when not a link. */
  file: string;
  /** The File cell as written, for messages. */
  fileCell: string;
  /** The Slices cell: the file's slice ids in file order. */
  ids: string[];
  line: number;
}

export interface HighWaterMark {
  prefix: string;
  /** The raw mark value, e.g. `S34`. */
  id: string;
  /** The mark's number; `null` when the value isn't `<prefix><number>`. */
  number: number | null;
  line: number;
}

export interface SliceCatalog {
  /** The catalog's path; File cells resolve against its directory. */
  path: string;
  contexts: CatalogContext[];
  highWaterMarks: HighWaterMark[];
  /** Slice headings in the catalog itself — there must be none. */
  slices: Slice[];
}

export interface ContextFile {
  /** The file's path, in the same form as the catalog's `path`. */
  path: string;
  markdown: string;
}

const SECTION_HEADING = /^ {0,3}## (.+?)\s*$/;
const H1 = /^ {0,3}# (.+?)\s*$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR = /^[\s|:-]+$/;
const LINK = /^\[[^\]]*\]\(([^)\s]+)\)$/;
const MARK = /^- \*\*([A-Z]{1,3}):\*\*\s*(.*)$/;
const ID_PARTS = /^([A-Z]{1,3})(\d+)[a-z]?$/;

export function parseSliceCatalog(markdown: string, path = "slice-dag.md"): SliceCatalog {
  const catalog: SliceCatalog = { path, contexts: [], highWaterMarks: [], slices: [] };
  let section: string | null = null;
  let headerSeen = false;
  markdown.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const heading = SECTION_HEADING.exec(text);
    if (heading) {
      section = heading[1]!;
      headerSeen = false;
    } else if (section === "Contexts") {
      const row = TABLE_ROW.exec(text);
      if (!row) return;
      // The first row is the `| Context | File | Slices |` header.
      if (!headerSeen) {
        headerSeen = true;
        return;
      }
      if (TABLE_SEPARATOR.test(row[1]!)) return;
      const [title = "", fileCell = "", ids = ""] = row[1]!.split("|").map((cell) => cell.trim());
      const file = LINK.exec(fileCell)?.[1] ?? "";
      catalog.contexts.push({ title, file, fileCell, ids: parseIdList(ids), line });
    } else if (section === "High-water marks") {
      const mark = MARK.exec(text);
      if (!mark) return;
      const prefix = mark[1]!;
      const id = mark[2]!.trim();
      const parts = idParts(id);
      const wellFormed = parts !== null && parts.prefix === prefix && id === `${prefix}${parts.number}`;
      catalog.highWaterMarks.push({ prefix, id, number: wellFormed ? parts.number : null, line });
    }
  });
  catalog.slices = parseSliceDag(markdown, path);
  return catalog;
}

/** `S34b` → `{ prefix: "S", number: 34 }`; `null` for anything that isn't an id. */
function idParts(id: string) {
  const parts = ID_PARTS.exec(id);
  return parts ? { prefix: parts[1]!, number: Number(parts[2]) } : null;
}

/**
 * Catalog ↔ context-file drift; an empty list means they agree. `files` are the catalogued files
 * that exist and `listed` every `.md` file in the catalog's `slices/` directory, both by path in
 * the catalog's form: File cell `slices/x.md` of `docs/fdd/slice-dag.md` is `docs/fdd/slices/x.md`.
 * Slice-level checks (metadata, dependencies, cycles) are `validateSliceDag`'s, run over the union.
 */
export function validateSliceCatalog(
  catalog: SliceCatalog,
  files: ContextFile[],
  listed: string[],
): string[] {
  const violations: string[] = [];
  const dir = posix.dirname(catalog.path);
  const byPath = new Map(files.map((f) => [f.path, f]));

  for (const s of catalog.slices) {
    violations.push(
      `${catalog.path}:${s.line}: slice heading ${s.id} belongs in a context file, not the catalog`,
    );
  }

  const catalogued = new Set<string>();
  const union: Slice[] = [];
  for (const context of catalog.contexts) {
    const at = `${catalog.path}:${context.line}`;
    if (context.file === "") {
      violations.push(
        `${at}: File cell "${context.fileCell}" is not a Markdown link — write [name.md](slices/name.md)`,
      );
      continue;
    }
    const path = posix.join(dir, context.file);
    if (catalogued.has(path)) {
      violations.push(`${at}: ${path} is catalogued in more than one row`);
      continue;
    }
    catalogued.add(path);
    const file = byPath.get(path);
    if (!file) {
      violations.push(`${at}: catalogued file ${path} does not exist`);
      continue;
    }

    const h1 = file.markdown
      .split(/\r?\n/)
      .map((text) => H1.exec(text)?.[1])
      .find((title) => title !== undefined);
    if (h1 !== context.title) {
      const found = h1 === undefined ? "is missing" : `"${h1}"`;
      violations.push(`${path}: its H1 ${found} differs from its catalog Context "${context.title}"`);
    }

    const slices = parseSliceDag(file.markdown, path);
    union.push(...slices);
    const fileIds = slices.map((s) => s.id);
    const notInFile = context.ids.filter((id) => !fileIds.includes(id));
    const notInCell = slices.filter((s) => !context.ids.includes(s.id));
    if (notInFile.length > 0) {
      violations.push(`${path}: its Slices cell lists ${notInFile.join(", ")}, not in the file`);
    }
    for (const s of notInCell) {
      violations.push(`${path}: ${s.id} is missing from its Slices cell (line ${s.line})`);
    }
    if (notInFile.length === 0 && notInCell.length === 0 && `${context.ids}` !== `${fileIds}`) {
      violations.push(
        `${path}: its Slices cell order ${context.ids.join(", ")} differs from the file order ${fileIds.join(", ")}`,
      );
    }
  }

  for (const path of listed) {
    if (!catalogued.has(path)) violations.push(`${path} is not in the catalog`);
  }

  violations.push(...findDuplicates(union).violations);
  violations.push(...checkHighWaterMarks(catalog, union));
  return violations;
}

/**
 * Every id prefix in use has exactly one well-formed mark, no slice number exceeds its prefix's
 * mark (a sub-lettered id counts by its number), and no mark names a prefix without slices.
 */
function checkHighWaterMarks(catalog: SliceCatalog, slices: Slice[]): string[] {
  const violations: string[] = [];
  const marks = new Map<string, HighWaterMark>();
  for (const mark of catalog.highWaterMarks) {
    const at = `${catalog.path}:${mark.line}`;
    if (mark.number === null) {
      violations.push(
        `${at}: malformed high-water mark "${mark.id}" for prefix ${mark.prefix} (expected ${mark.prefix}<number>)`,
      );
    }
    if (marks.has(mark.prefix)) {
      violations.push(`${at}: more than one high-water mark for prefix ${mark.prefix}`);
    } else {
      marks.set(mark.prefix, mark);
    }
  }

  const used = new Set<string>();
  for (const s of slices) {
    const parts = idParts(s.id);
    if (!parts) continue;
    const mark = marks.get(parts.prefix);
    if (!mark && !used.has(parts.prefix)) {
      violations.push(
        `${catalog.path}: no high-water mark for prefix ${parts.prefix} (first used by ${s.id}, ${where(s)})`,
      );
    }
    used.add(parts.prefix);
    if (mark?.number != null && parts.number > mark.number) {
      violations.push(`${s.id} exceeds high-water mark ${mark.id} (${where(s)})`);
    }
  }

  for (const mark of marks.values()) {
    if (!used.has(mark.prefix)) {
      violations.push(
        `${catalog.path}:${mark.line}: high-water mark ${mark.id} names a prefix with no ${mark.prefix} slices`,
      );
    }
  }
  return violations;
}

/** The next id to allocate per prefix: one past each well-formed high-water mark. */
export function nextFreeIds(catalog: SliceCatalog): string[] {
  return catalog.highWaterMarks.flatMap((mark) =>
    mark.number === null ? [] : [`${mark.prefix}${mark.number + 1}`],
  );
}

const STATUS_SECTION = /^## Status\b/;
const STATUS_MARKER = /\*\*(done|pending|specced|in progress|dropped|half done)\*\*/gi;
const INDENTED_METADATA_FIELD = /^\s*- \*\*(Status|Depends on|Optional|Linear):\*\*/;
/** A CommonMark code fence: ≤ 3 spaces of indent, then 3+ backticks or tildes, then the rest. */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const WHERE = "slice status lives in the slice DAG (docs/specs/fdd/slice-dag.md + slices/)";

/**
 * `CLAUDE.md` holds only what's true between slices, so it must not carry slice status: no
 * `## Status` section, no bold per-slice status markers (`**done**`, `**pending**`, …), and no
 * slice heading or metadata field copied out of the DAG. Headings and fields inside a fenced
 * code block are allowed, so the metadata format can be documented by example. Fences follow
 * CommonMark: a closing fence uses the opening character, at least as many of it, and nothing
 * after. A fence that never closes exempts nothing.
 */
export function checkClaudeMd(markdown: string): string[] {
  const violations: { line: number; message: string }[] = [];
  let fence: { char: string; length: number } | null = null;
  /** Slice heading/field lines inside the open fence — reported only if it never closes. */
  let fenced: { line: number; message: string }[] = [];

  markdown.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const at = `CLAUDE.md line ${line}`;
    const heading = text.replace(HEADING_INDENT, "");
    if (STATUS_SECTION.test(heading)) {
      violations.push({ line, message: `${at}: a Status section — ${WHERE}` });
    }
    for (const marker of text.matchAll(STATUS_MARKER)) {
      violations.push({ line, message: `${at}: status marker ${marker[0]} — ${WHERE}` });
    }

    const delimiter = CODE_FENCE.exec(text);
    if (delimiter) {
      const run = delimiter[1]!;
      const rest = delimiter[2]!;
      if (fence === null) {
        // A backtick fence's info string can't contain backticks (CommonMark).
        if (!(run[0] === "`" && rest.includes("`"))) {
          fence = { char: run[0]!, length: run.length };
          return;
        }
      } else if (run[0] === fence.char && run.length >= fence.length && rest.trim() === "") {
        fence = null;
        fenced = [];
        return;
      }
    }

    let message: string | null = null;
    if (SLICE_HEADING.test(heading)) {
      message = `${at}: slice heading outside a code block — ${WHERE}`;
    } else if (INDENTED_METADATA_FIELD.test(text)) {
      message = `${at}: slice metadata field outside a code block — ${WHERE}`;
    }
    if (message !== null) (fence === null ? violations : fenced).push({ line, message });
  });

  return [...violations, ...fenced]
    .sort((x, y) => x.line - y.line)
    .map((v) => v.message);
}
