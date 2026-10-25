// Coverage: which slices claim each requirement, and what the strictest claimant's status demands
// of its current verify and impl references.
import { parseSliceDag, type Slice } from "../slice-dag";
import { parseMarkers } from "./markers";
import { at, type Reference, type Requirement, type SourceFile } from "./model";
import { written } from "./references";

export type CoverageStatus = "unclaimed" | "planned" | "in progress" | "done";

export interface RequirementTrace {
  id: string;
  version: number;
  file: string;
  line: number;
  status: CoverageStatus;
  /** Slice ids claiming it, in file order. */
  claimants: string[];
  /** `file:line` of each current verify / impl. */
  verify: string[];
  impl: string[];
}

export interface Claims {
  /** Requirement id → the live slices claiming it. */
  byRequirement: Map<string, Slice[]>;
  /** Slice → the requirement ids it claims, for the completeness check. */
  bySlice: Map<Slice, string[]>;
  slices: Slice[];
  errors: string[];
}

const HEADING_UP_TO_3 = /^ {0,3}#{1,3}\s/;

/** Every slice in `specs`, and the requirements each defines in its section or lists under Delivers. */
export function claimsOf(specs: SourceFile[], known: Map<string, Requirement>): Claims {
  const claims: Claims = { byRequirement: new Map(), bySlice: new Map(), slices: [], errors: [] };
  for (const file of specs) {
    const slices = parseSliceDag(file.text, file.path);
    if (slices.length === 0) continue;
    const lines = file.text.split(/\r?\n/);
    const markers = parseMarkers(file).requirements;
    for (const slice of slices) {
      claims.slices.push(slice);
      let end = lines.length;
      for (let i = slice.line; i < lines.length; i++) {
        if (HEADING_UP_TO_3.test(lines[i]!)) {
          end = i;
          break;
        }
      }
      const defined = markers.filter((m) => m.line > slice.line && m.line <= end).map((m) => m.id);
      for (const id of slice.delivers) {
        if (!known.has(id)) {
          claims.errors.push(`${at(slice)}: ${slice.id} delivers ${id}, which names no requirement`);
        }
      }
      const ids = [...new Set([...defined, ...slice.delivers.filter((id) => known.has(id))])];
      claims.bySlice.set(slice, ids);
      if (slice.status === "dropped") continue;
      for (const id of ids) {
        claims.byRequirement.set(id, [...(claims.byRequirement.get(id) ?? []), slice]);
      }
    }
  }
  return claims;
}

const RANK: Record<string, number> = { specced: 1, "in progress": 2, done: 3 };
const STATUS: Record<number, CoverageStatus> = { 0: "unclaimed", 1: "planned", 2: "in progress", 3: "done" };

// r[impl platform.trace.coverage]
export function checkCoverage(
  requirements: Requirement[],
  claims: Claims,
  current: Reference[],
): { errors: string[]; traces: RequirementTrace[] } {
  const errors: string[] = [];
  const traces: RequirementTrace[] = [];
  for (const req of requirements) {
    const claimants = claims.byRequirement.get(req.id) ?? [];
    const rank = Math.max(0, ...claimants.map((s) => RANK[s.status ?? ""] ?? 0));
    const status = STATUS[rank]!;
    const sites = (kind: Reference["kind"]) =>
      current.filter((r) => r.kind === kind && r.id === req.id).map(at);
    const trace: RequirementTrace = {
      id: req.id,
      version: req.version,
      file: req.file,
      line: req.line,
      status,
      claimants: claimants.map((s) => s.id),
      verify: sites("verify"),
      impl: sites("impl"),
    };
    traces.push(trace);
    if (rank < 2) continue;

    const by = claimants.find((s) => RANK[s.status ?? ""] === rank)!.id;
    const who = `${at(req)}: ${req.id} (${status}, ${by})`;
    const cite = (kind: Reference["kind"]) => written({ kind, id: req.id, version: req.version });
    if (trace.verify.length === 0) errors.push(`${who} has no current ${cite("verify")}`);
    const impls = `${trace.impl.length} current ${cite("impl")}${trace.impl.length > 0 ? ` (${trace.impl.join(", ")})` : ""}`;
    if (status === "in progress" && trace.impl.length > 1) {
      errors.push(`${who} has ${impls} — at most 1 allowed: the one site that decides the rule`);
    }
    if (status === "done" && trace.impl.length !== 1) {
      errors.push(`${who} has ${impls} — exactly 1 needed: the one site that decides the rule`);
    }
  }
  return { errors, traces };
}
