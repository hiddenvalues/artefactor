import { describe, expect, it } from "vitest";
import { extractDeclaredSchema } from "./declared-schema";

// S30 — an artefact may declare its own data shape in an inert
// `<script type="application/artefactor-schema+json">` block. Extraction is a
// string-level lift from the trusted HTML and is best-effort by design: the
// block is a payload *convention*, so anything unreadable is `null` and the
// caller falls back to reading the HTML. Never an error, never enforced.
describe("extractDeclaredSchema (S30)", () => {
  const block = (body: string) =>
    `<html><head><script type="application/artefactor-schema+json">${body}</script></head><body>hi</body></html>`;

  it("returns the declared schema as parsed JSON", () => {
    const html = block(
      '{"key":"habit-tracker-v2","version":2,"example":{"habits":[]}}',
    );
    expect(extractDeclaredSchema(html)).toEqual({
      key: "habit-tracker-v2",
      version: 2,
      example: { habits: [] },
    });
  });

  it("tolerates attribute order, extra attributes, and whitespace", () => {
    const html =
      '<script id="schema"  type = "application/artefactor-schema+json" >\n  {"key":"k"}\n</script>';
    expect(extractDeclaredSchema(html)).toEqual({ key: "k" });
  });

  it("accepts single-quoted and unquoted type attributes", () => {
    expect(
      extractDeclaredSchema(
        "<script type='application/artefactor-schema+json'>{\"key\":\"k\"}</script>",
      ),
    ).toEqual({ key: "k" });
    expect(
      extractDeclaredSchema(
        '<script type=application/artefactor-schema+json>{"key":"k"}</script>',
      ),
    ).toEqual({ key: "k" });
  });

  it("returns null when there is no declaration", () => {
    expect(extractDeclaredSchema("<html><body>nothing here</body></html>")).toBeNull();
  });

  it("returns null when the block is not valid JSON", () => {
    expect(extractDeclaredSchema(block("{ key: 'habit', }"))).toBeNull();
  });

  it("returns null when the block is empty", () => {
    expect(extractDeclaredSchema(block("   "))).toBeNull();
  });

  it("returns null when the declaration is not a JSON object", () => {
    expect(extractDeclaredSchema(block("[1,2,3]"))).toBeNull();
    expect(extractDeclaredSchema(block('"just a string"'))).toBeNull();
    expect(extractDeclaredSchema(block("null"))).toBeNull();
  });

  it("ignores other script types, including a near-miss type", () => {
    expect(
      extractDeclaredSchema('<script type="application/json">{"key":"k"}</script>'),
    ).toBeNull();
    expect(
      extractDeclaredSchema(
        '<script type="application/artefactor-schema+json-ish">{"key":"k"}</script>',
      ),
    ).toBeNull();
  });

  it("takes the first declaration when an artefact carries more than one", () => {
    const html = block('{"key":"first"}') + block('{"key":"second"}');
    expect(extractDeclaredSchema(html)).toEqual({ key: "first" });
  });
});
