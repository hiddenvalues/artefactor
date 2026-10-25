import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_FIXTURE, DEMO_PASSWORD, DEMO_PEOPLE } from "./seed-demo.fixtures";
import { seedGuardProblem } from "./seed-guards";

// ALI-414 — `pnpm dev:seed [--reset]`: a local SQLite database with two people
// and a spread of content, for checking a branch by hand. The guards run on the
// raw environment before anything opens the database: the server's `env` and
// db client are imported only once they pass (and after a reset has deleted
// the old files).

const DEFAULTS = {
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_PATH: "./data/artefactor.db",
  ARTEFACTOR_PAYLOAD_DIR: "./data/payloads",
  ARTEFACTOR_THUMBNAIL_DIR: "./data/thumbnails",
} as const;

const setting = (name: keyof typeof DEFAULTS) => process.env[name] || DEFAULTS[name];

function signInDetails(): string {
  const authUrl = setting("BETTER_AUTH_URL");
  const url = process.env.PORTLESS_URL || new URL(authUrl).origin;
  // Plain `pnpm dev` serves the client from Vite, not from BETTER_AUTH_URL's port.
  const viaVite = !process.env.PORTLESS_URL && !process.env.BETTER_AUTH_URL
    ? "\n  (under plain `pnpm dev`, open http://localhost:5273)"
    : "";
  return [
    `Sign in at ${url}${viaVite}`,
    `  ${DEMO_PEOPLE.demo.email}  (${DEMO_PEOPLE.demo.name}, the one to sign in as)`,
    `  ${DEMO_PEOPLE.maya.email}  (${DEMO_PEOPLE.maya.name})`,
    `  password: ${DEMO_PASSWORD}`,
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const reset = argv.includes("--reset");
  const dbPath = setting("DATABASE_PATH");
  const dirs = [setting("ARTEFACTOR_PAYLOAD_DIR"), setting("ARTEFACTOR_THUMBNAIL_DIR")];
  // Written only once `seedDemo` has finished, so a run that failed at any step
  // (even after its last artefact was created) never reads as seeded.
  const marker = `${dbPath}.seeded`;
  const problem = seedGuardProblem({
    nodeEnv: process.env.NODE_ENV,
    authUrl: setting("BETTER_AUTH_URL"),
    reset,
    paths: [dbPath, marker, ...dirs],
    cwd: process.cwd(),
    repoRoot: resolve(import.meta.dirname, "../.."),
  });
  if (problem) {
    console.error(problem);
    return 1;
  }

  if (reset) {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, marker, ...dirs]) {
      rmSync(file, { recursive: true, force: true });
    }
    console.log("Reset: removed the database, payloads and thumbnails.");
  }

  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, sqlite } = await import("../infra/db/client");
  const { env } = await import("../server/env");
  migrate(db, { migrationsFolder: env.MIGRATIONS_DIR });

  // Seeded means the demo person exists. Complete means the last seed recorded
  // that it finished, and every fixture person and artefact is still there: a
  // run that failed partway leaves the first without the second, and only
  // --reset recovers from that.
  const hasUser = sqlite.prepare("SELECT 1 FROM user WHERE email = ?");
  if (hasUser.get(DEMO_PEOPLE.demo.email)) {
    const hasTitle = sqlite.prepare("SELECT 1 FROM artefact WHERE title = ?");
    const missing = [
      ...Object.values(DEMO_FIXTURE.people).filter((p) => !hasUser.get(p.email)).map((p) => p.email),
      ...DEMO_FIXTURE.artefacts.filter((a) => !hasTitle.get(a.title)).map((a) => a.title),
    ];
    sqlite.close();
    if (!existsSync(marker) || missing.length > 0) {
      const what = missing.length > 0 ? `missing: ${missing.join(", ")}` : "the last seed did not finish";
      console.error(
        `The demo in ${dbPath} is only partly seeded (${what}). Run \`pnpm dev:seed --reset\` to start over.`,
      );
      return 1;
    }
    console.log(`Demo already seeded in ${dbPath} (use --reset to start over).\n${signInDetails()}`);
    return 0;
  }

  // A marker left beside a database that was deleted by hand belongs to that
  // old seed, not this one.
  rmSync(marker, { force: true });

  const { createApp } = await import("../server/app");
  const { seedDemo } = await import("./seed-demo.lib");
  // The app's request logger would print every seed call; keep the output to
  // the result. It binds `console.log` when the app is built, so stub it first.
  const log = console.log;
  console.log = () => {};
  try {
    const app = createApp();
    await seedDemo((path, init) => Promise.resolve(app.request(path, init)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("The demo is now only partly seeded: run `pnpm dev:seed --reset` to start over.");
    return 1;
  } finally {
    console.log = log;
  }
  sqlite.close();
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  console.log(`Seeded the demo in ${dbPath}.\n${signInDetails()}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
