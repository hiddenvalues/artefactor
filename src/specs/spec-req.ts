// `pnpm spec:req [--refs] <query>…` — print requirements one at a time, instead of opening the spec
// file that defines them: a `<id>+<N>  <file>:<line>` header, the body indented, and with `--refs`
// the verify and impl sites. A query is an id, `<id>+<N>`, or a pasted `r[…]` marker or reference.
// Exits 1 when any query is unknown (after printing the known ones), 2 without a query.
// `pnpm --filter @artefactor/ee spec:req` runs the same over both trees.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTrace } from "./trace/load";
import { lookupRequirements, type FoundRequirement } from "./trace/lookup";
import type { TraceInput } from "./trace/model";

export const SPEC_REQ_USAGE =
  "usage: pnpm spec:req [--refs] <query>…  (query: <id>, <id>+<N>, r[<id>], r[verify <id>], r[impl <id>])";

export interface SpecReqOptions {
  /** Loads the trees; called only once there is a query. */
  load: () => TraceInput;
  args: string[];
  log: (line: string) => void;
  error: (line: string) => void;
}

function format(req: FoundRequirement, refs: boolean): string[] {
  const queried = /\+(\d+)\]?$/.exec(req.query.trim())?.[1];
  const header = `${req.id}+${req.version}  ${req.file}:${req.line}${req.stale ? `  (queried +${queried}: stale)` : ""}`;
  const lines = [header, ...req.body.split("\n").map((l) => `    ${l}`)];
  if (refs) {
    lines.push(`  verify: ${req.verify.join(", ") || "—"}`, `  impl:   ${req.impl.join(", ") || "—"}`);
  }
  return lines;
}

/** Prints each query's requirement; returns the exit code. */
export function runSpecReq({ load, args, log, error }: SpecReqOptions): number {
  const refs = args.includes("--refs");
  const queries = args.filter((a) => a !== "--refs");
  if (queries.length === 0) {
    error(SPEC_REQ_USAGE);
    return 2;
  }
  const results = lookupRequirements(load(), queries, { refs });
  results
    .filter((r): r is FoundRequirement => r.found)
    .forEach((r, i) => {
      if (i > 0) log("");
      for (const line of format(r, refs)) log(line);
    });
  const unknown = results.filter((r) => !r.found);
  for (const r of unknown) error(`unknown requirement: ${r.id}`);
  return unknown.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runSpecReq({
    load: () => loadTrace(fileURLToPath(new URL("../../", import.meta.url)), ["core"]),
    args: process.argv.slice(2),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
