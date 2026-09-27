import { describe, expect, it } from "vitest";
import type { ArtefactSummary } from "../../shared/contracts";
import { applyFilters, kindChips, showCollectionKindChips, showCollectionSort, type Filters } from "./browse";

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

// S46 — the top bar's search is global; it no longer filters a page's grid.
describe("applyFilters (S46)", () => {
  it("filters by no text: a stray query on the filters is ignored", () => {
    const list = [
      { ...art("form"), title: "Roadmap", updatedAt: "2026-01-02" },
      { ...art("form"), title: "Budget", updatedAt: "2026-01-01" },
    ] as ArtefactSummary[];
    const f = { kind: "all", access: "all", sort: "updated", query: "road" } as Filters;
    expect(applyFilters(list, f).map((a) => a.title)).toEqual(["Roadmap", "Budget"]);
  });
});
