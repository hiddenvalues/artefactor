import { describe, expect, it } from "vitest";
import { descriptionCount, editorSubmission } from "./collection-editor";

// S74 — the collection editor dialog's form, as a pure model: the live
// "n / 280" counter and what Save submits or refuses. Tested without a DOM.

describe("descriptionCount (S74)", () => {
  it("counts the trimmed text against 280 and flags only what is over", () => {
    expect(descriptionCount("  Guides  ")).toEqual({ label: "6 / 280", over: false });
    expect(descriptionCount("a".repeat(280))).toEqual({ label: "280 / 280", over: false });
    expect(descriptionCount("a".repeat(281))).toEqual({ label: "281 / 280", over: true });
  });

  it("counts the collapsed text, as the server measures it", () => {
    expect(descriptionCount("Guides\n\n  FAQ")).toEqual({ label: "10 / 280", over: false });
    const raw = "a".repeat(140) + "\n\n\n" + "b".repeat(139);
    expect(descriptionCount(raw)).toEqual({ label: "280 / 280", over: false });
  });
});

describe("editorSubmission (S74)", () => {
  const base = { name: "Help", description: "", isRoot: true, visibility: "private" as const };

  // r[verify collections.collection.description+2]
  it("blocks Save over the limit with an inline description error", () => {
    const result = editorSubmission({ ...base, description: "a".repeat(281) });
    expect(result).toEqual({
      errors: { description: "Keep the description to 280 characters." },
    });
  });

  it("submits a trimmed description, and null for a blank one", () => {
    const twenty = "Guides for new users";
    expect(editorSubmission({ ...base, description: ` ${twenty} ` })).toEqual({
      input: { name: "Help", description: twenty, visibility: "private" },
    });
    expect(editorSubmission({ ...base, description: "   " })).toEqual({
      input: { name: "Help", description: null, visibility: "private" },
    });
  });

  // r[verify collections.collection.description+2]
  it("submits the description on one line, whitespace runs collapsed", () => {
    expect(editorSubmission({ ...base, description: "Guides\n\nFAQ  and\tnotes" })).toEqual({
      input: { name: "Help", description: "Guides FAQ and notes", visibility: "private" },
    });
  });

  it("keeps the name's error, and sends no tier from a nested collection", () => {
    expect(editorSubmission({ ...base, name: " ", description: "a".repeat(281) })).toEqual({
      errors: {
        name: "Give your collection a name.",
        description: "Keep the description to 280 characters.",
      },
    });
    expect(editorSubmission({ ...base, isRoot: false })).toEqual({
      input: { name: "Help", description: null, visibility: undefined },
    });
  });
});
