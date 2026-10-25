import type { ArtefactSummary } from "../../shared/contracts";
import { shareLinkPath } from "../../shared/share-link";

// S54 — Artefact card: the pure model behind its share link, activity text,
// collection row and ⋯ menu (S62 — the viewer's Share and Remove from collection). Every access decision reads the effective
// tier (hosting.access.effective-from-tree-root), never the artefact's own.

/** Whose card it is: your own artefact, or another user's shared with you. */
export type CardRole = "owner" | "viewer";

type Tiered = Pick<ArtefactSummary, "effectiveVisibility">;

/** The share link `/a/<slug>` — a viewer's Share on a card or row (S65) and
 *  the Link atop an owner's "Access inherited" popover (S64) — or null
 *  while the artefact is effectively private (its retained slug 404s then) or
 *  has none. */
// r[impl hosting.card.share-link-unless-private+6]
export function shareLinkOf(a: Tiered & Pick<ArtefactSummary, "publicSlug">): string | null {
  return a.effectiveVisibility !== "private" && a.publicSlug ? shareLinkPath(a.publicSlug) : null;
}

/** What the card says about activity and attribution: a public artefact shows
 *  neither, and only a viewer's card names who shared it. */
// r[impl hosting.card.public-hides-activity+2]
export function cardMeta(a: Tiered, role: CardRole): { showActivity: boolean; showSharedBy: boolean } {
  if (a.effectiveVisibility === "public") return { showActivity: false, showSharedBy: false };
  return { showActivity: true, showSharedBy: role === "viewer" };
}

/** The collection row: the artefact's one collection, but only when it is among
 *  the nodes the signed-in user holds (own, archived and shared trees), so a
 *  card never names a collection its viewer can't open (collections.read.follows-root, S28). */
// r[impl hosting.listing.collection-named-only-if-visible]
export function collectionRowOf(
  a: Pick<ArtefactSummary, "collectionId">,
  lookup: ReadonlyMap<string, { id: string; name: string }>,
): { id: string; name: string } | null {
  const c = a.collectionId ? lookup.get(a.collectionId) : undefined;
  return c ? { id: c.id, name: c.name } : null;
}

/** The tree root an owned artefact's access follows: its collection's root, or
 *  the collection itself when that is a root (hosting.access.effective-from-tree-root).
 *  The "Access inherited" popover names and opens it (S64), since only the root's
 *  access can be changed. Null outside a collection or a collection not loaded. */
export function accessRootOf(
  a: Pick<ArtefactSummary, "collectionId">,
  lookup: ReadonlyMap<string, { id: string; name: string; parentId: string | null; rootId: string }>,
): { id: string; name: string } | null {
  const c = a.collectionId ? lookup.get(a.collectionId) : undefined;
  const root = c && (c.parentId === null ? c : lookup.get(c.rootId));
  return root ? { id: root.id, name: root.name } : null;
}

export type MenuItem =
  | "open"
  | "bookmark"
  | "add-to-collection"
  | "move-to-collection"
  | "edit"
  | "download"
  | "separator"
  | "archive"
  | "remove-from-collection";

/** The ⋯ menu, in order. A viewer gets Open, Bookmark and Download HTML (the
 *  download route already admits every viewer, S30); the share link sits
 *  behind the card's and row's Share (S65), so no menu copies it. S62 — on their own collection page, the
 *  collection's owner also gets Remove from collection (the S29 eject). */
// r[impl hosting.card.viewer-menu-downloads+2]
export function menuItemsOf(
  role: CardRole,
  o: { inCollection: boolean; hasDownload: boolean; canRemoveFromCollection?: boolean },
): MenuItem[] {
  const download: MenuItem[] = o.hasDownload ? ["download"] : [];
  if (role === "viewer")
    return ["open", "bookmark", ...download, ...(o.canRemoveFromCollection ? (["separator", "remove-from-collection"] as const) : [])];
  return [
    "open",
    "bookmark",
    o.inCollection ? "move-to-collection" : "add-to-collection",
    "edit",
    ...download,
    "separator",
    "archive",
  ];
}

/** One part of a list row's meta line (S65). */
export type RowMetaPart =
  | { part: "shared-by" }
  | { part: "collection"; collection: { id: string; name: string } }
  | { part: "saved-data" }
  | { part: "activity" };

/** S65 — the list row's meta line, in the hand-back's order: Shared by ·
 *  collection · saved data · Updated, each only when it applies — possibly
 *  none. The kind tile shows the kind, and Share reaches the link. */
// r[impl hosting.row.meta-line]
export function rowMetaOf(
  a: Tiered & Pick<ArtefactSummary, "collectionId" | "usesStorage">,
  role: CardRole,
  lookup: ReadonlyMap<string, { id: string; name: string }>,
): RowMetaPart[] {
  const meta = cardMeta(a, role);
  const collection = collectionRowOf(a, lookup);
  const parts: RowMetaPart[] = [];
  if (meta.showSharedBy) parts.push({ part: "shared-by" });
  // r[impl hosting.card.collection-only-if-visible+3]
  if (collection) parts.push({ part: "collection", collection });
  if (a.usesStorage) parts.push({ part: "saved-data" });
  if (meta.showActivity) parts.push({ part: "activity" });
  return parts;
}

// S35 — the card preview: the thumbnail URL to load, or null for the striped kind
// placeholder. None recorded, or the image failed to load (e.g. access changed since
// the list was fetched), is the placeholder; a newer render (a new `?v=`) is tried
// again.
// r[impl hosting.thumbnail.placeholder-when-missing]
export function thumbnailToShow(thumbnailUrl: string | null, failedUrl: string | null): string | null {
  return thumbnailUrl !== null && thumbnailUrl !== failedUrl ? thumbnailUrl : null;
}
