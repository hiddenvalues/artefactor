import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSpecBump } from "../spec-bump";
import { runSpecTrace } from "../spec-trace";
import { bumpRequirements } from "./bump";
import { traceCheck } from "./check";
import { catalogOf, CORE_CONTEXTS, fixture, legacyOf, lockFor, marker } from "./fixture";
import { hashBody } from "./markers";

const X_DDD = "docs/specs/ddd/x.md";
const LOCK = "docs/specs/requirements.lock";

const spec = (id: string, body: string) => ({ path: X_DDD, text: `# X\n\n## Invariants\n\n${marker(id, body)}` });

describe("bumpRequirements", () => {
  // r[verify platform.trace.bump]
  it("bumps a changed body's marker in place and rewrites the lock, leaving references stale", () => {
    const before = spec("x.y", "A rule that wraps.");
    const lock = { path: LOCK, text: lockFor([before]) };
    const after = spec("x.y", "A rule that bends.");

    const bumped = bumpRequirements({ specs: [after], lock, editorial: [] });
    expect(bumped.errors).toEqual([]);
    expect(bumped.files).toEqual([{ path: X_DDD, text: "# X\n\n## Invariants\n\nr[x.y+2]\nA rule that bends.\n" }]);
    expect(bumped.lock).toBe(`x.y 2 ${hashBody("A rule that bends.")}\n`);
    expect(bumped.messages).toEqual(["bumped x.y to +2 (docs/specs/ddd/x.md:5)"]);

    const check = traceCheck(
      fixture({
        specs: { [X_DDD]: bumped.files[0]!.text },
        locks: { core: bumped.lock },
        sources: { "src/a.test.ts": "\n// r[verify x.y+1]\nit('holds', f);\n" },
      }),
    );
    expect(check.errors).toEqual([
      expect.stringMatching(/src\/a\.test\.ts:2: stale reference r\[verify x\.y\] — x\.y is at \+2/),
    ]);
  });

  // r[verify platform.trace.bump]
  it("keeps a CRLF spec file's line endings when it rewrites a marker", () => {
    const crlf = (text: string) => ({ path: X_DDD, text: text.replace(/\n/g, "\r\n") });
    const bumped = bumpRequirements({
      specs: [crlf("# X\n\nr[x.y]\nNew.\n")],
      lock: { path: LOCK, text: lockFor([crlf("# X\n\nr[x.y]\nOld.\n")]) },
      editorial: [],
    });
    expect(bumped.files[0]!.text).toBe("# X\r\n\r\nr[x.y+2]\r\nNew.\r\n");
  });

  // r[verify platform.trace.bump]
  it("bumps from the locked version, not from 1", () => {
    const before = spec("x.y+3", "Old.");
    const bumped = bumpRequirements({
      specs: [spec("x.y+3", "New.")],
      lock: { path: LOCK, text: lockFor([before]) },
      editorial: [],
    });
    expect(bumped.files[0]!.text).toContain("r[x.y+4]\n");
  });

  // r[verify platform.trace.bump]
  it("records an editorial fix's hash without a bump, and says so", () => {
    const lock = { path: LOCK, text: lockFor([spec("x.y", "A rule taht holds.")]) };
    const fixed = spec("x.y", "A rule that holds.");
    const bumped = bumpRequirements({ specs: [fixed], lock, editorial: ["x.y"] });
    expect(bumped.files).toEqual([]);
    expect(bumped.lock).toBe(`x.y 1 ${hashBody("A rule that holds.")}\n`);
    expect(bumped.messages).toEqual(["editorial x.y: new hash recorded, version 1 kept"]);
  });

  // r[verify platform.trace.bump]
  it("fails an editorial id that names no changed requirement", () => {
    const current = spec("x.y", "A rule.");
    const bumped = bumpRequirements({
      specs: [current],
      lock: { path: LOCK, text: lockFor([current]) },
      editorial: ["x.y", "x.nope"],
    });
    expect(bumped.errors).toEqual([
      "--editorial x.y: its body is unchanged",
      "--editorial x.nope: no such requirement",
    ]);
  });

  // r[verify platform.trace.bump]
  it("refuses to rewrite anything while a marker or lock line is malformed", () => {
    const good = spec("x.y", "A rule.");
    const lock = { path: LOCK, text: lockFor([good]) };
    const badMarker = bumpRequirements({
      specs: [{ path: X_DDD, text: "# X\n\nr[x.y+1]\nA rule.\n" }],
      lock,
      editorial: [],
    });
    expect(badMarker.errors).toEqual([expect.stringMatching(/x\.md:3: marker r\[x\.y\+1\]/)]);
    const badLock = bumpRequirements({
      specs: [good],
      lock: { path: LOCK, text: `${lock.text}not a lock line\n` },
      editorial: [],
    });
    expect(badLock.errors).toEqual([
      expect.stringMatching(/requirements\.lock:2: malformed lock line "not a lock line"/),
    ]);
  });

  // r[verify platform.trace.bump]
  it("records new requirements, drops removed ones and collapses duplicated lines", () => {
    const hash = "0".repeat(64);
    const lock = { path: LOCK, text: `x.gone 1 ${hash}\nx.y 1 ${hash}\nx.y 1 ${hash}\n` };
    const bumped = bumpRequirements({
      specs: [{ path: X_DDD, text: `${marker("x.new", "New.")}\n${marker("x.y+2", "Hand-bumped.")}` }],
      lock,
      editorial: [],
    });
    expect(bumped.files).toEqual([]);
    expect(bumped.lock).toBe(
      `x.new 1 ${hashBody("New.")}\nx.y 2 ${hashBody("Hand-bumped.")}\n`,
    );
    expect(bumped.messages).toEqual([
      "recorded x.new at version 1",
      "recorded x.y at version 2",
      "removed x.gone (no requirement)",
    ]);
  });
});

