// Bookmarks (ddd/artefact-collections.md) — per-user pins of viewable
// artefacts and collections. A thin store in the S21 view-entry mould: no
// aggregate logic, set semantics at the persistence boundary. The view gate
// is the command's check; archived targets are filtered at read time by the
// caller (collections.bookmark.hidden-not-pruned) — the rows survive
// archive/restore.

export interface UserBookmarks {
  artefactIds: string[];
  collectionIds: string[];
}

export interface BookmarkRepository {
  listByUser(userId: string): Promise<UserBookmarks>;
  // One row per (user, target): every add and remove is idempotent.
  // r[impl collections.bookmark.set-semantics]
  addArtefact(userId: string, artefactId: string): Promise<void>;
  removeArtefact(userId: string, artefactId: string): Promise<void>;
  addCollection(userId: string, collectionId: string): Promise<void>;
  removeCollection(userId: string, collectionId: string): Promise<void>;
  // Remove every user's bookmark of a permanently-deleted target; the
  // permanent-delete commands call these, and the FK cascades are the DB-level
  // backstop.
  // r[impl collections.bookmark.removed-with-target]
  deleteByArtefact(artefactId: string): Promise<void>;
  deleteByCollection(collectionId: string): Promise<void>;
}
