import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// ALI-414 — the demo seed writes a fixed, published password, so it refuses to
// run anywhere but a local checkout. Checked before anything is written or
// deleted; each guard returns why it refuses, or null.

export interface SeedGuardInput {
  nodeEnv: string | undefined;
  // BETTER_AUTH_URL (or its dev default).
  authUrl: string;
  reset: boolean;
  // DATABASE_PATH, ARTEFACTOR_PAYLOAD_DIR, ARTEFACTOR_THUMBNAIL_DIR as given.
  paths: string[];
  // What relative paths resolve against.
  cwd: string;
  // The repository checkout `--reset` may delete inside.
  repoRoot: string;
}

// `localhost`, `127.0.0.1`, or a `*.localhost` name (the portless form).
function isLocalHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

// The path as `rmSync` will reach it: its deepest existing ancestor resolved
// through every symlink, with the not-yet-existing segments appended. A lexical
// check alone would let a symlinked `data/` send a reset outside the checkout.
function canonical(path: string): string {
  let existing = path;
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

// Strictly inside the checkout: the root itself would be deleted whole. Segment
// aware, so a directory named `..data` is inside.
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function seedGuardProblem(input: SeedGuardInput): string | null {
  if (input.nodeEnv === "production") {
    return "refusing to seed the demo with NODE_ENV=production";
  }
  if (!isLocalHost(input.authUrl)) {
    return `refusing to seed the demo: BETTER_AUTH_URL (${input.authUrl}) is not localhost, 127.0.0.1 or a *.localhost name`;
  }
  if (input.reset) {
    const root = canonical(resolve(input.repoRoot));
    const outside = input.paths
      .map((p) => canonical(resolve(input.cwd, p)))
      .filter((p) => !isInside(root, p));
    if (outside.length > 0) {
      return `refusing --reset: ${outside.join(", ")} resolves outside the checkout (${root})`;
    }
  }
  return null;
}
