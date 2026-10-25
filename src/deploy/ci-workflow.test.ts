import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// ALI-466 — the quality gate as parallel jobs. A filter may only ever skip work
// safely: `browser` is skipped only on a pull request that touches none of its
// inputs, every other run (a push, each `workflow_call` from a deploy pipeline)
// runs everything, and `gate` reports one result — a skipped job counts as
// passed, a failed or cancelled one fails it.

const ROOT = resolve(import.meta.dirname, "../..");
const CI = join(ROOT, ".github/workflows/ci.yml");

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
}

interface Job {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflow = parse(readFileSync(CI, "utf8")) as Workflow;
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> })
  .scripts;

function job(name: string): Job {
  const j = workflow.jobs[name];
  if (!j) throw new Error(`ci.yml has no \`${name}\` job`);
  return j;
}

const stepsOf = (name: string) => job(name).steps ?? [];
const runsOf = (name: string) => stepsOf(name).flatMap((s) => (s.run ? [s.run] : []));
const needsOf = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);

// The paths that always run the browser suites: a change to any of them can
// break a browser test without touching `src/` (#101 was lockfile-only).
const SHARED_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig*.json",
  "vite*.config.ts",
  "vitest.config.ts",
  ".nvmrc",
  ".github/workflows/**",
  // The app build the e2e suite runs (vite.config.ts) reads these from the root.
  "index.html",
  "public/**",
];
// Every src/ tree a browser suite reaches: the suites themselves, what they
// import (the server they boot is mostly domain code), and vitest's setup file.
const BROWSER_TREES = [
  "src/client/**",
  "src/renderer/**",
  "src/server/**",
  "src/shared/**",
  "src/infra/**",
  "src/domain/**",
  "src/test/**",
];
const BROWSER_GLOB = "**/*.browser.test.ts";

function browserFilter(): string[] {
  const filter = stepsOf("changes").find((s) => s.uses?.startsWith("dorny/paths-filter@"));
  if (!filter) throw new Error("`changes` has no dorny/paths-filter step");
  const filters = parse(String(filter.with?.filters)) as Record<string, string[]>;
  return filters.browser ?? [];
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts") ? [relative(ROOT, path)] : [];
  });
}

