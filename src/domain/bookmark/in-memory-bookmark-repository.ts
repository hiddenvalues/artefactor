import type { BookmarkRepository, UserBookmarks } from "./bookmark-repository";

// In-memory implementation of the BookmarkRepository port (TDD double).
export class InMemoryBookmarkRepository implements BookmarkRepository {
  // userId → target-id sets.
  private readonly artefacts = new Map<string, Set<string>>();
  private readonly collections = new Map<string, Set<string>>();

  async listByUser(userId: string): Promise<UserBookmarks> {
    return {
      artefactIds: [...(this.artefacts.get(userId) ?? [])],
      collectionIds: [...(this.collections.get(userId) ?? [])],
    };
  }

  async addArtefact(userId: string, artefactId: string): Promise<void> {
    const set = this.artefacts.get(userId) ?? new Set();
    set.add(artefactId);
    this.artefacts.set(userId, set);
  }

  async removeArtefact(userId: string, artefactId: string): Promise<void> {
    this.artefacts.get(userId)?.delete(artefactId);
  }

  async addCollection(userId: string, collectionId: string): Promise<void> {
    const set = this.collections.get(userId) ?? new Set();
    set.add(collectionId);
    this.collections.set(userId, set);
  }

  async removeCollection(userId: string, collectionId: string): Promise<void> {
    this.collections.get(userId)?.delete(collectionId);
  }

  async deleteByArtefact(artefactId: string): Promise<void> {
    for (const set of this.artefacts.values()) set.delete(artefactId);
  }

  async deleteByCollection(collectionId: string): Promise<void> {
    for (const set of this.collections.values()) set.delete(collectionId);
  }
}
