import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkClaudeMd,
  computeWaves,
  parseSliceDag,
  validateSliceDag,
  type Slice,
} from "./slice-dag";

// The FDD slice DAG (`docs/specs/fdd/slice-dag.md`) is the single source of truth for slice
// status and dependencies. These tests make the no-drift rule mechanical for the build plan.

const readRepoFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** A minimal well-formed slice section. */
const section = (
  id: string,
  status: string,
  dependsOn = "—",
  extra: string[] = [],
) =>
  [
    `### ${id} — Title of ${id}`,
    `- **Status:** ${status}`,
    `- **Depends on:** ${dependsOn}`,
    ...extra,
    `Body of ${id}.`,
    "",
  ].join("\n");

const dag = (...sections: string[]) =>
  ["# FDD", "", "## Slices", "", ...sections].join("\n");

const violationsOf = (markdown: string, external?: Slice[]) =>
  validateSliceDag(parseSliceDag(markdown), { external });

describe("parseSliceDag", () => {
  it("extracts id, title, status, dependsOn, optional and linear from a well-formed block", () => {
    const [slice] = parseSliceDag(
      dag(
        [
          "### S31 — Agent edits data: `set_artefact_data` MCP tool",
          "- **Status:** done",
          "- **Depends on:** S11, S18, S30",
          "- **Optional:** S19a",
          "- **Linear:** ALI-268",
          "Body.",
        ].join("\n"),
      ),
    );
    expect(slice).toMatchObject({
      id: "S31",
      title: "Agent edits data: `set_artefact_data` MCP tool",
      status: "done",
      dependsOn: ["S11", "S18", "S30"],
      optional: ["S19a"],
      linear: "ALI-268",
    });
  });

  it("treats `—` as no dependencies, and omitted Optional / Linear as empty", () => {
    const [slice] = parseSliceDag(dag(section("S0", "done", "—")));
    expect(slice).toMatchObject({ dependsOn: [], optional: [], linear: null });
  });

  it("accepts suffixed and multi-letter ids (S19a, S34b, E1, ET2, EQ3, EP1)", () => {
    const ids = ["S19a", "S34b", "E1", "ET2", "EQ3", "EP1"];
    const slices = parseSliceDag(dag(...ids.map((id) => section(id, "specced"))));
    expect(slices.map((s) => s.id)).toEqual(ids);
  });

  it("ignores headings that are not slices", () => {
    const slices = parseSliceDag(
      dag(
        "## Context: Tenancy",
        "### Out of scope",
        "- **Status:** done",
        "#### S99 — Deeper heading is not a slice",
        section("E1", "specced"),
      ),
    );
    expect(slices.map((s) => s.id)).toEqual(["E1"]);
  });

  it("records a slice with no metadata block as status null", () => {
    const [slice] = parseSliceDag(dag("### S5 — Share\nBody without a block.\n"));
    expect(slice).toMatchObject({ id: "S5", status: null, hasMetadata: false });
  });
});

