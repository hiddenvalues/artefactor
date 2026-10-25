import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtefactSummary } from "../../shared/contracts";
import {
  applyFilters,
  kindChips,
  showCollectionKindChips,
  showCollectionSort,
  SORT_LABELS,
  SORTS,
  sortList,
  type Filters,
} from "./browse";
import { restore } from "./prefs";

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
  // r[verify platform.search.filters-ignore-text]
  it("filters by no text: a stray query on the filters is ignored", () => {
    const list = [
      { ...art("form"), title: "Roadmap", updatedAt: "2026-01-02" },
      { ...art("form"), title: "Budget", updatedAt: "2026-01-01" },
    ] as ArtefactSummary[];
    const f = { kind: "all", access: "all", sort: "updated", query: "road" } as Filters;
    expect(applyFilters(list, f, new Map()).map((a) => a.title)).toEqual(["Roadmap", "Budget"]);
  });
});

// S82 — one sort menu for Home and collection pages.
const NOW = Date.parse("2026-09-28T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const item = (id: string, updatedHoursAgo: number, kind = "prototype") =>
  ({ id, title: id, kind, effectiveVisibility: "private", updatedAt: ago(updatedHoursAgo) }) as ArtefactSummary;
const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("one sort (S82)", () => {
  afterEach(() => vi.unstubAllGlobals());

  // r[verify hosting.browse.one-sort]
  it("offers Last updated, Last viewed and Title A–Z, in that order", () => {
    expect([...SORTS]).toEqual(["updated", "viewed", "title"]);
    expect(SORTS.map((s) => SORT_LABELS[s])).toEqual(["Last updated", "Last viewed", "Title A–Z"]);
  });

  // r[verify hosting.browse.one-sort]
  it("orders by updatedAt for Last updated, whatever the views", () => {
    const list = [item("b", 5), item("a", 1), item("c", 9)];
    expect(ids(sortList(list, "updated", new Map([["c", ago(0)]])))).toEqual(["a", "b", "c"]);
  });

  // r[verify hosting.browse.one-sort]
  it("puts viewed artefacts newest view first, then never-viewed ones by updatedAt", () => {
    const list = [item("never-old", 50), item("seen-old", 1), item("never-new", 2), item("seen-new", 40)];
    const views = new Map([
      ["seen-old", ago(10)],
      ["seen-new", ago(3)],
    ]);
    expect(ids(sortList(list, "viewed", views))).toEqual(["seen-new", "seen-old", "never-new", "never-old"]);
  });

  // r[verify hosting.browse.one-sort]
  it("orders A–Z by title for Title A–Z", () => {
    const list = [item("Roadmap", 1), item("budget", 2), item("Atlas", 3)];
    expect(ids(sortList(list, "title", new Map()))).toEqual(["Atlas", "budget", "Roadmap"]);
  });

  // r[verify hosting.browse.one-sort]
  it("filters by kind, then sorts by the caller's views", () => {
    const list = [item("form-seen", 9, "form"), item("deck", 1, "deck"), item("form-never", 1, "form"), item("form-new", 20, "form")];
    const views = new Map([
      ["form-seen", ago(4)],
      ["form-new", ago(1)],
      ["deck", ago(0)],
    ]);
    const f: Filters = { kind: "form", access: "all", sort: "viewed" };
    expect(ids(applyFilters(list, f, views, false))).toEqual(["form-new", "form-seen", "form-never"]);
  });

  // r[verify hosting.browse.one-sort-pref]
  it("keeps a remembered viewed or title, and turns anything else into Last updated", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null });
    for (const [value, expected] of [
      ["viewed", "viewed"],
      ["title", "title"],
      ["size", "updated"],
      ["bogus", "updated"],
    ]) {
      stored.set("artefactor:sort", value!);
      expect(restore("sort", SORTS, "updated")).toBe(expected);
    }
  });
});
