import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { traceCheck } from "./trace/check";
import { loadTrace } from "./trace/load";

// The core traceability gate (`docs/specs/README.md` *Requirements*): the core tree alone — the
// specs under `docs/specs`, the files scanned under `src/` and the core lock. A reference from
// `ee/` counts only in the EE gate (`ee/specs/requirements.test.ts`), so a stripped OSS tree
// passes this exactly as a cloud checkout does.

const root = fileURLToPath(new URL("../../", import.meta.url));
const { errors, report } = traceCheck(loadTrace(root, ["core"]));

describe("the core requirements", () => {
  // r[verify platform.trace.scan+3]
  it("trace cleanly: markers, lock, references, coverage, completeness and placement", () => {
    expect(errors).toEqual([]);
  });

  // r[verify platform.trace.coverage]
  it("give every platform.trace requirement a verify and exactly one impl", () => {
    const trace = report.requirements.filter((r) => r.id.startsWith("platform.trace."));
    expect(trace.map((r) => r.id).sort()).toEqual(
      [
        "bump",
        "completeness",
        "coverage",
        "direction",
        "id-shape",
        "legacy-ban",
        "lock",
        "lookup",
        "marker-syntax",
        "placement",
        "references",
        "report",
        "scan",
      ].map((name) => `platform.trace.${name}`),
    );
    for (const r of trace) {
      expect(r.verify.length, r.id).toBeGreaterThan(0);
      expect(r.impl, r.id).toHaveLength(1);
      expect(r.impl[0], r.id).toMatch(/^src\/specs\/trace\//);
    }
  });

  // r[verify platform.trace.lock]
  it("merge the core lock by union, so parallel CRs never conflict on it", () => {
    const attr = execFileSync("git", ["check-attr", "merge", "docs/specs/requirements.lock"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(attr.trim()).toBe("docs/specs/requirements.lock: merge: union");
  });
});
