import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runSpecDag } from "./spec-dag";

// `pnpm spec:dag [catalog]` loads a catalog and its context files, prints the graph, the waves and
// the next free id per prefix, and exits 1 on any catalog or DAG violation.

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Runs the CLI against `catalog`, capturing what it prints. */
function run(catalog: string, root: string) {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = runSpecDag(catalog, {
    root,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { exitCode, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("pnpm spec:dag", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("on the real core catalog prints `Next free id: S40` and exits 0", () => {
    const result = run(join(repoRoot, "docs/specs/fdd/slice-dag.md"), repoRoot);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Next free id: S40");
    expect(result.stdout).toContain("```mermaid");
    expect(result.exitCode).toBe(0);
  });

  it("on a fixture catalog with a missing context file exits 1 and prints the violation", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-dag-"));
    dirs.push(dir);
    mkdirSync(join(dir, "slices"));
    writeFileSync(
      join(dir, "slice-dag.md"),
      [
        "# Fixture DAG",
        "",
        "## Contexts",
        "",
        "| Context | File | Slices |",
        "|---|---|---|",
        "| Platform | [platform.md](slices/platform.md) | S0 |",
        "| Missing | [missing.md](slices/missing.md) | S1 |",
        "",
        "## High-water marks",
        "",
        "- **S:** S1",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "slices/platform.md"),
      "# Platform\n\n### S0 — Scaffold\n- **Status:** done\n- **Depends on:** —\n",
    );

    const result = run(join(dir, "slice-dag.md"), dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("catalogued file slices/missing.md does not exist");
  });

  it("reports a File cell with no link target instead of reading the catalog's directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-dag-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "slice-dag.md"),
      [
        "# Fixture DAG",
        "",
        "## Contexts",
        "",
        "| Context | File | Slices |",
        "|---|---|---|",
        "| Platform | | S0 |",
        "",
        "## High-water marks",
        "",
        "- **S:** S0",
        "",
      ].join("\n"),
    );

    const result = run(join(dir, "slice-dag.md"), dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('File cell "" is not a Markdown link');
  });
});