// A value import (or dynamic import) of playwright-core — what launches a real
// browser. `import type` brings in only types, which a stub browser satisfies.
const importsPlaywright = (source: string) =>
  /^import\s+(?!type\s)[^;]*?from\s+["']playwright-core["']/m.test(source) ||
  /import\(\s*["']playwright-core["']\s*\)/.test(source);

describe("ci.yml: parallel jobs behind one gate (ALI-466)", () => {
  it("has the jobs changes, unit, browser and gate", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(["browser", "changes", "gate", "unit"]);
  });

  // ALI-590 — under workflow_call nothing reads `gate`: the caller job's result is the
  // called workflow's conclusion, which already fails on any failed inner job.
  it("gate needs the other three, runs on every pull request only, and fails on any failed or cancelled job", () => {
    const gate = job("gate");
    expect(needsOf(gate).sort()).toEqual(["browser", "changes", "unit"]);
    expect(gate.if).toMatch(/^\$\{\{\s*always\(\) && github\.event_name == 'pull_request'\s*\}\}$/);
    const verdict = stepsOf("gate")
      .map((s) => `${s.if ?? ""} ${JSON.stringify(s.env ?? {})} ${s.run ?? ""}`)
      .join("\n");
    expect(verdict).toContain("failure");
    expect(verdict).toContain("cancelled");
    expect(verdict).toMatch(/needs/);
    expect(verdict).not.toContain("skipped");
  });

  it("changes runs only on a pull request, and its browser filter names every shared input and the src trees", () => {
    expect(job("changes").if).toMatch(/github\.event_name\s*==\s*'pull_request'/);
    expect(job("changes").outputs?.browser).toMatch(/outputs\.browser/);
    const filter = browserFilter();
    for (const path of [...SHARED_INPUTS, ...BROWSER_TREES]) expect(filter, path).toContain(path);
  });

  it("changes diffs with git, so it needs no permission beyond contents: read", () => {
    // Through the API the filter would need `pull-requests: read`, which a
    // `workflow_call` caller capped at `contents: read` refuses at start-up.
    const filter = stepsOf("changes").find((s) => s.uses?.startsWith("dorny/paths-filter@"));
    expect(filter?.with?.token).toBe("");
    expect(filter?.with?.base).toBeTruthy();
  });

  it("browser runs whenever the event is not a pull request, and survives a skipped changes job", () => {
    const browser = job("browser");
    expect(needsOf(browser)).toContain("changes");
    expect(browser.if).toContain("!cancelled()");
    expect(browser.if).toMatch(/github\.event_name\s*!=\s*'pull_request'\s*\|\|/);
    expect(browser.if).toMatch(/needs\.changes\.outputs\.browser\s*==\s*'true'/);
  });

  it("unit installs no Chromium and excludes the browser suites; browser runs exactly them", () => {
    expect(runsOf("unit")).toContain("pnpm test:unit");
    for (const run of runsOf("unit")) expect(run).not.toMatch(/playwright|chromium/i);
    expect(stepsOf("unit").some((s) => s.uses?.startsWith("actions/cache@"))).toBe(false);
    expect(scripts["test:unit"]).toBe(`vitest run --exclude '${BROWSER_GLOB}'`);

    expect(runsOf("browser")).toContain("pnpm test:browser");
    expect(runsOf("browser").some((r) => /playwright-core install/.test(r))).toBe(true);
    expect(runsOf("browser")).toContain("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    expect(scripts["test:browser"]).toBe("vitest run .browser.test.ts");
    expect(scripts.test).toBe("vitest run");
  });

  // ALI-590 — folded into unit: a job of its own cost a runner, a checkout and an install.
  it("unit runs the typecheck and both linters after the unit tests", () => {
    const runs = runsOf("unit");
    const at = (r: string) => runs.indexOf(r);
    for (const r of ["pnpm check", "pnpm lint", "pnpm lint:md"]) expect(at(r)).toBeGreaterThan(at("pnpm test:unit"));
    expect(at("pnpm test:unit")).toBeGreaterThanOrEqual(0);
  });

  it("a failed unit test still lets the typecheck and linters report, once the install succeeded", () => {
    const steps = stepsOf("unit");
    const install = steps.find((s) => s.run === "pnpm install --frozen-lockfile");
    expect(install?.id).toBe("install");
    for (const r of ["pnpm check", "pnpm lint", "pnpm lint:md"]) {
      expect(steps.find((s) => s.run === r)?.if).toBe("${{ !cancelled() && steps.install.outcome == 'success' }}");
    }
  });

  it("caches Chromium by the installed playwright-core version and fetches it without apt", () => {
    const steps = stepsOf("browser");
    const cache = steps.find((s) => s.uses?.startsWith("actions/cache@"));
    expect(cache?.with?.path).toBe("~/.cache/ms-playwright");
    expect(String(cache?.with?.key)).toMatch(/playwright/);
    // No apt on every run: no --with-deps, and no install pair split on the cache hit.
    for (const s of steps) expect(s.run ?? "").not.toMatch(/--with-deps/);
    for (const s of steps) expect(s.if ?? "").not.toMatch(/cache-hit/);
    const get = steps.find((s) => s.name === "Get the browser");
    expect(get?.run?.trim()).toBe("pnpm exec playwright-core install chromium-headless-shell");
    expect(get?.["timeout-minutes"]).toBe(10);
  });

  it("makes apt fail fast and retry, before any Playwright install", () => {
    const steps = stepsOf("browser");
    const failFast = steps.findIndex((s) => (s.run ?? "").includes("/etc/apt/apt.conf.d/80-ci-fail-fast"));
    const firstInstall = steps.findIndex((s) => /playwright-core install/.test(s.run ?? ""));
    expect(failFast).toBeGreaterThanOrEqual(0);
    expect(failFast).toBeLessThan(firstInstall);
    const run = steps[failFast]?.run ?? "";
    expect(run).toMatch(/sudo tee/);
    for (const line of ['Acquire::Retries "3";', 'Acquire::http::Timeout "30";', 'Acquire::https::Timeout "30";'])
      expect(run).toContain(line);
  });

  describe("the OS-library gate runs install-deps only when a library is missing", () => {
    const gate = stepsOf("browser").find((s) => s.name === "Install missing OS libraries");
    const INSTALL_DEPS = "PNPM exec playwright-core install-deps chromium-headless-shell";
    const LDD = {
      ok: String.raw`printf '\tlibnss3.so => /lib/libnss3.so (0x1)\n'`,
      missing: String.raw`printf '\tlibnss3.so => /lib/libnss3.so (0x1)\n\tlibgbm.so.1 => not found\n'`,
      fails: "echo 'not a dynamic executable' >&2; exit 1",
    };

    // Runs the step's script as GitHub does (bash -eo pipefail), with a stub
    // `ldd` and `pnpm` on PATH and a HOME that holds a chrome-headless-shell or not.
    function runGate(ldd: keyof typeof LDD, binary: boolean) {
      const dir = mkdtempSync(join(tmpdir(), "ci-gate-"));
      try {
        const bin = join(dir, "bin");
        mkdirSync(bin);
        writeFileSync(join(bin, "ldd"), `#!/bin/bash\n${LDD[ldd]}\n`);
        writeFileSync(join(bin, "pnpm"), '#!/bin/bash\necho "PNPM $*"\n');
        chmodSync(join(bin, "ldd"), 0o755);
        chmodSync(join(bin, "pnpm"), 0o755);
        const home = join(dir, "home");
        const shellDir = join(home, ".cache/ms-playwright/chromium_headless_shell-1/chrome-headless-shell-linux64");
        mkdirSync(shellDir, { recursive: true });
        if (binary) writeFileSync(join(shellDir, "chrome-headless-shell"), "");
        const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", gate?.run ?? "exit 99"], {
          env: { HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` },
          encoding: "utf8",
        });
        return { status: res.status, out: res.stdout + res.stderr };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("is a step with its own 10-minute limit", () => {
      expect(gate?.["timeout-minutes"]).toBe(10);
    });

    it("skips install-deps when ldd finds every library", () => {
      const { status, out } = runGate("ok", true);
      expect(status).toBe(0);
      expect(out).toMatch(/OS libraries present/);
      expect(out).not.toContain(INSTALL_DEPS);
    });

    it("runs install-deps, naming the library, when ldd reports one not found", () => {
      const { status, out } = runGate("missing", true);
      expect(status).toBe(0);
      expect(out).toMatch(/libgbm\.so\.1 => not found/);
      expect(out).toMatch(/Missing OS libraries/);
      expect(out).toContain(INSTALL_DEPS);
    });

    it("fails safe to install-deps when no binary is found", () => {
      const { status, out } = runGate("ok", false);
      expect(status).toBe(0);
      expect(out).toMatch(/No chrome-headless-shell under/);
      expect(out).toContain(INSTALL_DEPS);
    });

    it("fails safe to install-deps when ldd fails, showing its output", () => {
      const { status, out } = runGate("fails", true);
      expect(status).toBe(0);
      expect(out).toMatch(/ldd failed on .*: installing the OS libraries\.\nnot a dynamic executable/);
      expect(out).toContain(INSTALL_DEPS);
    });
  });

  it("every test file that imports playwright-core is a *.browser.test.ts", () => {
    const browserSuites = testFiles(join(ROOT, "src")).filter((f) =>
      importsPlaywright(readFileSync(join(ROOT, f), "utf8")),
    );
    expect(browserSuites.length).toBeGreaterThan(0);
    for (const file of browserSuites) expect(file).toMatch(/\.browser\.test\.ts$/);
  });

  it("pins every action to a commit SHA, reads only contents, and persists no credentials", () => {
    const steps = Object.keys(workflow.jobs).flatMap(stepsOf);
    for (const s of steps.filter((s) => s.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [name, j] of Object.entries(workflow.jobs)) expect(j.permissions, name).toBeUndefined();
    const checkouts = steps.filter((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const s of checkouts) expect(s.with?.["persist-credentials"]).toBe(false);
  });

  it("still triggers on pull_request and workflow_call, with no path filter on either", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "workflow_call"]);
    for (const trigger of Object.values(workflow.on)) {
      const t = (trigger ?? {}) as Record<string, unknown>;
      expect(t.paths).toBeUndefined();
      expect(t["paths-ignore"]).toBeUndefined();
    }
  });
});
