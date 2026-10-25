import { describe, expect, it } from "vitest";
import { hashBody, normalizeBody, parseMarkers } from "./markers";

const parse = (text: string) => parseMarkers({ path: "docs/specs/ddd/x.md", text });

describe("parseMarkers", () => {
  // r[verify platform.trace.marker-syntax]
  it("starts a requirement at a line that is exactly a marker, its body the lines up to a blank", () => {
    const { requirements, errors } = parse(
      [
        "# X",
        "",
        "r[hosting.access.no-existence-leak]",
        "A request for an artefact the caller may not read",
        "gets the same 404 as a missing one.",
        "",
        "Unrelated prose.",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(requirements).toEqual([
      {
        id: "hosting.access.no-existence-leak",
        version: 1,
        body: "A request for an artefact the caller may not read\ngets the same 404 as a missing one.",
        hash: hashBody(
          "A request for an artefact the caller may not read\ngets the same 404 as a missing one.",
        ),
        file: "docs/specs/ddd/x.md",
        line: 3,
      },
    ]);
  });

  // r[verify platform.trace.marker-syntax]
  it("reads a +N suffix as the version", () => {
    expect(parse("r[x.y+3]\nBody.\n").requirements).toMatchObject([{ id: "x.y", version: 3 }]);
  });

  // r[verify platform.trace.marker-syntax]
  it("ignores a marker that is not alone on its line", () => {
    expect(parse("see r[x.y] for the rule\n\n  r[x.z]\nBody.\n`r[x.w]`\n").requirements).toEqual(
      [],
    );
  });

  // r[verify platform.trace.marker-syntax]
  it("keeps a directly attached list in the body, but not a paragraph after a blank line", () => {
    const [req] = parse("r[x.y]\nThe rule:\n- one\n- two\n\nNot the body.\n").requirements;
    expect(req!.body).toBe("The rule:\n- one\n- two");
  });

  // r[verify platform.trace.marker-syntax]
  it("ends a body at the next marker or a heading", () => {
    const { requirements } = parse("r[x.a]\nFirst.\nr[x.b]\nSecond.\n## Heading\nProse.\n");
    expect(requirements.map((r) => [r.id, r.body])).toEqual([
      ["x.a", "First."],
      ["x.b", "Second."],
    ]);
  });

  // r[verify platform.trace.marker-syntax]
  it("keeps a fenced block that follows the body directly, up to the blank line", () => {
    const [req] = parse("r[x.y]\nThe shape:\n```json\n{ \"a\": 1 }\n```\n\nNot the body.\n").requirements;
    expect(req!.body).toBe('The shape:\n```json\n{ "a": 1 }\n```');
  });

  // r[verify platform.trace.marker-syntax]
  it("ignores a marker inside a fenced code block", () => {
    expect(parse("```markdown\nr[x.y]\nExample.\n```\n").requirements).toEqual([]);
  });

  // r[verify platform.trace.marker-syntax]
  it("closes a fence only on a bare closing run, never on one with an info string", () => {
    const nested = "````markdown\n```ts\ncode\n```\nr[x.y]\nExample.\n````\nr[x.z]\nLive.\n";
    expect(parse(nested).requirements.map((r) => r.id)).toEqual(["x.z"]);
    expect(parse("```\nr[x.y]\nExample.\n```ts\nr[x.w]\nStill fenced.\n").requirements).toEqual([]);
  });

  // r[verify platform.trace.marker-syntax]
  it("rejects +1 and +0 (version 1 has no suffix) and a marker with an empty body", () => {
    const { requirements, errors } = parse("r[x.y+1]\nBody.\n\nr[x.z+0]\nBody.\n\nr[x.w]\n\n");
    expect(requirements).toEqual([]);
    expect(errors).toEqual([
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:1: .*r\[x\.y\+1\].*write r\[x\.y\]/),
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:4: .*r\[x\.z\+0\]/),
      expect.stringMatching(/docs\/specs\/ddd\/x\.md:7: .*x\.w.*no body/),
    ]);
  });
});

describe("normalizeBody", () => {
  // r[verify platform.trace.lock]
  it("collapses whitespace runs and trims, so a reflowed paragraph hashes the same", () => {
    expect(normalizeBody("  A rule\nthat   wraps\n\there. ")).toBe("A rule that wraps here.");
    expect(hashBody("A rule that\nwraps here.")).toBe(hashBody("A rule\nthat wraps here."));
    expect(hashBody("A rule that wraps here.")).not.toBe(hashBody("A rule that wraps there."));
    expect(hashBody("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
