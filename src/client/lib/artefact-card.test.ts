import { describe, expect, it } from "vitest";
import type { ArtefactSummary } from "../../shared/contracts";
import {
  accessRootOf,
  cardMeta,
  collectionRowOf,
  menuItemsOf,
  rowMetaOf,
  shareLinkOf,
  thumbnailToShow,
} from "./artefact-card";

// S54 — Artefact card: the pure model behind its share-link footer, activity
// text, collection row and menu.
type Tier = ArtefactSummary["effectiveVisibility"];
const art = (over: Partial<ArtefactSummary> = {}): ArtefactSummary =>
  ({
    id: "a1",
    title: "Card",
    visibility: "private",
    effectiveVisibility: "private",
    publicSlug: null,
    collectionId: null,
    ...over,
  }) as ArtefactSummary;

describe("shareLinkOf (S54)", () => {
  // r[verify hosting.card.share-link-unless-private+6]
  it("gives /a/<slug> for every effective tier but private — the same answer for owner and viewer", () => {
    for (const tier of ["authenticated", "selected", "public"] as Tier[])
      expect(shareLinkOf(art({ visibility: tier, effectiveVisibility: tier, publicSlug: "abc" })), tier).toBe("/a/abc");
  });

  // r[verify hosting.card.share-link-unless-private+6]
  it("gives null for an effectively private artefact, even with a retained slug", () => {
    expect(shareLinkOf(art({ publicSlug: "abc" }))).toBeNull();
    expect(shareLinkOf(art({ visibility: "public", effectiveVisibility: "public", publicSlug: null }))).toBeNull();
  });

  // r[verify hosting.card.share-link-unless-private+6]
  // r[verify hosting.access.effective-from-tree-root]
  it("follows the effective tier, not the artefact's own", () => {
    const contained = art({ visibility: "public", effectiveVisibility: "private", publicSlug: "abc", collectionId: "c1" });
    expect(shareLinkOf(contained)).toBeNull();
  });
});

describe("cardMeta (S54)", () => {
  // r[verify hosting.card.public-hides-activity+2]
  it("hides the activity text and Shared by when the effective tier is public", () => {
    const pub = art({ effectiveVisibility: "public" });
    expect(cardMeta(pub, "viewer")).toEqual({ showActivity: false, showSharedBy: false });
    expect(cardMeta(pub, "owner").showActivity).toBe(false);
  });

  // r[verify hosting.card.public-hides-activity+2]
  it("shows the activity text otherwise, and Shared by only to a viewer", () => {
    const members = art({ effectiveVisibility: "authenticated" });
    expect(cardMeta(members, "viewer")).toEqual({ showActivity: true, showSharedBy: true });
    expect(cardMeta(members, "owner")).toEqual({ showActivity: true, showSharedBy: false });
  });

  // r[verify hosting.card.public-hides-activity+2]
  it("reads the effective tier: a public artefact inside a members collection keeps its activity", () => {
    const contained = art({ visibility: "public", effectiveVisibility: "authenticated", collectionId: "c1" });
    expect(cardMeta(contained, "viewer")).toEqual({ showActivity: true, showSharedBy: true });
  });
});

describe("accessRootOf (S64)", () => {
  const lookup = new Map([
    ["root", { id: "root", name: "Research", parentId: null, rootId: "root" }],
    ["kid", { id: "kid", name: "Interviews", parentId: "root", rootId: "root" }],
  ]);

  it("gives the tree root for an artefact in a nested collection, and the collection itself when it is a root", () => {
    expect(accessRootOf(art({ collectionId: "kid" }), lookup)).toEqual({ id: "root", name: "Research" });
    expect(accessRootOf(art({ collectionId: "root" }), lookup)).toEqual({ id: "root", name: "Research" });
  });

  it("gives null outside a collection, or for a collection not in the lookup", () => {
    expect(accessRootOf(art(), lookup)).toBeNull();
    expect(accessRootOf(art({ collectionId: "gone" }), lookup)).toBeNull();
  });
});

describe("collectionRowOf (S54)", () => {
  const lookup = new Map([["c1", { id: "c1", name: "Design system", ownerId: "u1" }]]);

  // r[verify hosting.listing.collection-named-only-if-visible]
  // r[verify hosting.card.collection-only-if-visible+3]
  it("names a collection that is among the nodes the user can see", () => {
    expect(collectionRowOf(art({ collectionId: "c1" }), lookup)).toEqual({ id: "c1", name: "Design system" });
  });

  // r[verify hosting.listing.collection-named-only-if-visible]
  // r[verify hosting.card.collection-only-if-visible+3]
  it("shows no collection when the user can't see it, or the artefact is in none", () => {
    expect(collectionRowOf(art({ collectionId: "hidden" }), lookup)).toBeNull();
    expect(collectionRowOf(art({ collectionId: null }), lookup)).toBeNull();
  });
});

