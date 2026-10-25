// `pnpm spec:bump [--editorial <id>]…` — bring the core lock (`docs/specs/requirements.lock`) up to
// date: raise the marker of every requirement whose body changed (`+N` → `+N+1`, in place), record
// new and removed ones, and rewrite the lock. `--editorial <id>` records a typo fix's hash without a
// bump. References are left stale on purpose; `pnpm spec:trace` then lists each site to revisit.
// `pnpm --filter @artefactor/ee spec:bump` runs the same over the EE tree.
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpRequirements } from "./trace/bump";
import { loadTrace } from "./trace/load";
import type { TreeName } from "./trace/scan";

export interface SpecBumpOptions {
  root: string;
  tree: TreeName;
  args: string[];
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Bumps `tree`'s requirements and writes the result; returns the exit code. */
export function runSpecBump({ root, tree, args, log, error }: SpecBumpOptions): number {
  const editorial: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--editorial" && args[i + 1] !== undefined) editorial.push(args[++i]!);
    else if (arg.startsWith("--editorial=")) editorial.push(arg.slice("--editorial=".length));
    else {
      error(`unknown argument ${arg} — usage: spec:bump [--editorial <id>]…`);
      return 2;
    }
  }

  const [input] = loadTrace(root, [tree]).trees;
  const result = bumpRequirements({ specs: input!.specs, lock: input!.lock, editorial });
  if (result.errors.length > 0) {
    for (const e of result.errors) error(e);
    error("nothing written");
    return 1;
  }
  for (const file of result.files) writeFileSync(join(root, file.path), file.text);
  writeFileSync(join(root, input!.lock.path), result.lock);
  for (const m of result.messages) log(m);
  log(`wrote ${input!.lock.path}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runSpecBump({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    tree: "core",
    args: process.argv.slice(2),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