describe("validateSliceDag", () => {
  it("accepts a consistent DAG", () => {
    expect(
      violationsOf(
        dag(
          section("S0", "done"),
          section("S1", "in progress", "S0"),
          section("S2", "specced", "S1", ["- **Optional:** S3"]),
          section("S3", "dropped", "S0"),
        ),
      ),
    ).toEqual([]);
  });

  it("fails when a slice heading lacks the metadata block", () => {
    const v = violationsOf(dag("### S0 — Scaffold\nNo block.\n"));
    expect(v).toEqual([expect.stringMatching(/S0.*metadata block/)]);
  });

  it("fails when the Status field is missing", () => {
    const v = violationsOf(dag("### S0 — Scaffold\n- **Depends on:** —\nBody.\n"));
    expect(v).toEqual([expect.stringMatching(/S0.*Status/)]);
  });

  it("fails when the Depends on field is omitted (`—` is how to say none)", () => {
    const v = violationsOf(dag("### S0 — Scaffold\n- **Status:** done\nBody.\n"));
    expect(v).toEqual([expect.stringMatching(/S0.*Depends on/)]);
  });

  it("fails when the Status is not a known value", () => {
    const v = violationsOf(dag(section("S0", "half done")));
    expect(v).toEqual([expect.stringMatching(/S0.*invalid Status "half done"/)]);
  });

  it("fails on duplicated slice ids", () => {
    const v = violationsOf(dag(section("S0", "done"), section("S0", "done")));
    expect(v).toEqual([expect.stringMatching(/duplicate.*S0/i)]);
  });

  it("fails when a Depends on id doesn't exist", () => {
    const v = violationsOf(dag(section("S1", "specced", "S99")));
    expect(v).toEqual([expect.stringMatching(/S1.*depends on unknown slice S99/)]);
  });

  it("fails when an Optional id doesn't exist", () => {
    const v = violationsOf(dag(section("S1", "specced", "—", ["- **Optional:** S99"])));
    expect(v).toEqual([expect.stringMatching(/S1.*optional.*unknown slice S99/)]);
  });

  it("fails when a hard dependency is dropped", () => {
    const v = violationsOf(dag(section("S8", "dropped"), section("S9", "specced", "S8")));
    expect(v).toEqual([expect.stringMatching(/S9.*dropped.*S8/)]);
  });

  it("lets a dropped slice keep its historical edges to other dropped slices", () => {
    expect(
      violationsOf(dag(section("S8", "dropped"), section("S9", "dropped", "S8"))),
    ).toEqual([]);
  });

  it("fails when the hard-dependency graph has a cycle", () => {
    const v = violationsOf(
      dag(
        section("S1", "specced", "S3"),
        section("S2", "specced", "S1"),
        section("S3", "specced", "S2"),
      ),
    );
    expect(v).toEqual([expect.stringMatching(/cycle: S1 → S3 → S2 → S1/)]);
  });

  it("does not treat Optional edges as part of a cycle", () => {
    expect(
      violationsOf(
        dag(
          section("S1", "specced", "—", ["- **Optional:** S2"]),
          section("S2", "specced", "S1"),
        ),
      ),
    ).toEqual([]);
  });

  it("fails when a done slice has a hard dependency that isn't done", () => {
    const v = violationsOf(dag(section("S1", "specced"), section("S2", "done", "S1")));
    expect(v).toEqual([expect.stringMatching(/S2.*done.*S1.*specced/)]);
  });

  it("fails when an in-progress slice has a hard dependency that isn't done", () => {
    const v = violationsOf(
      dag(section("S1", "in progress"), section("S2", "in progress", "S1")),
    );
    expect(v).toEqual([expect.stringMatching(/S2.*in progress.*S1.*in progress/)]);
  });

  it("resolves ids against external slices", () => {
    const core = parseSliceDag(dag(section("S19b", "specced"), section("S22", "done")));
    expect(
      violationsOf(dag(section("E1", "specced", "S19b"), section("ET1", "done", "S22")), core),
    ).toEqual([]);
    expect(violationsOf(dag(section("E2", "done", "S19b")), core)).toEqual([
      expect.stringMatching(/E2.*S19b.*specced/),
    ]);
  });
});

describe("computeWaves", () => {
  it("orders not-done slices so each wave's hard dependencies are done or earlier", () => {
    const slices = parseSliceDag(
      dag(
        section("S0", "done"),
        section("S1", "specced", "S0"),
        section("S2", "in progress", "S0"),
        section("S3", "specced", "S1, S2"),
        section("S4", "specced", "S3", ["- **Optional:** S5"]),
        section("S5", "specced", "S0"),
        section("S6", "dropped", "S0"),
        "### S7 — No Depends on field\n- **Status:** specced\n",
      ),
    );
    expect(computeWaves(slices).map((w) => w.map((s) => s.id))).toEqual([
      ["S1", "S2", "S5"],
      ["S3"],
      ["S4"],
    ]);
  });
});

describe("checkClaudeMd", () => {
  it("accepts a file with no Status section or status markers", () => {
    expect(checkClaudeMd("# CLAUDE.md\n\n## Architecture\n\nSee the **slice DAG**.\n")).toEqual(
      [],
    );
  });

  it("fails on a `## Status` heading", () => {
    expect(checkClaudeMd("# CLAUDE.md\n\n## Status: v0.2 shipped\n")).toEqual([
      expect.stringMatching(/Status/),
    ]);
  });

  it("fails on bold per-slice status markers", () => {
    expect(checkClaudeMd("S19 is **half done**; S23 is **pending**.")).toHaveLength(2);
    expect(checkClaudeMd("S0 is **done**.")).toHaveLength(1);
  });
});

describe("the real specs", () => {
  const coreDag = parseSliceDag(readRepoFile("docs/specs/fdd/slice-dag.md"));

  it("docs/specs/fdd/slice-dag.md validates with zero violations", () => {
    expect(validateSliceDag(coreDag)).toEqual([]);
  });

  it("the root CLAUDE.md carries no slice status", () => {
    expect(checkClaudeMd(readRepoFile("CLAUDE.md"))).toEqual([]);
  });

  it("schedules S19b — Payload-retention seam, and S34b — Anchored comments after S34", () => {
    const waves = computeWaves(coreDag).map((w) => w.map((s) => s.id));
    const waveOf = (id: string) => waves.findIndex((w) => w.includes(id));
    expect(waveOf("S19b")).toBeGreaterThanOrEqual(0);
    expect(waveOf("S34")).toBeGreaterThanOrEqual(0);
    expect(waveOf("S34b")).toBeGreaterThan(waveOf("S34"));
  });
});
