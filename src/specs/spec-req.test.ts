import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSpecReq } from "./spec-req";
import { fixture, marker } from "./trace/fixture";
import { loadTrace } from "./trace/load";

// `pnpm spec:req [--refs] <query>…` prints each requirement it finds — a `<id>+<N>  <file>:<line>`
// header, the body indented, and with `--refs` its verify and impl sites — names each unknown id on
// stderr and exits 1 on any, and prints its usage and exits 2 without a query.

const input = fixture({
  specs: {
    "docs/specs/ddd/x.md": ["# X", "", marker("x.one", "The first rule."), marker("x.two+2", "The second rule.")].join(
      "\n",
    ),
  },
  sources: { "src/x.test.ts": `// r[verify x.one]\nit("holds", () => {});\n` },
});

function run(args: string[], load = () => input) {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = runSpecReq({ load, args, log: (l) => out.push(l), error: (l) => err.push(l) });
  return { exitCode, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("pnpm spec:req", () => {
  // r[verify platform.trace.lookup]
  it("prints two known ids in query order and exits 0", () => {
    const result = run(["x.two", "x.one"]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "x.two+2  docs/specs/ddd/x.md:6",
        "    The second rule.",
        "",
        "x.one+1  docs/specs/ddd/x.md:3",
        "    The first rule.",
      ].join("\n"),
      stderr: "",
    });
  });

  // r[verify platform.trace.lookup]
  it("with --refs adds the verify and impl lines, and flags a stale query", () => {
    expect(run(["--refs", "r[impl x.one+2]"]).stdout).toBe(
      [
        "x.one+1  docs/specs/ddd/x.md:3  (queried +2: stale)",
        "    The first rule.",
        "  verify: src/x.test.ts:1",
        "  impl:   —",
      ].join("\n"),
    );
  });

  // r[verify platform.trace.lookup]
  it("names the queried version of a stale query padded with whitespace", () => {
    expect(run([" x.two+1 "]).stdout.split("\n")[0]).toBe("x.two+2  docs/specs/ddd/x.md:6  (queried +1: stale)");
  });

  // r[verify platform.trace.lookup]
  it("prints the known id, names the unknown one on stderr and exits 1", () => {
    const result = run(["x.one", "x.nope"]);
    expect(result.stdout).toBe(["x.one+1  docs/specs/ddd/x.md:3", "    The first rule."].join("\n"));
    expect(result.stderr).toBe("unknown requirement: x.nope");
    expect(result.exitCode).toBe(1);
  });

  it("without a query prints its usage and exits 2", () => {
    for (const args of [[], ["--refs"]]) {
      const result = run(args, () => {
        throw new Error("loaded without a query");
      });
      expect(result.stderr).toMatch(/^usage: pnpm spec:req \[--refs\] <query>…/);
      expect(result.exitCode).toBe(2);
    }
  });

  it("finds a real platform.trace requirement in the repository", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = run(["platform.trace.lookup"], () => loadTrace(root, ["core"]));
    expect(result.stdout).toMatch(/^platform\.trace\.lookup\+1 {2}docs\/specs\/fdd\/slices\/platform\.md:\d+\n {4}A requirement lookup/);
    expect(result.exitCode).toBe(0);
  });
});
