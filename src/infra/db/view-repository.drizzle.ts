import { and, desc, eq } from "drizzle-orm";
import type { db as Db } from "./client";
import { viewEntry } from "./schema";
import type { ViewEntry } from "../../domain/views/view-entry";
import type {
  OwnViewRef,
  ViewerRef,
  ViewRepository,
} from "../../domain/views/view-repository";

type Database = typeof Db;
type ViewEntryRow = typeof viewEntry.$inferSelect;

// Drizzle/SQLite adapter for the ViewRepository port. One row per
// (artefact_id, viewer_id) — `save` upserts on that unique pair (views.entry.one-per-pair).
export class DrizzleViewRepository implements ViewRepository {
  constructor(private readonly db: Database) {}

  async findByArtefactAndViewer(
    artefactId: string,
    viewerId: string,
  ): Promise<ViewEntry | null> {
    const [row] = await this.db
      .select()
      .from(viewEntry)
      .where(
        and(
          eq(viewEntry.artefactId, artefactId),
          eq(viewEntry.viewerId, viewerId),
        ),
      )
      .limit(1);
    return row ? toEntry(row) : null;
  }

  async save(entry: ViewEntry): Promise<void> {
    const row = toRow(entry);
    await this.db
      .insert(viewEntry)
      .values(row)
      .onConflictDoUpdate({
        target: [viewEntry.artefactId, viewEntry.viewerId],
        set: { viewedAt: row.viewedAt },
      });
  }

  async listViewersByArtefact(artefactId: string): Promise<ViewerRef[]> {
    const rows = await this.db
      .select({ viewerId: viewEntry.viewerId, viewedAt: viewEntry.viewedAt })
      .from(viewEntry)
      .where(eq(viewEntry.artefactId, artefactId));
    return rows.map((r) => ({ viewerId: r.viewerId, viewedAt: r.viewedAt }));
  }

  async listByViewer(viewerId: string): Promise<OwnViewRef[]> {
    const rows = await this.db
      .select({ artefactId: viewEntry.artefactId, viewedAt: viewEntry.viewedAt })
      .from(viewEntry)
      .where(eq(viewEntry.viewerId, viewerId))
      .orderBy(desc(viewEntry.viewedAt));
    return rows.map((r) => ({ artefactId: r.artefactId, viewedAt: r.viewedAt }));
  }

  async deleteByArtefact(artefactId: string): Promise<void> {
    await this.db.delete(viewEntry).where(eq(viewEntry.artefactId, artefactId));
  }
}

function toRow(e: ViewEntry): ViewEntryRow {
  return {
    id: e.id,
    artefactId: e.artefactId,
    viewerId: e.viewerId,
    viewedAt: e.viewedAt,
  };
}

function toEntry(row: ViewEntryRow): ViewEntry {
  return {
    id: row.id,
    artefactId: row.artefactId,
    viewerId: row.viewerId,
    viewedAt: row.viewedAt,
  };
}