describe("menuItemsOf (S54)", () => {
  // r[verify hosting.card.viewer-menu-downloads+2]
  it("gives a viewer exactly Open, Bookmark and Download HTML", () => {
    expect(menuItemsOf("viewer", { inCollection: false, hasDownload: true })).toEqual(["open", "bookmark", "download"]);
    expect(menuItemsOf("viewer", { inCollection: true, hasDownload: true })).toEqual(["open", "bookmark", "download"]);
  });

  // r[verify hosting.card.viewer-menu-downloads+2]
  it("gives an owner the full list, ending with a separator and Archive", () => {
    expect(menuItemsOf("owner", { inCollection: false, hasDownload: true })).toEqual([
      "open",
      "bookmark",
      "add-to-collection",
      "edit",
      "download",
      "separator",
      "archive",
    ]);
    const moved = menuItemsOf("owner", { inCollection: true, hasDownload: true });
    expect(moved).toContain("move-to-collection");
    expect(moved).not.toContain("add-to-collection");
    expect(moved.slice(-2)).toEqual(["separator", "archive"]);
  });

  // S62 — the collection owner's Remove from collection, on their own page.
  it("appends a separator and Remove from collection to a viewer's menu when the caller may eject", () => {
    expect(menuItemsOf("viewer", { inCollection: true, hasDownload: true, canRemoveFromCollection: true })).toEqual([
      "open",
      "bookmark",
      "download",
      "separator",
      "remove-from-collection",
    ]);
  });

  it("leaves the owner's menu as it is when the remove option is set", () => {
    expect(menuItemsOf("owner", { inCollection: true, hasDownload: true, canRemoveFromCollection: true })).toEqual(
      menuItemsOf("owner", { inCollection: true, hasDownload: true }),
    );
  });

  // r[verify hosting.card.viewer-menu-downloads+2]
  it("offers Copy share link to no one, and Download only when there is one", () => {
    for (const role of ["owner", "viewer"] as const)
      for (const inCollection of [false, true]) {
        const items = menuItemsOf(role, { inCollection, hasDownload: true }) as string[];
        expect(items).not.toContain("copy-link");
        expect(menuItemsOf(role, { inCollection, hasDownload: false })).not.toContain("download");
      }
  });
});

describe("rowMetaOf (S65)", () => {
  const lookup = new Map([["c1", { id: "c1", name: "Research", ownerId: "u1" }]]);
  const parts = (...args: Parameters<typeof rowMetaOf>) => rowMetaOf(...args).map((p) => p.part);

  // r[verify hosting.row.meta-line]
  // r[verify hosting.card.collection-only-if-visible+3]
  it("gives a viewer's members artefact in a visible collection, saving data, Shared by · collection · saved data · Updated", () => {
    const a = art({ visibility: "authenticated", effectiveVisibility: "authenticated", publicSlug: "abc", collectionId: "c1", usesStorage: true });
    const meta = rowMetaOf(a, "viewer", lookup);
    expect(meta.map((p) => p.part)).toEqual(["shared-by", "collection", "saved-data", "activity"]);
    expect(meta).toContainEqual({ part: "collection", collection: { id: "c1", name: "Research" } });
  });

  // r[verify hosting.row.meta-line]
  // r[verify hosting.card.public-hides-activity+2]
  it("gives an owner's public top-level artefact without storage no part at all", () => {
    const a = art({ visibility: "public", effectiveVisibility: "public", publicSlug: "pub" });
    expect(parts(a, "owner", lookup)).toEqual([]);
  });

  // r[verify hosting.row.meta-line]
  // r[verify hosting.card.public-hides-activity+2]
  // r[verify hosting.card.collection-only-if-visible+3]
  it("gives a viewer's public artefact in a visible collection only the collection: no Shared by, no Updated, no link", () => {
    const a = art({ visibility: "public", effectiveVisibility: "public", publicSlug: "pub", collectionId: "c1" });
    expect(parts(a, "viewer", lookup)).toEqual(["collection"]);
  });

  // r[verify hosting.row.meta-line]
  it("never names a kind, size or share link, over every tier, role and slug", () => {
    const tiers: Tier[] = ["private", "authenticated", "selected", "public"];
    for (const effectiveVisibility of tiers)
      for (const role of ["owner", "viewer"] as const)
        for (const publicSlug of [null, "s1"]) {
          const meta = rowMetaOf(art({ effectiveVisibility, publicSlug, collectionId: "c1", usesStorage: true }), role, lookup);
          const names: string[] = meta.map((p) => p.part);
          for (const gone of ["kind", "size", "share-link"]) expect(names, `${effectiveVisibility} ${role} ${publicSlug}`).not.toContain(gone);
          expect(JSON.stringify(meta)).not.toContain("/a/");
        }
  });

  // r[verify hosting.card.collection-only-if-visible+3]
  it("gives no collection part for a collection missing from the lookup", () => {
    const a = art({ effectiveVisibility: "authenticated", collectionId: "hidden" });
    expect(parts(a, "viewer", lookup)).not.toContain("collection");
  });
});

describe("thumbnailToShow (S35)", () => {
  const url = "/api/artefacts/a1/thumbnail?v=h1";

  // r[verify hosting.thumbnail.placeholder-when-missing]
  it("shows the placeholder while no thumbnail is recorded", () => {
    expect(thumbnailToShow(null, null)).toBeNull();
  });

  // r[verify hosting.thumbnail.placeholder-when-missing]
  it("shows the placeholder once the thumbnail failed to load", () => {
    expect(thumbnailToShow(url, url)).toBeNull();
  });

  // r[verify hosting.thumbnail.placeholder-when-missing]
  it("shows the image while it has not failed, and tries a newer render again", () => {
    expect(thumbnailToShow(url, null)).toBe(url);
    const newer = "/api/artefacts/a1/thumbnail?v=h2";
    expect(thumbnailToShow(newer, url)).toBe(newer);
  });
});
