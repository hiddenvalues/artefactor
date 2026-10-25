import { describe, expect, it } from "vitest";
import type { ArtefactSummary, SharedArtefactSummary } from "../../shared/contracts";
import { HOME_SORTS, mergeViews, paginate, recentList, scopeCounts, scopeList, sortHome } from "./home";

// S47 — Home: the pure model behind the Recent row, the switch, the sorts and
// the pager.
const NOW = Date.parse("2026-09-28T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const own = (id: string, updatedHoursAgo = 24): ArtefactSummary =>
  ({ id, title: id, kind: "prototype", effectiveVisibility: "private", updatedAt: ago(updatedHoursAgo) }) as ArtefactSummary;
const theirs = (id: string, updatedHoursAgo = 24): SharedArtefactSummary =>
  ({
    ...own(id, updatedHoursAgo),
    effectiveVisibility: "authenticated",
    owner: { name: "Maya", email: "maya@example.com" },
  }) as SharedArtefactSummary;
const ids = (list: { id: string }[]) => list.map((a) => a.id);

// r[verify hosting.home.model]
describe("scopeList / scopeCounts (S47)", () => {
  const owned = [own("o1"), own("o2"), own("o3")];
  const shared = [theirs("s1"), theirs("s2")];

  it("lists owned + shared for all, owned for mine and shared for shared", () => {
    expect(ids(scopeList(owned, shared, "all")).sort()).toEqual(["o1", "o2", "o3", "s1", "s2"]);
    expect(ids(scopeList(owned, shared, "mine"))).toEqual(["o1", "o2", "o3"]);
    expect(ids(scopeList(owned, shared, "shared"))).toEqual(["s1", "s2"]);
  });

  it("counts the whole library, whatever the filters", () => {
    expect(scopeCounts(owned, shared)).toEqual({ all: 5, mine: 3, shared: 2 });
  });
});

// r[verify hosting.home.model]
describe("recentList (S47)", () => {
  it("ranks by the latest of my view and, for my own, its last edit", () => {
    const owned = [own("edited-1h", 1)];
    const shared = [theirs("viewed-2h", 0.5), theirs("viewed-now", 30)];
    const views = new Map([
      ["viewed-2h", ago(2)],
      ["viewed-now", ago(0)],
    ]);
    // A shared artefact's own edit doesn't count — only my opening it does.
    expect(ids(recentList(owned, shared, views))).toEqual(["viewed-now", "edited-1h", "viewed-2h"]);
  });

  it("leaves out a shared artefact I never opened", () => {
    expect(ids(recentList([own("mine")], [theirs("unseen", 0)], new Map()))).toEqual(["mine"]);
  });

  it("caps at 12", () => {
    const owned = Array.from({ length: 20 }, (_, i) => own(`o${i}`, i));
    const list = recentList(owned, [], new Map());
    expect(list).toHaveLength(12);
    expect(list[0]!.id).toBe("o0");
  });

  it("is empty for an empty library", () => {
    expect(recentList([], [], new Map())).toEqual([]);
  });
});

// r[verify hosting.home.model]
describe("the Home sorts (S47)", () => {
  it("offers Last edited or uploaded and Last viewed", () => {
    expect([...HOME_SORTS]).toEqual(["updated", "viewed"]);
  });

  it("puts viewed artefacts newest first, then never-viewed ones by updatedAt", () => {
    const list = [own("never-old", 50), own("seen-old", 1), own("never-new", 2), own("seen-new", 40)];
    const views = new Map([
      ["seen-old", ago(10)],
      ["seen-new", ago(3)],
    ]);
    expect(ids(sortHome(list, "viewed", views))).toEqual(["seen-new", "seen-old", "never-new", "never-old"]);
  });

  it("orders by updatedAt for Last edited or uploaded", () => {
    const list = [own("b", 5), own("a", 1), own("c", 9)];
    expect(ids(sortHome(list, "updated", new Map([["c", ago(0)]])))).toEqual(["a", "b", "c"]);
  });
});

describe("mergeViews (S47)", () => {
  it("keeps a local stamp newer than the server's snapshot, and takes the server's newer ones", () => {
    const local = new Map([
      ["just-opened", ago(0)],
      ["stale-local", ago(5)],
    ]);
    const merged = mergeViews(local, [
      { artefactId: "stale-local", viewedAt: ago(1) },
      { artefactId: "server-only", viewedAt: ago(2) },
    ]);
    expect(Object.fromEntries(merged)).toEqual({
      "just-opened": ago(0),
      "stale-local": ago(1),
      "server-only": ago(2),
    });
  });
});

// r[verify hosting.home.model]
describe("paginate (S47)", () => {
  const thirty = Array.from({ length: 30 }, (_, i) => i);

  it("gives page 2 of 30 its 6 items", () => {
    expect(paginate(thirty, 2, 24)).toEqual({ items: thirty.slice(24), page: 2, pageCount: 2 });
  });

  it("clamps a page past the end", () => {
    expect(paginate(thirty, 5, 24).page).toBe(2);
    expect(paginate(thirty, 0, 24).page).toBe(1);
  });

  it("has one page for 10 items, and for none", () => {
    expect(paginate(thirty.slice(0, 10), 1, 24).pageCount).toBe(1);
    expect(paginate([], 3, 24)).toEqual({ items: [], page: 1, pageCount: 1 });
  });
});
