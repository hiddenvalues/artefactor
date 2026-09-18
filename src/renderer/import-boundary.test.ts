import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// S37 (AH29) — the renderer role and the app are kept apart by their import
// graphs: nothing the renderer loads may reach the app's env (secrets), the
// database, payload/thumbnail storage or auth; nothing the app loads may reach
// Chromium. Walks every transitive relative import from each source file.

const ROOT = resolve(import.meta.dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8");
  return [...code.matchAll(SPECIFIER)].map((m) => (m[1] ?? m[2] ?? m[3])!);
}

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Every module (repo-relative path, or bare package name) reachable from `entry`.
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    const key = relative(ROOT, file);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) {
        const target = resolveRelative(file, spec);
        if (target) stack.push(target);
      } else {
        seen.add(spec);
      }
    }
  }
  return seen;
}

function violations(dir: string, forbidden: (module: string) => boolean): string[] {
  return sourceFiles(join(ROOT, dir)).flatMap((file) =>
    [...reachable(file)].filter(forbidden).map((m) => `${relative(ROOT, file)} → ${m}`),
  );
}

describe("renderer / app import boundary (S37, AH29)", () => {
  it("finds the modules it is meant to police (the walker works)", () => {
    const fromAdapters = reachable(join(ROOT, "src/server/adapters.ts"));
    expect(fromAdapters).toContain("src/server/env.ts");
    expect(fromAdapters).toContain("src/infra/db/client.ts");
    expect(sourceFiles(join(ROOT, "src/renderer")).length).toBeGreaterThan(0);
  });

  it("nothing under src/renderer/ reaches the server env, the database, storage or auth", () => {
    const forbidden = (m: string) =>
      m === "src/server/env.ts" ||
      m.startsWith("src/infra/db/") ||
      m.startsWith("src/infra/storage/") ||
      m === "src/server/auth.ts" ||
      m === "better-auth" ||
      m.startsWith("better-auth/") ||
      m === "better-sqlite3" ||
      m.startsWith("drizzle-orm");
    expect(violations("src/renderer", forbidden)).toEqual([]);
  });

  it("nothing under src/server/ reaches playwright-core or the Playwright renderer", () => {
    const forbidden = (m: string) =>
      m === "playwright-core" || m.startsWith("playwright-core/") || /playwright-thumbnail-renderer/.test(m);
    expect(violations("src/server", forbidden)).toEqual([]);
  });
});
