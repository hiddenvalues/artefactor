// The traceability report: coverage per namespace, stale and broken references, each requirement's
// verify and impl sites, and the tests that cite no requirement (report-only, never an error).
import type { RequirementTrace } from "./coverage";
import { lex } from "./lexer";
import { at, type Reference, type Requirement, type SourceFile } from "./model";
import { parseReferences, written } from "./references";
import type { Registry } from "./registry";
import { isTestFile } from "./scan";

export interface NamespaceCoverage {
  namespace: string;
  tree: string;
  total: number;
  unclaimed: number;
  planned: number;
  inProgress: number;
  done: number;
  /** Requirements with at least one current verify / impl. */
  verified: number;
  implemented: number;
}

export interface UntracedTest {
  file: string;
  line: number;
  title: string;
}

export interface TraceReport {
  namespaces: NamespaceCoverage[];
  requirements: RequirementTrace[];
  /** `file:line: r[…] — <id> is at +N`. */
  stale: string[];
  /** `file:line: r[…]`. */
  broken: string[];
  untraced: UntracedTest[];
}

/** The `it` / `test` blocks with no `r[verify …]` directly above them or above an enclosing describe. */
export function untracedTests(sources: SourceFile[]): UntracedTest[] {
  const untraced: UntracedTest[] = [];
  for (const file of sources.filter((f) => isTestFile(f.path))) {
    const lexed = lex(file);
    const verifies = new Set(
      parseReferences(file)
        .filter((r) => r.kind === "verify")
        .map((r) => r.line),
    );
    const citedAbove = (line: number) => {
      for (let l = line - 1; lexed.commentOnly.has(l); l--) if (verifies.has(l)) return true;
      return false;
    };
    const describes: { indent: number; traced: boolean }[] = [];
    for (const t of lexed.titles) {
      while (describes.length > 0 && describes[describes.length - 1]!.indent >= t.indent) describes.pop();
      const traced = citedAbove(t.line) || describes.some((d) => d.traced);
      if (t.fn === "describe") describes.push({ indent: t.indent, traced });
      else if (!traced) untraced.push({ file: file.path, line: t.line, title: t.text });
    }
  }
  return untraced;
}

// r[impl platform.trace.report]
export function traceReport(input: {
  registry: Registry;
  requirements: Requirement[];
  traces: RequirementTrace[];
  stale: Reference[];
  broken: Reference[];
  sources: SourceFile[];
}): TraceReport {
  const namespaces = input.registry.contexts.map((c): NamespaceCoverage => {
    const own = input.traces.filter((t) => t.id.split(".")[0] === c.namespace);
    const count = (status: RequirementTrace["status"]) => own.filter((t) => t.status === status).length;
    return {
      namespace: c.namespace,
      tree: c.tree,
      total: own.length,
      unclaimed: count("unclaimed"),
      planned: count("planned"),
      inProgress: count("in progress"),
      done: count("done"),
      verified: own.filter((t) => t.verify.length > 0).length,
      implemented: own.filter((t) => t.impl.length > 0).length,
    };
  });
  const current = new Map(input.requirements.map((r) => [r.id, r.version]));
  return {
    namespaces,
    requirements: input.traces,
    stale: input.stale.map((r) => `${at(r)}: ${written(r)} — ${r.id} is at +${current.get(r.id)}`),
    broken: input.broken.map((r) => `${at(r)}: ${written(r)}`),
    untraced: untracedTests(input.sources),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The report as printed by `pnpm spec:trace`; `untraced` lists each untraced test, not a count per file. */
export function formatReport(report: TraceReport, errors: string[], options: { untraced?: boolean } = {}): string[] {
  const out: string[] = ["Coverage (per namespace):"];
  for (const n of report.namespaces) {
    out.push(
      `  ${n.namespace} (${n.tree}): ${plural(n.total, "requirement")} — ${n.done} done, ${n.inProgress} in progress, ${n.planned} planned, ${n.unclaimed} unclaimed; ${n.verified} verified, ${n.implemented} implemented`,
    );
  }

  const traced = report.requirements.filter((r) => r.verify.length + r.impl.length > 0);
  if (traced.length > 0) {
    out.push("", "Requirements:");
    for (const r of traced) {
      out.push(`  ${r.id}${r.version === 1 ? "" : `+${r.version}`} (${r.status})`);
      for (const site of r.verify) out.push(`    verify ${site}`);
      for (const site of r.impl) out.push(`    impl   ${site}`);
    }
  }

  if (report.stale.length > 0) out.push("", "Stale references:", ...report.stale.map((s) => `  ${s}`));
  if (report.broken.length > 0) out.push("", "Broken references:", ...report.broken.map((s) => `  ${s}`));

  const perFile = new Map<string, UntracedTest[]>();
  for (const t of report.untraced) perFile.set(t.file, [...(perFile.get(t.file) ?? []), t]);
  out.push("", `Untraced tests: ${report.untraced.length} in ${plural(perFile.size, "file")} (report-only)`);
  for (const [file, tests] of perFile) {
    if (options.untraced) for (const t of tests) out.push(`  ${t.file}:${t.line} ${t.title}`);
    else out.push(`  ${file}: ${tests.length}`);
  }

  out.push("", errors.length === 0 ? "No errors." : `Errors (${errors.length}):`);
  for (const e of errors) out.push(`  - ${e}`);
  return out;
}
