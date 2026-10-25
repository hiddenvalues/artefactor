import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterAll, describe, it } from "vitest";

// ALI-414 — `pnpm dev:seed` as a process: its exit code, its output and what it
// leaves on disk. Each run gets its own database + payload + thumbnail dirs.
const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const tsx = join(repoRoot, "node_modules/.bin/tsx");
const cleanup: string[] = [];

afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Workspace {
  dir: string;
  env: NodeJS.ProcessEnv;
}

// `--reset` only deletes inside the checkout (guard 3), so a workspace a reset
// test uses lives under the gitignored `data/`.
function workspace(insideCheckout = false): Workspace {
  const parent = insideCheckout ? join(repoRoot, "data") : tmpdir();
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "seed-demo-test-"));
  cleanup.push(dir);
  return {
    dir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://localhost:3000",
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.com",
      DATABASE_PATH: join(dir, "artefactor.db"),
      ARTEFACTOR_PAYLOAD_DIR: join(dir, "payloads"),
      ARTEFACTOR_THUMBNAIL_DIR: join(dir, "thumbnails"),
    },
  };
}

async function seed(ws: Workspace, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await run(tsx, ["src/dev/seed-demo.ts", ...args], {
      cwd: repoRoot,
      env: { ...ws.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

const TABLES = [
  "user",
  "artefact",
  "collection",
  "artefact_access",
  "artefact_bookmark",
  "data_entry",
] as const;

function contents(ws: Workspace) {
  const db = new Database(ws.env.DATABASE_PATH!, { readonly: true });
  try {
    const counts = Object.fromEntries(
      TABLES.map((t) => [t, (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n]),
    );
    const titles = (db.prepare("SELECT title FROM artefact ORDER BY title").all() as { title: string }[]).map(
      (r) => r.title,
    );
    return { counts, titles };
  } finally {
    db.close();
  }
}

// The cases share nothing (each has its own workspace), and each spawns one or
// more full seeds, so they run concurrently: the file costs its slowest case.
describe.concurrent("pnpm dev:seed", { timeout: 60_000 }, () => {
  it("seeds an empty database, exits 0 and prints the sign-in details", async ({ expect }) => {
    const ws = workspace();
    const out = await seed(ws);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("http://localhost:3000");
    expect(out.stdout).toContain("demo@example.com");
    expect(out.stdout).toContain("maya@example.com");
    expect(out.stdout).toContain("artefactor-demo");
    expect(contents(ws).titles).toHaveLength(10);
  });

  it("prints the portless URL when run under portless", async ({ expect }) => {
    const ws = workspace();
    const out = await seed(ws, [], {
      BETTER_AUTH_URL: "https://ali-414.artefactor.localhost",
      PORTLESS_URL: "https://ali-414.artefactor.localhost",
    });
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("https://ali-414.artefactor.localhost");
  });

  it("is idempotent: a second run says already seeded and adds no rows", async ({ expect }) => {
    const ws = workspace();
    expect((await seed(ws)).code).toBe(0);
    const before = contents(ws);
    const again = await seed(ws);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain("already seeded");
    expect(again.stdout).toContain("artefactor-demo");
    expect(contents(ws)).toEqual(before);
  });

  it("fails a partially seeded database and points at --reset instead of calling it seeded", async ({ expect }) => {
    const ws = workspace();
    expect((await seed(ws)).code).toBe(0);
    const db = new Database(ws.env.DATABASE_PATH!);
    db.prepare("DELETE FROM artefact WHERE title = ?").run("Mobile nav prototype");
    db.close();
    const out = await seed(ws);
    expect(out.code).not.toBe(0);
    expect(out.stdout).not.toContain("already seeded");
    expect(out.stderr).toContain("--reset");
    expect(out.stderr).toContain("Mobile nav prototype");
  });

  it("fails a database whose seed never recorded completion, even with every item present", async ({ expect }) => {
    const ws = workspace();
    expect((await seed(ws)).code).toBe(0);
    rmSync(`${ws.env.DATABASE_PATH!}.seeded`);
    const out = await seed(ws);
    expect(out.code).not.toBe(0);
    expect(out.stdout).not.toContain("already seeded");
    expect(out.stderr).toContain("--reset");
  });

  it("drops a stale completion marker before seeding, so a failed seed never inherits it", async ({ expect }) => {
    const ws = workspace();
    expect((await seed(ws)).code).toBe(0);
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${ws.env.DATABASE_PATH!}${suffix}`, { force: true });
    // Sign-up is refused by the allowlist, so the fresh seed fails at its first route.
    const out = await seed(ws, [], { AUTH_ALLOWED_EMAIL_DOMAINS: "example.org" });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("POST /api/auth/sign-up/email");
    expect(existsSync(`${ws.env.DATABASE_PATH!}.seeded`)).toBe(false);
  });

  it("--reset on a seeded database yields the same contents as a fresh seed", async ({ expect }) => {
    const fresh = workspace();
    expect((await seed(fresh)).code).toBe(0);

    const ws = workspace(true);
    expect((await seed(ws)).code).toBe(0);
    writeFileSync(join(ws.dir, "payloads", "stray.html"), "left over");
    const reset = await seed(ws, ["--reset"]);
    expect(reset.code, reset.stderr).toBe(0);
    expect(contents(ws)).toEqual(contents(fresh));
    expect(existsSync(join(ws.dir, "payloads", "stray.html"))).toBe(false);
  });

  it("refuses NODE_ENV=production and leaves the database untouched (guard 1)", async ({ expect }) => {
    const ws = workspace();
    const out = await seed(ws, [], { NODE_ENV: "production" });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(/production/);
    expect(existsSync(ws.env.DATABASE_PATH!)).toBe(false);
  });

  it("refuses a non-local BETTER_AUTH_URL (guard 2)", async ({ expect }) => {
    const ws = workspace();
    const out = await seed(ws, [], { BETTER_AUTH_URL: "https://app.example.com" });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(/BETTER_AUTH_URL/);
    expect(existsSync(ws.env.DATABASE_PATH!)).toBe(false);
  });

  it("refuses --reset on a database outside the checkout and deletes nothing (guard 3)", async ({ expect }) => {
    const ws = workspace();
    expect((await seed(ws)).code).toBe(0);
    const before = statSync(ws.env.DATABASE_PATH!).mtimeMs;
    const payloads = readdirSync(join(ws.dir, "payloads")).length;
    const out = await seed(ws, ["--reset"]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(/outside/);
    expect(statSync(ws.env.DATABASE_PATH!).mtimeMs).toBe(before);
    expect(readdirSync(join(ws.dir, "payloads"))).toHaveLength(payloads);
  });
});
