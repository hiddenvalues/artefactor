import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { brokenLinks, root, trackedMarkdown, unreachable } from "./markdown-graph";

// Every tracked Markdown file's relative links must resolve to something that exists. Nothing else
// in CI catches a link that rots when a file moves (`pnpm lint:md` checks style, not targets), and
// the narrative docs link each other, the specs and the source tree constantly.
//
// Only the file part is checked: a `#fragment` is dropped, external URLs are never fetched, and the
// angle-bracket placeholders the skills' templates carry (`[ALI-N](<linear url>)`) name no file.
//
// Every tracked Markdown file must also be *reachable*: a chain of links leads to it from a front
// door, so a session that starts at `CLAUDE.md` finds it without a repo-wide search. A doc nothing
// links to is how the tree goes messy unnoticed — it still resolves, it is just never read.

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

  it("still checks an angle-bracket destination that names a path", () => {
    expect(brokenLinks("[x](<renderer-isolation.md>)", "docs/deployment.md")).toEqual([]);
    expect(brokenLinks("[x](<does-not-exist.md>)", "docs/deployment.md")).toEqual([
      "docs/deployment.md → <does-not-exist.md>",
    ]);
  });

  it("reports a target that climbs out of the repository", () => {
    // Enough `..` to clamp at `/` from any checkout depth: the file exists, but it is not ours.
    const escaping = "[x](../../../../../../../../../../../../etc/passwd)";
    expect(brokenLinks(escaping, "docs/specs/README.md")).toHaveLength(1);
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

describe("markdown reachability", () => {
  const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it("reports a file no link leads to", () => {
    expect(unreachable(tree({ "CLAUDE.md": "[a](docs/a.md)", "docs/a.md": "", "docs/b.md": "" }))).toEqual([
      "docs/b.md",
    ]);
  });

  it("follows links transitively, from either front door", () => {
    const files = tree({
      "CLAUDE.md": "[a](docs/a.md)",
      "docs/a.md": "[b](b.md)",
      "docs/b.md": "",
      "README.md": "[c](docs/c.md)",
      "docs/c.md": "",
    });
    expect(unreachable(files)).toEqual([]);
  });

  it("follows a CLAUDE.md import line", () => {
    expect(unreachable(tree({ "CLAUDE.md": "@ee/CLAUDE.md", "ee/CLAUDE.md": "" }))).toEqual([]);
  });

  it("leads a folder link to the folder's README when it has one, and only there", () => {
    const files = tree({ "CLAUDE.md": "[d](docs/)", "docs/README.md": "", "docs/a.md": "" });
    expect(unreachable(files)).toEqual(["docs/a.md"]);
  });

  it("leads a folder link without a README to the files directly inside it, not deeper", () => {
    const files = tree({ "CLAUDE.md": "[d](docs/)", "docs/a.md": "", "docs/sub/b.md": "" });
    expect(unreachable(files)).toEqual(["docs/sub/b.md"]);
  });

  it("treats a skill and a tool's dot-directory as entry points of their own", () => {
    const files = tree({
      "CLAUDE.md": "",
      "skills/x/SKILL.md": "[r](reference.md)",
      "skills/x/reference.md": "",
      ".tool/notes.md": "",
    });
    expect(unreachable(files)).toEqual([]);
  });

  it("leaves every tracked Markdown file reachable", () => {
    const files = new Map(
      trackedMarkdown().map((file) => [file, readFileSync(posix.join(root, file), "utf8")]),
    );
    expect(unreachable(files)).toEqual([]);
  });
});
