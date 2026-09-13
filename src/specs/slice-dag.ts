// Parser + validator for the FDD slice DAG (`docs/specs/fdd/slice-dag.md`).
//
// The DAG file is the single source of truth for slice status and dependencies. Every slice is a
// `### <id> — <title>` heading followed directly by a fixed metadata block:
//
//   ### S31 — Agent edits data: `set_artefact_data` MCP tool
//   - **Status:** done
//   - **Depends on:** S11, S18, S30
//   - **Optional:** S19a
//   - **Linear:** ALI-268
//
// Any other heading (`## Context: …`, `### Out of scope`, …) is ignored, so a DAG file may keep
// prose sections. Pure: no filesystem access here (see `spec-dag.ts` for the CLI).

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
  /** Whether any metadata field directly follows the heading. */
  hasMetadata: boolean;
  /** 1-indexed line of the heading, for messages. */
  line: number;
}

const SLICE_HEADING = /^### ([A-Z]{1,3}\d+[a-z]?) — (.+)$/;
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

export function parseSliceDag(markdown: string): Slice[] {
  const lines = markdown.split(/\r?\n/);
  const slices: Slice[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = SLICE_HEADING.exec(lines[i]!);
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
      line: i + 1,
    };
    for (let j = i + 1; j < lines.length; j++) {
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
  const label = (s: Slice) => `${s.id} (line ${s.line})`;

  const byId = new Map<string, Slice>();
  for (const s of external) byId.set(s.id, s);
  const seen = new Set<string>();
  for (const s of slices) {
    if (seen.has(s.id) || byId.has(s.id)) {
      violations.push(`duplicate slice id ${s.id} (line ${s.line})`);
      continue;
    }
    seen.add(s.id);
    byId.set(s.id, s);
  }

  for (const s of slices) {
    if (!s.hasMetadata) {
      violations.push(`${label(s)} lacks the metadata block directly under its heading`);
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

const STATUS_SECTION = /^## Status\b/;
const STATUS_MARKER = /\*\*(done|pending|specced|in progress|dropped|half done)\*\*/gi;
const INDENTED_METADATA_FIELD = /^\s*- \*\*(Status|Depends on|Optional|Linear):\*\*/;
const CODE_FENCE = /^\s*(```|~~~)/;
const WHERE = "slice status lives in docs/specs/fdd/slice-dag.md";

/**
 * `CLAUDE.md` holds only what's true between slices, so it must not carry slice status: no
 * `## Status` section, no bold per-slice status markers (`**done**`, `**pending**`, …), and no
 * slice heading or metadata field copied out of the DAG. Headings and fields inside a fenced
 * code block are allowed, so the metadata format can be documented by example.
 */
export function checkClaudeMd(markdown: string): string[] {
  const violations: string[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((line, i) => {
    const at = `CLAUDE.md line ${i + 1}`;
    if (STATUS_SECTION.test(line)) {
      violations.push(`${at}: a Status section — ${WHERE}`);
    }
    for (const marker of line.matchAll(STATUS_MARKER)) {
      violations.push(`${at}: status marker ${marker[0]} — ${WHERE}`);
    }
    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (SLICE_HEADING.test(line)) {
      violations.push(`${at}: slice heading outside a code block — ${WHERE}`);
    } else if (INDENTED_METADATA_FIELD.test(line)) {
      violations.push(`${at}: slice metadata field outside a code block — ${WHERE}`);
    }
  });
  return violations;
}
