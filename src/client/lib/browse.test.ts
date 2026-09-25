import { describe, expect, it } from "vitest";
import type { ArtefactSummary } from "../../shared/contracts";
import { kindChips, showCollectionKindChips, showCollectionSort } from "./browse";

// S43 — which controls a collection page offers.
const art = (kind: string) => ({ kind, effectiveVisibility: "private" }) as ArtefactSummary;

describe("collection page controls (S43)", () => {
  it("shows kind chips for more than one kind, or while a kind filter is active", () => {
    expect(showCollectionKindChips(kindChips([art("form"), art("prototype")]), "all")).toBe(true);
    expect(showCollectionKindChips(kindChips([art("form")]), "all")).toBe(false);
    // A filter that no longer matches the one kind left must stay clearable.
    expect(showCollectionKindChips(kindChips([art("form")]), "prototype")).toBe(true);
  });

  it("offers sorting when the page lists anyone's artefacts", () => {
    expect(showCollectionSort([], [])).toBe(false);
    expect(showCollectionSort([art("form")], [])).toBe(true);
    expect(showCollectionSort([], [art("form")])).toBe(true);
  });
});
