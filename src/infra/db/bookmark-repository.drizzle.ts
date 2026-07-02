import { and, eq } from "drizzle-orm";
import type { db as Db } from "./client";
import { artefactBookmark, collectionBookmark } from "./schema";
import type {
  BookmarkRepository,
  UserBookmarks,
} from "../../domain/bookmark/bookmark-repository";

type Database = typeof Db;

// Drizzle/SQLite adapter for the BookmarkRepository port (S27). Set semantics
// (BM1) via the (user, target) primary keys — adds are ON CONFLICT DO NOTHING,
// removes are naturally idempotent.
export class DrizzleBookmarkRepository implements BookmarkRepository {
  constructor(private readonly db: Database) {}

  async listByUser(userId: string): Promise<UserBookmarks> {
    const artefacts = await this.db
      .select({ id: artefactBookmark.artefactId })
      .from(artefactBookmark)
      .where(eq(artefactBookmark.userId, userId))
      .orderBy(artefactBookmark.createdAt);
    const collections = await this.db
      .select({ id: collectionBookmark.collectionId })
      .from(collectionBookmark)
      .where(eq(collectionBookmark.userId, userId))
      .orderBy(collectionBookmark.createdAt);
    return {
      artefactIds: artefacts.map((r) => r.id),
      collectionIds: collections.map((r) => r.id),
    };
  }

  async addArtefact(userId: string, artefactId: string): Promise<void> {
    await this.db
      .insert(artefactBookmark)
      .values({ userId, artefactId, createdAt: new Date() })
      .onConflictDoNothing();
  }

  async removeArtefact(userId: string, artefactId: string): Promise<void> {
    await this.db
      .delete(artefactBookmark)
      .where(
        and(
          eq(artefactBookmark.userId, userId),
          eq(artefactBookmark.artefactId, artefactId),
        ),
      );
  }

  async addCollection(userId: string, collectionId: string): Promise<void> {
    await this.db
      .insert(collectionBookmark)
      .values({ userId, collectionId, createdAt: new Date() })
      .onConflictDoNothing();
  }

  async removeCollection(userId: string, collectionId: string): Promise<void> {
    await this.db
      .delete(collectionBookmark)
      .where(
        and(
          eq(collectionBookmark.userId, userId),
          eq(collectionBookmark.collectionId, collectionId),
        ),
      );
  }

  async deleteByArtefact(artefactId: string): Promise<void> {
    await this.db
      .delete(artefactBookmark)
      .where(eq(artefactBookmark.artefactId, artefactId));
  }

  async deleteByCollection(collectionId: string): Promise<void> {
    await this.db
      .delete(collectionBookmark)
      .where(eq(collectionBookmark.collectionId, collectionId));
  }
}
