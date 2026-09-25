import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// S37 (AH29) — the image's two roles. The entrypoint runs as the app by default
// (chown /data, migrate, drop to `node`), or — with ARTEFACTOR_ROLE=renderer —
// execs the renderer directly, never as root and with none of the app's setup.

const ROOT = resolve(import.meta.dirname, "../..");
const ENTRYPOINT = join(ROOT, "docker-entrypoint.sh");

// Run the entrypoint with `node`, `gosu`, `id`, `chown` and `mkdir` stubbed: each
// stub records its invocation, and `id -u` reports `uid`.
function runEntrypoint(env: Record<string, string>, uid: number) {
  const dir = mkdtempSync(join(tmpdir(), "entrypoint-"));
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const cmd of ["node", "gosu", "chown", "mkdir"]) {
    const stub = join(dir, cmd);
    writeFileSync(stub, `#!/bin/sh\necho "${cmd} $*" >> "${log}"\n`);
    chmodSync(stub, 0o755);
  }
  const id = join(dir, "id");
  writeFileSync(id, `#!/bin/sh\necho "id $*" >> "${log}"\necho ${uid}\n`);
  chmodSync(id, 0o755);

  const result = spawnSync("/bin/sh", [ENTRYPOINT], {
    cwd: dir,
    env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("id "));
  return { status: result.status, stderr: result.stderr, calls };
}

describe("docker-entrypoint.sh roles (S37)", () => {
  it("ARTEFACTOR_ROLE=renderer as uid 1000 execs the renderer, with no chown, migration or gosu", () => {
    const run = runEntrypoint({ ARTEFACTOR_ROLE: "renderer" }, 1000);
    expect(run.status).toBe(0);
    expect(run.calls).toEqual(["node dist/renderer/index.js"]);
  });

  it("ARTEFACTOR_ROLE=renderer as uid 0 refuses to start", () => {
    const run = runEntrypoint({ ARTEFACTOR_ROLE: "renderer" }, 0);
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.stderr).toMatch(/root/);
  });

  it.each<Record<string, string>>([{}, { ARTEFACTOR_ROLE: "app" }])(
    "the app role (%o) keeps today's path",
    (env) => {
      const run = runEntrypoint(env, 0);
      expect(run.status).toBe(0);
      expect(run.calls).toEqual([
        "mkdir -p /data",
        "chown -R node:node /data",
        "gosu node node dist/server/migrate.js",
        "gosu node node dist/server/index.js",
      ]);
    },
  );

  it("an unknown role refuses to start", () => {
    const run = runEntrypoint({ ARTEFACTOR_ROLE: "worker" }, 1000);
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
  });
});

describe("Dockerfile (S37)", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

  it("declares no VOLUME, so a renderer container gets no anonymous writable /data", () => {
    expect(dockerfile).not.toMatch(/^\s*VOLUME\b/im);
  });
});

// A Dockerfile as its stages: each stage is its `FROM` image and alias plus its
// instructions, with `\` continuations joined and comments dropped.
type Instruction = { op: string; args: string };
type Stage = { from: string; instructions: Instruction[] };

function parseStages(source: string): Map<string, Stage> {
  const lines = source
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const stages = new Map<string, Stage>();
  let current: Stage | undefined;
  for (const line of lines) {
    const space = line.search(/\s/);
    const op = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const args = space < 0 ? "" : line.slice(space).trim().replace(/\s+/g, " ");
    if (op === "FROM") {
      const [from = "", , name] = args.split(" ");
      current = { from, instructions: [] };
      stages.set(name ?? from, current);
    } else if (current) {
      current.instructions.push({ op, args });
    }
  }
  return stages;
}

