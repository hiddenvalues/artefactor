import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkClaudeMd,
  computeWaves,
  nextFreeIds,
  parseSliceCatalog,
  parseSliceDag,
  validateSliceCatalog,
  validateSliceDag,
  type Slice,
} from "./slice-dag";
import { loadSliceDag } from "./load";

// The FDD slice DAG is the single source of truth for slice status and dependencies: a catalog
// (`docs/specs/fdd/slice-dag.md`) listing context files (`docs/specs/fdd/slices/*.md`) that hold
// the slices. These tests make the no-drift rule mechanical for the build plan.

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

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

  it("reads the metadata block after one blank line under the heading, or none", () => {
    const block = "- **Status:** done\n- **Depends on:** S11, S18\nBody.\n";
    for (const gap of ["\n", ""]) {
      const [slice] = parseSliceDag(dag(`### S31 — Title\n${gap}${block}`));
      expect(slice).toMatchObject({
        id: "S31",
        status: "done",
        dependsOn: ["S11", "S18"],
        hasMetadata: true,
      });
    }
  });

  it("ends the metadata block at a blank line between its fields", () => {
    const [slice] = parseSliceDag(dag("### S5 — Title\n\n- **Status:** done\n\n- **Depends on:** —\n"));
    expect(slice).toMatchObject({ status: "done", hasDependsOn: false });
  });

  it("records a slice with no metadata block as status null", () => {
    const [slice] = parseSliceDag(dag("### S5 — Share\nBody without a block.\n"));
    expect(slice).toMatchObject({ id: "S5", status: null, hasMetadata: false });
  });

  it("records a slice heading indented by up to three spaces, flagged as indented", () => {
    const slices = parseSliceDag(
      dag(
        section("S0", "done"),
        "  ### S1 — Indented\n- **Status:** specced\n- **Depends on:** S0\n",
        "    ### S2 — Four spaces is a code block, not a slice\n",
      ),
    );
    expect(slices.map((s) => [s.id, s.indented])).toEqual([
      ["S0", false],
      ["S1", true],
    ]);
    expect(slices[1]).toMatchObject({ title: "Indented", status: "specced", dependsOn: ["S0"] });
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

  it("fails when a slice heading is indented instead of starting at column 0", () => {
    const v = violationsOf(
      dag(section("S0", "done"), " ### S1 — Indented\n- **Status:** done\n- **Depends on:** S0\n"),
    );
    expect(v).toEqual([expect.stringMatching(/S1.*indented/)]);
  });

  it("fails when a slice heading lacks the metadata block", () => {
    const v = violationsOf(dag("### S0 — Scaffold\nNo block.\n"));
    expect(v).toEqual([expect.stringMatching(/S0.*metadata block/)]);
  });

  it("fails when two blank lines separate a slice heading from its metadata block", () => {
    const v = violationsOf(dag("### S0 — Scaffold\n\n\n- **Status:** done\n- **Depends on:** —\n"));
    expect(v).toEqual([expect.stringMatching(/S0 .*lacks the metadata block/)]);
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

  it("fails on a slice heading or metadata fields copied out of the DAG", () => {
    const pasted = [
      "## Architecture",
      "",
      "### S40 — Some slice",
      "- **Status:** specced",
      "- **Depends on:** S31",
      "  - **Optional:** S19a",
      "- **Linear:** ALI-999",
    ].join("\n");
    expect(checkClaudeMd(pasted)).toEqual([
      expect.stringMatching(/line 3: slice heading/),
      expect.stringMatching(/line 4: slice metadata field/),
      expect.stringMatching(/line 5: slice metadata field/),
      expect.stringMatching(/line 6: slice metadata field/),
      expect.stringMatching(/line 7: slice metadata field/),
    ]);
  });

  it("accepts the metadata format documented inside a fenced code block", () => {
    const documented = [
      "- The DAG records each slice like this:",
      "",
      "  ```markdown",
      "  ### S31 — Agent edits data: `set_artefact_data` MCP tool",
      "  - **Status:** done",
      "  - **Depends on:** S11, S18, S30",
      "  ```",
      "",
      "~~~",
      "### S0 — Scaffold",
      "- **Depends on:** —",
      "~~~",
    ].join("\n");
    expect(checkClaudeMd(documented)).toEqual([]);
  });

  it("matches a Status section or slice heading indented by up to three spaces", () => {
    expect(checkClaudeMd("   ## Status: shipped\n   ### S40 — Pasted")).toEqual([
      expect.stringMatching(/line 1: a Status section/),
      expect.stringMatching(/line 2: slice heading/),
    ]);
    expect(checkClaudeMd(" ### S40 — Pasted")).toEqual([
      expect.stringMatching(/line 1: slice heading/),
    ]);
  });

  it("leaves a four-space-indented heading alone (an indented code block)", () => {
    expect(checkClaudeMd("    ## Status: shipped\n    ### S40 — Pasted")).toEqual([]);
  });

  it("does not treat an over-indented fence-like line (an indented code block) as a fence", () => {
    const md = ["    ```", "### S40 — Pasted", "- **Depends on:** S31", "    ```"].join("\n");
    expect(checkClaudeMd(md)).toEqual([
      expect.stringMatching(/line 2: slice heading/),
      expect.stringMatching(/line 3: slice metadata field/),
    ]);
  });

  it("closes a fence only on the same delimiter character with at least the opening length", () => {
    const md = [
      "````markdown",
      "```",
      "### S31 — Still inside the four-backtick fence",
      "~~~",
      "````",
      "### S40 — Pasted after the fence closed",
    ].join("\n");
    expect(checkClaudeMd(md)).toEqual([expect.stringMatching(/line 6: slice heading/)]);
  });

  it("does not exempt the lines of a fence that is never closed", () => {
    const md = ["```", "### S40 — Pasted", "- **Status:** done"].join("\n");
    expect(checkClaudeMd(md)).toEqual([
      expect.stringMatching(/line 2: slice heading/),
      expect.stringMatching(/line 3: slice metadata field/),
    ]);
  });

  it("accepts prose and non-slice headings about dependencies and build order", () => {
    const prose = [
      "### Architecture at a glance",
      "- **Depends on the adapter set:** routes take injected ports.",
      "Slices depend on each other; build order follows the DAG topologically.",
    ].join("\n");
    expect(checkClaudeMd(prose)).toEqual([]);
  });
});

/** A catalog with one row per `[title, file, ids]` and one mark per `"<prefix>: <id>"`. */
const catalogOf = (rows: [string, string, string][], marks: string[], extra: string[] = []) =>
  [
    "# FDD — Feature Slice DAG",
    "",
    "Intro prose.",
    "",
    ...extra,
    "## Contexts",
    "",
    "| Context | File | Slices |",
    "|---|---|---|",
    ...rows.map(
      ([title, file, ids]) => `| ${title} | [${file.split("/").pop()}](${file}) | ${ids} |`,
    ),
    "",
    "## High-water marks",
    "",
    ...marks.map((mark) => {
      const [prefix, id] = mark.split(":").map((part) => part.trim());
      return `- **${prefix}:** ${id}`;
    }),
    "",
  ].join("\n");

/** A context file: its H1, then the slice sections. */
const contextFile = (title: string, ...sections: string[]) =>
  [`# ${title}`, "", ...sections].join("\n");

describe("parseSliceCatalog", () => {
  it("parses a context row into its title, link target and ids", () => {
    const catalog = parseSliceCatalog(
      catalogOf([["Artefact Data", "slices/artefact-data.md", "S11, S12"]], ["S: S12"]),
    );
    expect(catalog.contexts).toEqual([
      {
        title: "Artefact Data",
        file: "slices/artefact-data.md",
        fileCell: "[artefact-data.md](slices/artefact-data.md)",
        ids: ["S11", "S12"],
        line: 9,
      },
    ]);
  });

  it("parses high-water marks into prefix, id and number", () => {
    const catalog = parseSliceCatalog(catalogOf([], ["S: S34", "ET: ET4"]));
    expect(catalog.highWaterMarks).toEqual([
      { prefix: "S", id: "S34", number: 34, line: 12 },
      { prefix: "ET", id: "ET4", number: 4, line: 13 },
    ]);
  });

  it("records a malformed mark with a null number", () => {
    const catalog = parseSliceCatalog(catalogOf([], ["S: S34a", "S: ET3"]));
    expect(catalog.highWaterMarks.map((m) => [m.id, m.number])).toEqual([
      ["S34a", null],
      ["ET3", null],
    ]);
  });

  it("ignores tables and bullets outside the Contexts and High-water marks sections", () => {
    const catalog = parseSliceCatalog(
      catalogOf(
        [],
        ["S: S1"],
        [
          "## Prose",
          "",
          "| Context | File | Slices |",
          "|---|---|---|",
          "| Stray | [x.md](slices/x.md) | S9 |",
          "- **S:** S99",
          "",
        ],
      ),
    );
    expect(catalog.contexts).toEqual([]);
    expect(catalog.highWaterMarks.map((m) => m.id)).toEqual(["S1"]);
  });
});

describe("validateSliceCatalog", () => {
  const rows: [string, string, string][] = [
    ["Platform", "slices/platform.md", "S0, S2"],
    ["Artefact Data", "slices/artefact-data.md", "S1"],
  ];
  const consistent = () => ({
    catalog: parseSliceCatalog(catalogOf(rows, ["S: S2"])),
    files: [
      {
        path: "slices/platform.md",
        markdown: contextFile("Platform", section("S0", "done"), section("S2", "done", "S0")),
      },
      {
        path: "slices/artefact-data.md",
        markdown: contextFile("Artefact Data", section("S1", "specced", "S0")),
      },
    ],
    listed: ["slices/platform.md", "slices/artefact-data.md"],
  });
  const check = (c: ReturnType<typeof consistent>) =>
    validateSliceCatalog(c.catalog, c.files, c.listed);

  it("accepts a consistent catalog and files", () => {
    expect(check(consistent())).toEqual([]);
  });

  it("resolves File cells against the catalog's directory", () => {
    const c = consistent();
    const catalog = parseSliceCatalog(catalogOf(rows, ["S: S2"]), "docs/fdd/slice-dag.md");
    const files = c.files.map((f) => ({ ...f, path: `docs/fdd/${f.path}` }));
    const listed = c.listed.map((path) => `docs/fdd/${path}`);
    expect(validateSliceCatalog(catalog, files, listed)).toEqual([]);
  });

  it("fails on a catalogued file that doesn't exist", () => {
    const c = consistent();
    c.files = c.files.filter((f) => f.path !== "slices/artefact-data.md");
    c.listed = c.listed.filter((path) => path !== "slices/artefact-data.md");
    expect(check(c)).toEqual([
      expect.stringMatching(/catalogued file slices\/artefact-data\.md does not exist/),
    ]);
  });

  it("fails on a File cell that is a bare path instead of a Markdown link", () => {
    const c = consistent();
    const markdown = catalogOf(rows, ["S: S2"]).replace(
      "[artefact-data.md](slices/artefact-data.md)",
      "slices/artefact-data.md",
    );
    c.catalog = parseSliceCatalog(markdown);
    expect(c.catalog.contexts[1]).toMatchObject({ title: "Artefact Data", file: "" });
    expect(check(c)).toEqual([
      expect.stringMatching(
        /slice-dag\.md:10: File cell "slices\/artefact-data\.md" is not a Markdown link/,
      ),
      expect.stringMatching(/slices\/artefact-data\.md is not in the catalog/),
    ]);
  });

  it("fails on a .md file in slices/ missing from the catalog", () => {
    const c = consistent();
    c.listed.push("slices/orphan.md");
    expect(check(c)).toEqual([expect.stringMatching(/slices\/orphan\.md is not in the catalog/)]);
  });

  it("fails when the same file is in two rows", () => {
    const c = consistent();
    c.catalog = parseSliceCatalog(catalogOf([...rows, rows[0]!], ["S: S2"]));
    expect(check(c)).toEqual([
      expect.stringMatching(/slices\/platform\.md is catalogued in more than one row/),
    ]);
  });

  it("fails when the Slices cell lists an id the file lacks", () => {
    const c = consistent();
    c.catalog.contexts[1]!.ids = ["S1", "S3"];
    expect(check(c)).toEqual([
      expect.stringMatching(/slices\/artefact-data\.md: its Slices cell lists S3, not in the file/),
    ]);
  });

  it("fails when a file's slice is missing from the Slices cell", () => {
    const c = consistent();
    c.catalog.contexts[0]!.ids = ["S0"];
    expect(check(c)).toEqual([
      expect.stringMatching(/slices\/platform\.md: S2 is missing from its Slices cell/),
    ]);
  });

  it("fails when the Slices cell lists the file's ids in a different order", () => {
    const c = consistent();
    c.catalog.contexts[0]!.ids = ["S2", "S0"];
    expect(check(c)).toEqual([
      expect.stringMatching(/slices\/platform\.md: its Slices cell order S2, S0 .*file order S0, S2/),
    ]);
  });

  it("fails when a Context cell differs from the file's H1", () => {
    const c = consistent();
    c.catalog.contexts[1]!.title = "Data";
    expect(check(c)).toEqual([
      expect.stringMatching(/slices\/artefact-data\.md: its H1 "Artefact Data" .*Context "Data"/),
    ]);
  });

  it("fails on a slice heading in the catalog itself", () => {
    const c = consistent();
    c.catalog = parseSliceCatalog(catalogOf(rows, ["S: S2"], [section("S1", "done")]));
    expect(check(c)).toEqual([
      expect.stringMatching(/slice-dag\.md:5: slice heading S1 belongs in a context file/),
    ]);
  });

  it("fails on the same id in two context files, naming both file:lines", () => {
    const c = consistent();
    c.files[1]!.markdown = contextFile(
      "Artefact Data",
      section("S1", "specced", "S0"),
      section("S2", "done"),
    );
    c.catalog.contexts[1]!.ids = ["S1", "S2"];
    expect(check(c)).toEqual([
      "duplicate slice id S2 (slices/platform.md:8, slices/artefact-data.md:8)",
    ]);
  });

  describe("high-water marks", () => {
    /** A single-context catalog over the given slice ids and marks. */
    const withSlices = (ids: string[], marks: string[]) =>
      validateSliceCatalog(
        parseSliceCatalog(catalogOf([["Fixture", "slices/f.md", ids.join(", ")]], marks)),
        [
          {
            path: "slices/f.md",
            markdown: contextFile("Fixture", ...ids.map((id) => section(id, "specced"))),
          },
        ],
        ["slices/f.md"],
      );

    it("fails when a slice id exceeds its prefix's mark", () => {
      expect(withSlices(["S34", "S35"], ["S: S34"])).toEqual([
        expect.stringMatching(/S35 exceeds high-water mark S34/),
      ]);
    });

    it("accepts a sub-lettered id at the mark's number", () => {
      expect(withSlices(["S34", "S34b"], ["S: S34"])).toEqual([]);
    });

    it("accepts a mark above the highest slice (numbers are never reused)", () => {
      expect(withSlices(["S34"], ["S: S40"])).toEqual([]);
    });

    it("fails on a slice prefix with no mark", () => {
      expect(withSlices(["S1", "ET1"], ["S: S1"])).toEqual([
        expect.stringMatching(/no high-water mark for prefix ET/),
      ]);
    });

    it("fails on a mark whose prefix has no slices", () => {
      expect(withSlices(["S1"], ["S: S1", "EX: EX2"])).toEqual([
        expect.stringMatching(/high-water mark EX2 .*no EX slices/),
      ]);
    });

    it("fails on a malformed mark", () => {
      expect(withSlices(["S1"], ["S: S1", "S: S34a"])).toEqual([
        expect.stringMatching(/malformed high-water mark "S34a" for prefix S/),
        expect.stringMatching(/more than one high-water mark for prefix S/),
      ]);
      expect(withSlices(["S1"], ["S: ET3"])).toEqual([
        expect.stringMatching(/malformed high-water mark "ET3" for prefix S/),
      ]);
    });

    it("fails on two marks for the same prefix", () => {
      expect(withSlices(["S1"], ["S: S1", "S: S2"])).toEqual([
        expect.stringMatching(/more than one high-water mark for prefix S/),
      ]);
    });
  });
});

describe("nextFreeIds", () => {
  it("is one past each well-formed mark", () => {
    const catalog = parseSliceCatalog(catalogOf([], ["E: E3", "ET: ET4", "S: S34a"]));
    expect(nextFreeIds(catalog)).toEqual(["E4", "ET5"]);
  });
});

describe("a DAG over several context files", () => {
  const a = parseSliceDag(contextFile("A", section("S0", "done")), "slices/a.md");
  const b = parseSliceDag(
    contextFile("B", section("S1", "specced", "S0"), section("S2", "done", "S1")),
    "slices/b.md",
  );

  it("tags each slice with its file", () => {
    expect([...a, ...b].map((s) => `${s.id}@${s.file}:${s.line}`)).toEqual([
      "S0@slices/a.md:3",
      "S1@slices/b.md:3",
      "S2@slices/b.md:8",
    ]);
  });

  it("resolves a dependency on an id in another file and names file:line in violations", () => {
    expect(validateSliceDag([...a, ...b])).toEqual([
      "S2 (slices/b.md:8) is done but its dependency S1 is specced",
    ]);
  });

  it("names both file:lines for an id duplicated across files", () => {
    const dup = parseSliceDag(contextFile("C", section("S0", "done")), "slices/c.md");
    expect(validateSliceDag([...a, ...dup])).toEqual([
      "duplicate slice id S0 (slices/a.md:3, slices/c.md:3)",
    ]);
  });
});

describe("the real specs", () => {
  const core = loadSliceDag("docs/specs/fdd/slice-dag.md", { root: repoRoot });
  const coreDag = core.slices;

  it("the core catalog and its 8 context files validate with zero catalog violations", () => {
    expect(core.violations).toEqual([]);
    expect(core.files.map((f) => f.path)).toHaveLength(8);
  });

  it("the loaded core slices validate with zero DAG violations", () => {
    expect(validateSliceDag(coreDag)).toEqual([]);
  });

  it("loads exactly the core slices S0–S35 and S37 plus S34b (S19 split into S19a + S19b)", () => {
    const expected = Array.from({ length: 36 }, (_, n) => `S${n}`)
      .flatMap((id) => (id === "S19" ? ["S19a", "S19b"] : [id]))
      .concat("S34b", "S37");
    expect(coreDag.map((s) => s.id).sort()).toEqual(expected.sort());
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
