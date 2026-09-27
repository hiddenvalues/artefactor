import { describe, expect, it } from "vitest";
import type {
  ArtefactSummary,
  CollectionSummary,
  SharedArtefactSummary,
  SharedCollectionSummary,
} from "../../shared/contracts";
import { highlight, searchLibrary, type SearchInput } from "./search";

// S46 — Top bar: global search, tabs move out.
const at = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 1) - minutesAgo * 60_000).toISOString();
const me = "user-me";

function art(id: string, title: string, over: Partial<ArtefactSummary> = {}): ArtefactSummary {
  return {
    id,
    ownerId: me,
    title,
    kind: "prototype",
    visibility: "private",
    effectiveVisibility: "private",
    collectionId: null,
    status: "active",
    publicSlug: null,
    payloadBytes: 1,
    usesStorage: false,
    dataVisibility: "own",
    thumbnailUrl: null,
    createdAt: at(1000),
    updatedAt: at(0),
    ...over,
  };
}
const sharedArt = (id: string, title: string, over: Partial<ArtefactSummary> = {}): SharedArtefactSummary => ({
  ...art(id, title, { ownerId: "user-grace", publicSlug: `s-${id}`, visibility: "authenticated", ...over }),
  owner: { name: "Grace Hopper", email: "grace@example.com" },
});
function coll(id: string, name: string, over: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id,
    ownerId: me,
    name,
    parentId: null,
    rootId: over.parentId ? "root" : id,
    visibility: "private",
    status: "active",
    createdAt: at(1000),
    updatedAt: at(0),
    ...over,
  };
}
const sharedColl = (id: string, name: string, over: Partial<CollectionSummary> = {}): SharedCollectionSummary => ({
  ...coll(id, name, { ownerId: "user-alan", ...over }),
  canContribute: false,
  owner: { name: "Alan Turing", email: "alan@example.com" },
});

function input(parts: Partial<Omit<SearchInput, "collectionById">>): SearchInput {
  const collections = parts.collections ?? [];
  const sharedCollections = parts.sharedCollections ?? [];
  return {
    owned: parts.owned ?? [],
    shared: parts.shared ?? [],
    collections,
    sharedCollections,
    collectionById: new Map([...collections, ...sharedCollections].map((c) => [c.id, c])),
  };
}

describe("searchLibrary (S46)", () => {
  const lib = input({
    owned: [art("a1", "Roadmap")],
    collections: [coll("c1", "Roadmaps")],
  });

  it("returns empty groups for an empty or blank query", () => {
    expect(searchLibrary(lib, "")).toEqual({ collections: [], artefacts: [] });
    expect(searchLibrary(lib, "   ")).toEqual({ collections: [], artefacts: [] });
  });

  it("matches case-insensitively by title across own and shared artefacts and collections", () => {
    const r = searchLibrary(
      input({
        owned: [art("a-own", "Q3 ROADMAP"), art("a-miss", "Budget")],
        shared: [sharedArt("a-shared", "roadmap review")],
        collections: [coll("c-own", "Roadmaps"), coll("c-miss", "Specs")],
        sharedCollections: [sharedColl("c-shared", "Team roadMap")],
      }),
      "RoadMap",
    );
    expect(r.artefacts.map((h) => h.id).sort()).toEqual(["a-own", "a-shared"]);
    expect(r.collections.map((h) => h.id).sort()).toEqual(["c-own", "c-shared"]);
    expect(r.artefacts.every((h) => h.kind === "artefact")).toBe(true);
    expect(r.collections.every((h) => h.kind === "collection")).toBe(true);
  });

  it("caps 4 matching collections and 7 matching artefacts at 3 and 5, most recently updated first", () => {
    const r = searchLibrary(
      input({
        owned: [1, 5, 3, 7].map((m) => art(`a${m}`, `Plan ${m}`, { updatedAt: at(m) })),
        shared: [2, 6, 4].map((m) => sharedArt(`a${m}`, `Plan ${m}`, { updatedAt: at(m) })),
        collections: [4, 1].map((m) => coll(`c${m}`, `Plans ${m}`, { updatedAt: at(m) })),
        sharedCollections: [3, 2].map((m) => sharedColl(`c${m}`, `Plans ${m}`, { updatedAt: at(m) })),
      }),
      "plan",
    );
    expect(r.collections.map((h) => h.id)).toEqual(["c1", "c2", "c3"]);
    expect(r.artefacts.map((h) => h.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  describe("meta — where a hit lives, or who shared it", () => {
    const specs = coll("c-specs", "Specs");
    const sub = coll("c-sub", "Drafts", { parentId: "c-specs" });
    const r = searchLibrary(
      input({
        owned: [art("a-in", "Doc in specs", { collectionId: "c-specs" }), art("a-loose", "Doc loose")],
        shared: [sharedArt("a-shared", "Doc shared")],
        collections: [specs, sub],
        sharedCollections: [sharedColl("c-shared", "Doc tree")],
      }),
      "d",
    );
    const meta = (id: string) => [...r.artefacts, ...r.collections].find((h) => h.id === id)?.meta;

    it("an own artefact in a collection → the collection's name", () => expect(meta("a-in")).toBe("Specs"));
    it("a loose own artefact → Your artefacts", () => expect(meta("a-loose")).toBe("Your artefacts"));
    it("a shared artefact → Shared by its owner", () => expect(meta("a-shared")).toBe("Shared by Grace Hopper"));
    it("an own sub-collection → its parent's name", () => expect(meta("c-sub")).toBe("Specs"));
    it("an own root → Your collections", () => {
      expect(searchLibrary(input({ collections: [specs] }), "spec").collections[0]?.meta).toBe("Your collections");
    });
    it("a shared collection → Shared by its owner", () => expect(meta("c-shared")).toBe("Shared by Alan Turing"));
  });

  it("carries what a row renders: the artefact's kind, the collection's id for its hue", () => {
    const r = searchLibrary(
      input({ owned: [art("a1", "Deck", { kind: "slide-deck" })], collections: [coll("c1", "Decks")] }),
      "deck",
    );
    expect(r.artefacts[0]).toMatchObject({ kind: "artefact", id: "a1", title: "Deck", artefactKind: "slide-deck" });
    expect(r.collections[0]).toMatchObject({ kind: "collection", id: "c1", title: "Decks" });
  });
});

describe("highlight (S46)", () => {
  it("splits the first match out of the title", () => {
    expect(highlight("Roadmap Q3", "map")).toEqual(["Road", "map", " Q3"]);
    expect(highlight("Roadmap Q3", "ROAD")).toEqual(["", "Road", "map Q3"]);
  });

  it("returns the whole title when nothing matches", () => {
    expect(highlight("Roadmap Q3", "zzz")).toEqual(["Roadmap Q3", "", ""]);
  });
});
