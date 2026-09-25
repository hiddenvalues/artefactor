import Database from "better-sqlite3";
import { env } from "../../server/env";
import { FilesystemPayloadStore } from "../storage/payload-store";
import { runExportCommand } from "./command";

// S39 — `pnpm export:bundle --out <dir>` / `--verify <dir>`; bundled to
// dist/server/export.js, so inside the image an operator runs
// `node dist/server/export.js --out /data/export-…` as the `node` user. Reads the
// deployment named by DATABASE_PATH / ARTEFACTOR_PAYLOAD_DIR, like migrate.ts —
// but opens the database read-only (DX1) rather than through db/client.ts.

process.exitCode = await runExportCommand(process.argv.slice(2), {
  openDatabase: () => new Database(env.DATABASE_PATH, { readonly: true, fileMustExist: true }),
  payloadStore: new FilesystemPayloadStore(env.ARTEFACTOR_PAYLOAD_DIR),
  build: env.GIT_SHA,
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
