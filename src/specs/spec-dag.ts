// `pnpm spec:dag [catalog]` — load a slice DAG catalog and its context files, then print a mermaid
// graph, the parallel build waves and the next free id per prefix. Defaults to the core catalog.
// Exits 1 on any catalog or DAG violation. Output is for reading, never committed (nothing to
// drift).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSliceDag } from "./load";
import { computeWaves, nextFreeIds, validateSliceDag, type Slice } from "./slice-dag";

const DEFAULT_CATALOG = fileURLToPath(new URL("../../docs/specs/fdd/slice-dag.md", import.meta.url));

/** Mermaid-safe label text: no quotes (they end the label) or backticks (markdown strings). */
const label = (text: string) => text.replace(/"/g, "#quot;").replace(/`/g, "");

/** Mermaid node ids must not clash with keywords; prefix to be safe. */
const node = (id: string) => `n_${id}`;

export function toMermaid(slices: Slice[]): string {
  const live = slices.filter((s) => s.status !== "dropped");
  const ids = new Set(live.map((s) => s.id));
  const lines = ["graph TD"];
  for (const s of live) {
    lines.push(`  ${node(s.id)}["${label(`${s.id} — ${s.title}`)}<br/>(${s.status ?? "no status"})"]`);
  }
  for (const s of live) {
    for (const dep of s.dependsOn) if (ids.has(dep)) lines.push(`  ${node(dep)} --> ${node(s.id)}`);
    for (const dep of s.optional) if (ids.has(dep)) lines.push(`  ${node(dep)} -.-> ${node(s.id)}`);
  }
  lines.push(
    "  classDef done fill:#d1fae5,stroke:#059669",
    "  classDef progress fill:#fef3c7,stroke:#d97706",
    "  classDef specced fill:#e0e7ff,stroke:#4f46e5",
  );
  const classOf = { done: "done", "in progress": "progress", specced: "specced" } as const;
  for (const [status, cls] of Object.entries(classOf)) {
    const members = live.filter((s) => s.status === status).map((s) => node(s.id));
    if (members.length > 0) lines.push(`  class ${members.join(",")} ${cls}`);
  }
  return lines.join("\n");
}

export interface SpecDagIo {
  /** Paths in messages are relative to this directory. */
  root?: string;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Prints the DAG behind `catalogPath`; returns the exit code. */
export function runSpecDag(catalogPath: string, io: SpecDagIo): number {
  const dag = loadSliceDag(catalogPath, { root: io.root });

  io.log("```mermaid");
  io.log(toMermaid(dag.slices));
  io.log("```\n");

  io.log("Waves (not-done slices whose hard dependencies are done or in an earlier wave):");
  const waves = computeWaves(dag.slices);
  if (waves.length === 0) io.log("  (nothing left to build)");
  waves.forEach((wave, i) => {
    io.log(`\nWave ${i + 1}:`);
    for (const s of wave) io.log(`  - ${s.id} — ${s.title} (${s.status}, ${s.file})`);
  });

  io.log("");
  for (const id of nextFreeIds(dag.catalog)) io.log(`Next free id: ${id}`);

  // The catalog and the DAG both report a duplicate id, in the same words.
  const violations = [...new Set([...dag.violations, ...validateSliceDag(dag.slices)])];
  if (violations.length === 0) return 0;
  io.error(`\n${violations.length} violation(s) — waves may be incomplete:`);
  for (const v of violations) io.error(`  - ${v}`);
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runSpecDag(process.argv[2] ?? DEFAULT_CATALOG, {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
