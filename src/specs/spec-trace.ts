// `pnpm spec:trace [--untraced]` — check the core tree's requirement traceability and print the
// report: coverage per namespace, each requirement's verify and impl sites, stale and broken
// references and the untraced tests (per file; `--untraced` lists each). Exits 1 on any error.
// `pnpm --filter @artefactor/ee spec:trace` runs the same over both trees.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { traceCheck } from "./trace/check";
import { loadTrace } from "./trace/load";
import { formatReport } from "./trace/report";
import type { TreeName } from "./trace/scan";

export interface SpecTraceOptions {
  root: string;
  trees: TreeName[];
  args: string[];
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Prints the report for `trees`; returns the exit code. */
export function runSpecTrace({ root, trees, args, log, error }: SpecTraceOptions): number {
  const { errors, report } = traceCheck(loadTrace(root, trees));
  const lines = formatReport(report, errors, { untraced: args.includes("--untraced") });
  for (const line of lines) (errors.length > 0 && line.startsWith("  - ") ? error : log)(line);
  return errors.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runSpecTrace({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    trees: ["core"],
    args: process.argv.slice(2),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