describe("the spec:bump and spec:trace commands", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A minimal core tree on disk: catalog, legacy map, one DDD file, its lock and a test. */
  function tree(body: string, lockBody = body) {
    root = mkdtempSync(join(tmpdir(), "trace-"));
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write("docs/specs/fdd/slice-dag.md", catalogOf("docs/specs/fdd/slice-dag.md", CORE_CONTEXTS));
    write("docs/specs/legacy-ids.md", legacyOf(CORE_CONTEXTS.map((c) => c.namespace)));
    write(X_DDD, spec("x.y", body).text);
    write(LOCK, lockFor([spec("x.y", lockBody)]));
    write("src/a.test.ts", "// r[verify x.y]\nit('holds', f);\n");
    write("src/dist/a.test.ts", "// r[verify x.unknown]\n");
  }
  const io = () => {
    const out: string[] = [];
    return { out, io: { log: (l: string) => out.push(l), error: (l: string) => out.push(l) } };
  };

  // r[verify platform.trace.bump]
  it("spec:bump writes the bumped marker and the lock, then spec:trace reports the stale test", () => {
    tree("Changed.", "Original.");
    const bump = io();
    expect(runSpecBump({ root, tree: "core", args: [], ...bump.io })).toBe(0);
    expect(bump.out).toEqual(["bumped x.y to +2 (docs/specs/ddd/x.md:5)", "wrote docs/specs/requirements.lock"]);
    expect(readFileSync(join(root, X_DDD), "utf8")).toContain("r[x.y+2]\n");
    expect(readFileSync(join(root, LOCK), "utf8")).toBe(`x.y 2 ${hashBody("Changed.")}\n`);

    const trace = io();
    expect(runSpecTrace({ root, trees: ["core"], args: [], ...trace.io })).toBe(1);
    expect(trace.out.join("\n")).toMatch(/src\/a\.test\.ts:1: stale reference r\[verify x\.y\]/);
  });

  // r[verify platform.trace.bump]
  it("spec:bump --editorial prints the id and keeps the version", () => {
    tree("Fixed.", "Fxied.");
    const bump = io();
    expect(runSpecBump({ root, tree: "core", args: ["--editorial", "x.y"], ...bump.io })).toBe(0);
    expect(bump.out[0]).toBe("editorial x.y: new hash recorded, version 1 kept");
    expect(readFileSync(join(root, X_DDD), "utf8")).toContain("r[x.y]\n");
  });

  // r[verify platform.trace.report]
  it("spec:trace exits 0 on a clean tree, ignoring build output", () => {
    tree("Same.");
    const trace = io();
    expect(runSpecTrace({ root, trees: ["core"], args: [], ...trace.io })).toBe(0);
    expect(trace.out.join("\n")).toMatch(/x \(core\): 1 requirement/);
  });
});
