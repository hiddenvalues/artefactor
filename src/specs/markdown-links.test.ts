import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every tracked Markdown file's relative links must resolve to something that exists. Nothing else
// in CI catches a link that rots when a file moves (`pnpm lint:md` checks style, not targets), and
// the narrative docs link each other, the specs and the source tree constantly.
//
// Only the file part is checked: a `#fragment` is dropped, external URLs are never fetched, and the
// angle-bracket placeholders the skills' templates carry (`[ALI-N](<linear url>)`) name no file.

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The paths `.markdownlint-cli2.jsonc` ignores; tracked worktree checkouts are none of our business. */
const IGNORED = /(^|\/)node_modules\/|^dist\/|^\.claude\/worktrees\//;

/** Inline links and images: `](target)`, with an optional `"title"` after the target. */
const LINK = /\]\(([^()]*)\)/g;

/** A URI scheme — `https:`, `mailto:` — which names no file in this repo. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The repo-relative targets `markdown` links to as files, resolved against `file`'s own directory
 * (or the repo root for a root-absolute target). Fragments, external URLs and placeholders drop out.
 */
function fileTargets(markdown: string, file: string): { target: string; path: string }[] {
  const dir = posix.dirname(file);
  const targets: { target: string; path: string }[] = [];
  for (const [, raw] of markdown.matchAll(LINK)) {
    // `[x](./a.md "Title")` — the title is not part of the destination.
    const target = raw!.trim().replace(/\s+["'].*["']$/, "");
    const [path] = target.split("#");
    if (path === "" || SCHEME.test(target) || target.startsWith("<")) continue;
    targets.push({
      target,
      path: posix.normalize(path!.startsWith("/") ? path!.slice(1) : posix.join(dir, path!)),
    });
  }
  return targets;
}

/** `<file> → <target>` for every link in `markdown` whose target is missing from disk. */
function brokenLinks(markdown: string, file: string): string[] {
  return fileTargets(markdown, file)
    .filter(({ path }) => !existsSync(posix.join(root, path)))
    .map(({ target }) => `${file} → ${target}`);
}

function trackedMarkdown(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: root, encoding: "utf8" });
  return listed.split("\0").filter((path) => path !== "" && !IGNORED.test(path));
}

describe("markdown links", () => {
  it("reports a relative link whose target does not exist", () => {
    expect(brokenLinks("[x](./does-not-exist.md)", "docs/specs/README.md")).toEqual([
      "docs/specs/README.md → ./does-not-exist.md",
    ]);
  });

  it("resolves a relative target against the linking file's directory", () => {
    expect(brokenLinks("[x](./renderer-isolation.md)", "docs/deployment.md")).toEqual([]);
    // The same target one directory down resolves elsewhere, and misses.
    expect(brokenLinks("[x](./renderer-isolation.md)", "docs/specs/README.md")).toHaveLength(1);
  });

  it("resolves a root-absolute target against the repo root", () => {
    expect(brokenLinks("[x](/docs/deployment.md)", "docs/specs/README.md")).toEqual([]);
  });

  it("checks the file part only, never the fragment", () => {
    expect(brokenLinks("[x](./renderer-isolation.md#no-such-anchor)", "docs/deployment.md")).toEqual([]);
    expect(brokenLinks("[x](#no-such-anchor)", "docs/deployment.md")).toEqual([]);
  });

  it("never follows an external link", () => {
    expect(brokenLinks("[x](https://example.com/gone.md)", "README.md")).toEqual([]);
    expect(brokenLinks("[x](mailto:nobody@example.com)", "README.md")).toEqual([]);
  });

  it("ignores a template's angle-bracket placeholder", () => {
    expect(brokenLinks("Implements [ALI-N](<linear url>).", ".claude/skills/implement/SKILL.md")).toEqual([]);
  });

  it("leaves every link in every tracked Markdown file resolving", () => {
    const files = trackedMarkdown();
    expect(files.length).toBeGreaterThan(20);
    const broken = files.flatMap((file) =>
      brokenLinks(readFileSync(posix.join(root, file), "utf8"), file),
    );
    expect(broken).toEqual([]);
  });
});