// The ~600 MB Chromium layer must be keyed on the base image and the lockfile only,
// never on a per-commit input: the GIT_SHA build arg, or the build stage's
// node_modules (which `pnpm prune` rewrites on every build).
describe("Dockerfile layer caching (Chromium keyed on the lockfile only)", () => {
  const stages = parseStages(readFileSync(join(ROOT, "Dockerfile"), "utf8"));
  const stage = (name: string) => {
    const found = stages.get(name);
    if (!found) throw new Error(`no stage named ${name}`);
    return found;
  };
  const runtime = () => stage("runtime").instructions;
  const isChromiumRun = (i: Instruction) =>
    i.op === "RUN" && /playwright-core\/cli\.js install\b/.test(i.args);
  const isGitShaArg = (i: Instruction) => i.op === "ARG" && /^GIT_SHA\b/.test(i.args);

  it("the deps stage copies only the package manifests, and build is FROM deps", () => {
    const copies = stage("deps").instructions.filter((i) => i.op === "COPY");
    expect(copies.map((i) => i.args)).toEqual(["package.json pnpm-lock.yaml pnpm-workspace.yaml ./"]);
    expect(stage("build").from).toBe("deps");
  });

  it("installs Chromium before the first COPY --from=build and before ARG GIT_SHA", () => {
    const chromium = runtime().findIndex(isChromiumRun);
    expect(chromium).toBeGreaterThanOrEqual(0);
    const firstBuildCopy = runtime().findIndex((i) => i.op === "COPY" && /--from=build\b/.test(i.args));
    expect(firstBuildCopy).toBeGreaterThan(chromium);
    expect(runtime().findIndex(isGitShaArg)).toBeGreaterThan(chromium);
  });

  it("runs the Chromium install from a bind mount of deps, never of build", () => {
    const chromium = runtime().find(isChromiumRun);
    expect(chromium?.args).toMatch(/--mount=type=bind,\S*\bfrom=deps\b/);
    expect(chromium?.args).not.toMatch(/\bfrom=build\b/);
  });

  it("runs nothing after ARG GIT_SHA, so the per-commit value keys only metadata", () => {
    const arg = runtime().findIndex(isGitShaArg);
    expect(arg).toBeGreaterThanOrEqual(0);
    expect(runtime().slice(arg + 1).filter((i) => i.op === "RUN")).toEqual([]);
  });

  it("sets PLAYWRIGHT_BROWSERS_PATH before the Chromium install, and still sets GIT_SHA", () => {
    const browsersPath = runtime().findIndex(
      (i) => i.op === "ENV" && /\bPLAYWRIGHT_BROWSERS_PATH=\/ms-playwright\b/.test(i.args),
    );
    expect(browsersPath).toBeGreaterThanOrEqual(0);
    expect(browsersPath).toBeLessThan(runtime().findIndex(isChromiumRun));
    expect(runtime().some((i) => i.op === "ENV" && i.args.includes("GIT_SHA=${GIT_SHA}"))).toBe(true);
  });
});

describe("deploy/chromium-seccomp.json (S37)", () => {
  const profile = JSON.parse(readFileSync(join(ROOT, "deploy/chromium-seccomp.json"), "utf8")) as {
    defaultAction: string;
    syscalls: { names: string[]; action: string; includes?: object; excludes?: object; args?: unknown }[];
  };

  it("denies by default, like Docker's own profile", () => {
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
  });

  it("adds exactly clone, unshare and chroot for Chromium's sandbox, unconditionally", () => {
    const chromium = profile.syscalls.filter(
      (s) => s.action === "SCMP_ACT_ALLOW" && !s.includes && !s.excludes && !s.args &&
        s.names.some((n) => ["clone", "unshare", "chroot"].includes(n)),
    );
    expect(chromium.map((s) => [...s.names].sort())).toEqual([["chroot", "clone", "unshare"]]);
  });

  it("grants nothing else that Docker reserves for CAP_SYS_ADMIN", () => {
    const unconditional = profile.syscalls
      .filter((s) => s.action === "SCMP_ACT_ALLOW" && !s.includes && !s.args)
      .flatMap((s) => s.names);
    for (const name of ["mount", "setns", "bpf", "perf_event_open", "ptrace", "keyctl"]) {
      expect(unconditional).not.toContain(name);
    }
  });
});
