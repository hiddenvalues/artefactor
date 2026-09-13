import { and, eq } from "drizzle-orm";
import type { db as Db } from "./client";
import { dataEntry } from "./schema";
import type { DataEntry } from "../../domain/data/data-entry";
import type {
  DataAuthorRef,
  DataRepository,
} from "../../domain/data/data-repository";

type Database = typeof Db;
type DataEntryRow = typeof dataEntry.$inferSelect;

// Drizzle/SQLite adapter for the DataRepository port. One row per
// (artefact_id, author_id) — `save` upserts on that unique pair (AD1).
export class DrizzleDataRepository implements DataRepository {
  constructor(private readonly db: Database) {}

  async findByArtefactAndAuthor(
    artefactId: string,
    authorId: string,
  ): Promise<DataEntry | null> {
    const [row] = await this.db
      .select()
      .from(dataEntry)
      .where(
        and(
          eq(dataEntry.artefactId, artefactId),
          eq(dataEntry.authorId, authorId),
        ),
      )
      .limit(1);
    return row ? toEntry(row) : null;
  }

  async save(entry: DataEntry): Promise<void> {
    const row = toRow(entry);
    await this.db
      .insert(dataEntry)
      .values(row)
      .onConflictDoUpdate({
        target: [dataEntry.artefactId, dataEntry.authorId],
        // The pin re-stamps on every write (AD9), not only on insert.
        set: {
          blob: row.blob,
          authoredAgainstVersion: row.authoredAgainstVersion,
          updatedAt: row.updatedAt,
        },
      });
  }

  async deleteByArtefactAndAuthor(
    artefactId: string,
    authorId: string,
  ): Promise<void> {
    await this.db
      .delete(dataEntry)
      .where(
        and(
          eq(dataEntry.artefactId, artefactId),
          eq(dataEntry.authorId, authorId),
        ),
      );
  }

  async deleteByArtefact(artefactId: string): Promise<void> {
    await this.db.delete(dataEntry).where(eq(dataEntry.artefactId, artefactId));
  }

  async listAuthorsByArtefact(artefactId: string): Promise<DataAuthorRef[]> {
    const rows = await this.db
      .select({ authorId: dataEntry.authorId, updatedAt: dataEntry.updatedAt })
      .from(dataEntry)
      .where(eq(dataEntry.artefactId, artefactId));
    return rows.map((r) => ({ authorId: r.authorId, updatedAt: r.updatedAt }));
  }
}

function toRow(e: DataEntry): DataEntryRow {
  return {
    id: e.id,
    artefactId: e.artefactId,
    authorId: e.authorId,
    blob: e.blob,
    authoredAgainstVersion: e.authoredAgainstVersion,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function toEntry(row: DataEntryRow): DataEntry {
  return {
    id: row.id,
    artefactId: row.artefactId,
    authorId: row.authorId,
    blob: row.blob,
    authoredAgainstVersion: row.authoredAgainstVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
