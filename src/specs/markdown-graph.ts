// The repo's Markdown link graph, one definition for every reader of it: which files a doc links
// to, which tracked docs that resolves to, and which docs no chain of links reaches from a front
// door. `markdown-links.test.ts` holds the tree to it; the cloud's docs map draws it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));

/** The paths `.markdownlint-cli2.jsonc` ignores; tracked worktree checkouts are none of our business. */
const IGNORED = /(^|\/)node_modules\/|^dist\/|^\.claude\/worktrees\//;

/** Inline links and images: `](target)`, with an optional `"title"` after the target. */
const LINK = /\]\(([^()]*)\)/g;

/** A URI scheme — `https:`, `mailto:` — which names no file in this repo. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The repo-relative targets `markdown` links to as files, resolved against `file`'s own directory
 * (or the repo root for a root-absolute target). Fragments, external URLs and placeholders drop
 * out; an angle-bracket destination is unwrapped, so `[x](<docs/a.md>)` is still a path to check
 * while a template's `[ALI-N](<linear url>)` — whitespace, so never a path here — is not.
 */
export function fileTargets(markdown: string, file: string): { target: string; path: string }[] {
  const dir = posix.dirname(file);
  const targets: { target: string; path: string }[] = [];
  for (const [, raw] of markdown.matchAll(LINK)) {
    // `[x](./a.md "Title")` — the title is not part of the destination.
    const target = raw!.trim().replace(/\s+["'].*["']$/, "");
    const destination = /^<([^<>]*)>$/.exec(target)?.[1] ?? target;
    const [path] = destination.split("#");
    if (path === "" || SCHEME.test(destination) || /\s/.test(destination)) continue;
    targets.push({
      target,
      path: posix.normalize(path!.startsWith("/") ? path!.slice(1) : posix.join(dir, path!)),
    });
  }
  return targets;
}

/**
 * `<file> → <target>` for every link in `markdown` whose target is missing. A target that climbs
 * out of the repository is broken whatever sits at that path on the host — it is not ours to link.
 */
export function brokenLinks(markdown: string, file: string): string[] {
  return fileTargets(markdown, file)
    .filter(
      ({ path }) =>
        path === ".." || path.startsWith("../") || !existsSync(posix.join(root, path)),
    )
    .map(({ target }) => `${file} → ${target}`);
}

export function trackedMarkdown(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: root, encoding: "utf8" });
  return listed.split("\0").filter((path) => path !== "" && !IGNORED.test(path));
}

/** The front doors: what a session reads first (`CLAUDE.md`) and what a person reads first. */
export const FRONT_DOORS = ["CLAUDE.md", "README.md"];

/**
 * A file its own tool loads by name, so it needs no inbound link: an Agent Skill (`SKILL.md`), and
 * anything under a top-level dot-directory (`.claude/`, `.github/`, …), which its tool owns. Each
 * is an entry point, and what it links is reachable through it.
 */
export function isEntryPoint(file: string): boolean {
  return posix.basename(file) === "SKILL.md" || file.startsWith(".");
}

/** A CLAUDE.md import line (`@path/to/file.md`), which loads that file as if linked. */
const IMPORT = /^@(\S+\.md)$/gm;

/**
 * The tracked Markdown files `file` leads to. A link to a folder leads to its `README.md`, or —
 * a folder without one is read by listing it — to every Markdown file directly inside it.
 */
export function edges(markdown: string, file: string, tracked: Set<string>): string[] {
  const paths = fileTargets(markdown, file).map(({ path }) => path.replace(/\/$/, ""));
  for (const [, imported] of markdown.matchAll(IMPORT)) {
    paths.push(posix.normalize(posix.join(posix.dirname(file), imported!)));
  }
  return paths.flatMap((path) => {
    if (tracked.has(path)) return [path];
    if (tracked.has(`${path}/README.md`)) return [`${path}/README.md`];
    return [...tracked].filter((other) => posix.dirname(other) === path);
  });
}

/** Every tracked file no chain of links reaches from a front door or an entry point. */
export function unreachable(files: Map<string, string>): string[] {
  const tracked = new Set(files.keys());
  const queue = [...tracked].filter((file) => FRONT_DOORS.includes(file) || isEntryPoint(file));
  const reached = new Set(queue);
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const next of edges(files.get(file)!, file, tracked)) {
      if (!reached.has(next)) reached.add(next) && queue.push(next);
    }
  }
  return [...tracked].filter((file) => !reached.has(file)).sort();
}
