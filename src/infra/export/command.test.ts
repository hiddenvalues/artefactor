import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runExportCommand } from "./command";
import { openSource, seedDeployment, type SeededDeployment } from "./fixture";

// S39 — the operator CLI: `--out <dir>` exports, `--verify <dir>` checks a
// bundle; every failure exits non-zero and names the failing check.

function run(seed: SeededDeployment, argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opened = 0;
  const code = runExportCommand(argv, {
    openDatabase: () => {
      opened++;
      return openSource(seed.dbPath, { readonly: true });
    },
    payloadStore: seed.payloadStore,
    build: "cli-test",
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
  });
  return code.then((exitCode) => ({
    exitCode,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    opened: () => opened,
  }));
}

describe("export CLI (S39)", () => {
  it("--out exports the deployment and prints the counts; --verify then exits 0 with the counts", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    const exported = await run(seed, ["--out", out]);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain(out);
    expect(exported.stdout).toMatch(/artefacts\s+6/);

    const verified = await run(seed, ["--verify", out]);
    expect(verified.exitCode).toBe(0);
    expect(verified.stdout).toMatch(/accounts\s+2/);
    expect(verified.stdout).toMatch(/payloads\s+5/);
    expect(verified.opened()).toBe(0); // verify never touches the database
  });

  it("--verify on a tampered bundle exits non-zero, naming the failing check", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    expect((await run(seed, ["--out", out])).exitCode).toBe(0);
    const name = readdirSync(join(out, "payloads"))[0]!;
    writeFileSync(join(out, "payloads", name), "tampered");
    const verified = await run(seed, ["--verify", out]);
    expect(verified.exitCode).not.toBe(0);
    expect(verified.stderr).toContain("payload");
  });

  it("--out on a non-empty directory is refused, with nothing written", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "occupied");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "mine");
    const res = await run(seed, ["--out", out]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("out");
    expect(readdirSync(out)).toEqual(["keep.txt"]);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it("an export with a missing payload exits non-zero and leaves no bundle", async () => {
    const seed = await seedDeployment();
    rmSync(join(seed.payloadDir, seed.ref("a-auth")));
    const out = join(seed.dir, "bundle");
    const res = await run(seed, ["--out", out]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("payload");
    expect(existsSync(out)).toBe(false);
  });

  it.each([[[]], [["--out"]], [["--frobnicate", "x"]], [["--out", "a", "--verify", "b"]]])(
    "prints usage and exits 2 for %j",
    async (argv) => {
      const seed = await seedDeployment();
      const res = await run(seed, argv);
      expect(res.exitCode).toBe(2);
      expect(res.stderr).toContain("--out <dir>");
    },
  );
});
