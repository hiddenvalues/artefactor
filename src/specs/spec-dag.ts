// `pnpm spec:dag [file]` — print a slice DAG file as a mermaid graph plus its parallel build
// waves. Defaults to the core DAG. Output is for reading, never committed (nothing to drift).
import { readFileSync } from "node:fs";
import { computeWaves, parseSliceDag, validateSliceDag, type Slice } from "./slice-dag";

const DEFAULT_DAG = new URL("../../docs/specs/fdd/slice-dag.md", import.meta.url);

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

function main() {
  const path = process.argv[2] ?? DEFAULT_DAG;
  const slices = parseSliceDag(readFileSync(path, "utf8"));

  console.log("```mermaid");
  console.log(toMermaid(slices));
  console.log("```\n");

  console.log("Waves (not-done slices whose hard dependencies are done or in an earlier wave):");
  const waves = computeWaves(slices);
  if (waves.length === 0) console.log("  (nothing left to build)");
  waves.forEach((wave, i) => {
    console.log(`\nWave ${i + 1}:`);
    for (const s of wave) console.log(`  - ${s.id} — ${s.title} (${s.status})`);
  });

  const violations = validateSliceDag(slices);
  if (violations.length > 0) {
    console.error(`\n${violations.length} violation(s) — waves may be incomplete:`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exitCode = 1;
  }
}

main();
