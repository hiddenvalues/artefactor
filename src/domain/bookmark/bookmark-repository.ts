// Bookmarks (ddd/artefact-collections.md, BM1–BM4) — per-user pins of owned
// artefacts and collections. A thin store in the S21 view-entry mould: no
// aggregate logic, set semantics at the persistence boundary (BM1). Own-items-
// only (BM2) is the command's check; archived targets are filtered at read time
// by the caller (BM3) — the rows survive archive/restore.

export interface UserBookmarks {
  artefactIds: string[];
  collectionIds: string[];
}

export interface BookmarkRepository {
  listByUser(userId: string): Promise<UserBookmarks>;
  // All adds/removes are idempotent (BM1).
  addArtefact(userId: string, artefactId: string): Promise<void>;
  removeArtefact(userId: string, artefactId: string): Promise<void>;
  addCollection(userId: string, collectionId: string): Promise<void>;
  removeCollection(userId: string, collectionId: string): Promise<void>;
  // Remove every user's bookmark of a permanently-deleted target (BM4); the FK
  // cascades are the DB-level backstop.
  deleteByArtefact(artefactId: string): Promise<void>;
  deleteByCollection(collectionId: string): Promise<void>;
}
