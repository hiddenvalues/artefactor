import type Database from "better-sqlite3";
import type { PayloadStore } from "../../domain/artefact/ports";
import { exportBundle } from "./export-bundle";
import { BundleError, type ManifestCounts } from "./format";
import { readBundle } from "./read-bundle";

// S39 — the operator CLI's logic, apart from its process wiring (cli.ts):
//   --out <dir>     export the deployment into a new bundle directory
//   --verify <dir>  run readBundle over a bundle and print its counts
// Returns the exit code: 0 on success, 1 on a failed export/verify (naming the
// check), 2 on a usage error.

// What --out needs, loaded only for --out: --verify reads nothing but the
// bundle, so it must not depend on the server's configuration.
export interface ExportSource {
  // Opened read-only (DX1).
  openDatabase: () => Database.Database;
  payloadStore: PayloadStore;
  build: string;
}

export interface ExportCommandDeps {
  loadSource: () => Promise<ExportSource>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const USAGE = [
  "usage: export --out <dir>     write this deployment's export bundle into <dir> (new or empty)",
  "       export --verify <dir>  check a bundle and print its counts",
].join("\n");

export async function runExportCommand(argv: string[], deps: ExportCommandDeps): Promise<number> {
  const [flag, dir, ...rest] = argv;
  if ((flag !== "--out" && flag !== "--verify") || !dir || dir.startsWith("--") || rest.length > 0) {
    deps.stderr(USAGE);
    return 2;
  }

  if (flag === "--verify") {
    try {
      const bundle = await readBundle(dir);
      deps.stdout(`${dir}: a valid ${bundle.manifest.format} ${bundle.manifest.version} bundle`);
      deps.stdout(`exported ${bundle.manifest.exportedAt} from build ${bundle.manifest.source.build}`);
      deps.stdout(formatCounts(bundle.manifest.counts));
      return 0;
    } catch (e) {
      return fail(deps, "verify", e);
    }
  }

  let sqlite: Database.Database | undefined;
  try {
    const source = await deps.loadSource();
    sqlite = source.openDatabase();
    const manifest = await exportBundle({
      sqlite,
      payloadStore: source.payloadStore,
      out: dir,
      build: source.build,
    });
    deps.stdout(`exported to ${dir}`);
    deps.stdout(formatCounts(manifest.counts));
    return 0;
  } catch (e) {
    return fail(deps, "export", e);
  } finally {
    sqlite?.close();
  }
}

function fail(deps: ExportCommandDeps, what: string, e: unknown): number {
  if (e instanceof BundleError) deps.stderr(`${what} failed — ${e.check}: ${e.message}`);
  else deps.stderr(`${what} failed — ${e instanceof Error ? e.message : String(e)}`);
  return 1;
}

function formatCounts(counts: ManifestCounts): string {
  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  return Object.entries(counts)
    .map(([k, v]) => `  ${k.padEnd(width)}  ${v}`)
    .join("\n");
}
