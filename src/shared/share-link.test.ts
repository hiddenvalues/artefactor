import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { findHandBuiltShareLinks, SHARE_LINK_BASE, shareLinkPath } from "./share-link";

// The one helper that builds an artefact's share link, `/a/<slug>`, and the drift test that keeps
// every other site calling it rather than building the link by hand.
describe("shareLinkPath", () => {
  // r[verify hosting.url.share-link]
  it("addresses a slug at /a/<slug>", () => {
    expect(SHARE_LINK_BASE).toBe("/a");
    expect(shareLinkPath("k3Rq9XwT2pL")).toBe("/a/k3Rq9XwT2pL");
  });

  // r[verify hosting.url.share-link]
  it("percent-encodes a character outside the slug alphabet", () => {
    expect(shareLinkPath("a/b")).toBe("/a/a%2Fb");
  });
});

const ROOT = join(import.meta.dirname, "..", "..");
const HELPER = join("src", "shared", "share-link.ts");

// Non-test, non-preview source under `src/` and (on the cloud tree) `ee/`. `src/test/` holds test
// helpers that request `/a/<slug>` from outside, like the suites themselves.
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|preview)\.tsx?$/.test(f))
    .filter((f) => !f.split(sep).some((part) => part === "node_modules" || part === "dist"))
    .map((f) => join(dir, f))
    .filter((f) => !relative(ROOT, f).startsWith(join("src", "test") + sep));
}

describe("share-link drift", () => {
  it("names the file and line of a hand-built share link", () => {
    const hits = findHandBuiltShareLinks(
      "x.ts",
      ["// `/a/${slug}` in a comment is fine", "const url = `/a/${slug}`;", "const u = '/a/' + slug;"].join("\n"),
    );
    expect(hits).toEqual(["x.ts:2", "x.ts:3"]);
  });

  it("catches the absolute, concat and JSX forms, and ignores comments on CRLF lines", () => {
    const lines = [
      "const a = `${location.origin}/a/` + slug;",
      'const b = "https://app.example/a/" + slug;',
      'const c = "/a/".concat(slug);',
      "<span>/a/{slug}</span>",
      "/* x */ const e = `/a/${slug}`;",
      "foo(); // see `/a/${slug}`",
      "{/* `/a/${slug}` */}",
      'app.get("/a/:slug/frame", h);',
      "const f = `${SHARE_LINK_BASE}/${slug}`;",
    ];
    expect(findHandBuiltShareLinks("y.tsx", lines.join("\r\n"))).toEqual([
      "y.tsx:1",
      "y.tsx:2",
      "y.tsx:3",
      "y.tsx:4",
      "y.tsx:5",
      "y.tsx:9",
    ]);
  });

  it("finds no hand-built share link outside the helper", () => {
    const hits = [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "ee"))]
      .filter((f) => relative(ROOT, f) !== HELPER)
      .flatMap((f) => findHandBuiltShareLinks(relative(ROOT, f), readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
