import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CollectionSummary } from "../../shared/contracts";
import { collection, collectionById, collections, noop, ownedLibrary, ownedProps, sharedLibrary, sharedProps } from "../design/fixtures";
import { CollectionPage } from "./CollectionPage";

// S74 — the collection page header shows the description under the title,
// before the counts line, and nothing when there is none.
const page = (c: CollectionSummary) =>
  renderToStaticMarkup(
    createElement(CollectionPage, {
      filters: { kind: "all", access: "all", sort: "updated" },
      onKind: noop,
      onAccess: noop,
      onSort: noop,
      density: "grid",
      onDensity: noop,
      ownedProps: (a) => ownedProps(a),
      sharedProps: (g, onRemoveFromCollection) => sharedProps(g, { onRemoveFromCollection }),
      collection: c,
      isOwn: true,
      shared: null,
      owned: ownedLibrary,
      others: sharedLibrary,
      collectionById: new Map([...collectionById, [c.id, c]]),
      pool: collections,
      bookmarked: false,
      onToggleBookmark: noop,
      onOpenCollection: noop,
      onGoDashboard: noop,
      onGoGallery: noop,
      onChangeVisibility: noop,
      onLinkGate: noop,
      onManage: noop,
      onEdit: noop,
      onNewSub: noop,
      onArchive: noop,
      onEject: noop,
    }),
  );

// The paragraphs that follow the title, in order.
const underTitle = (html: string) => {
  const after = html.slice(html.indexOf("</h1>"));
  return [...after.matchAll(/<p class="([^"]*)">([^<]*)<\/p>/g)].slice(0, 2).map(([, cls, text]) => ({ cls, text }));
};

describe("CollectionPage header (S74)", () => {
  it("shows the description as muted text under the title, before the counts line", () => {
    const [first, second] = underTitle(page(collection({ description: "Tokens, type and components" })));
    expect(first).toEqual({
      cls: "mt-1 max-w-prose text-sm break-words text-muted-foreground",
      text: "Tokens, type and components",
    });
    expect(second!.text).toMatch(/artefact|collection|Empty/);
  });

  it("renders no extra element without one", () => {
    const html = page(collection());
    expect(html).not.toContain("max-w-prose");
    expect(underTitle(html)[0]!.cls).toBe("mt-0.5 text-sm text-muted-foreground");
  });
});
