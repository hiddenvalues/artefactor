import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { db as Db } from "./client";
import { collection, collectionAccess } from "./schema";
import type { Collection } from "../../domain/collection/collection";
import type {
  CollectionRepository,
  ListCollectionsOptions,
} from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

type Database = typeof Db;
type CollectionRow = typeof collection.$inferSelect;

// Drizzle/SQLite adapter for the CollectionRepository port (S25). Mirrors the
// artefact adapter: the aggregate maps onto the `collection` row plus its
// `selected`-tier access list in `collection_access`.
export class DrizzleCollectionRepository implements CollectionRepository {
  constructor(private readonly db: Database) {}

  async save(c: Collection): Promise<void> {
    const row = toRow(c);
    await this.db
      .insert(collection)
      .values(row)
      .onConflictDoUpdate({ target: collection.id, set: row });
    await this.syncAccessList(c.id, c.sharedWith);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(collection).where(eq(collection.id, id));
  }

  async findById(id: string, scope: TenantScope): Promise<Collection | null> {
    const [row] = await this.db
      .select()
      .from(collection)
      .where(and(eq(collection.id, id), eq(collection.tenantId, scope.tenantId)))
      .limit(1);
    return row ? toAggregate(row, await this.granteesOf(id)) : null;
  }

  async listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListCollectionsOptions,
  ): Promise<Collection[]> {
    const base = and(
      eq(collection.tenantId, scope.tenantId),
      eq(collection.ownerId, ownerId),
    );
    const where =
      options?.includeArchived === true
        ? base
        : and(base, eq(collection.status, "active"));
    const rows = await this.db.select().from(collection).where(where);
    const grantees = await this.granteesByCollection(rows.map((r) => r.id));
    return rows.map((r) => toAggregate(r, grantees.get(r.id) ?? []));
  }

  async listSharedRoots(
    viewerId: string,
    scope: TenantScope,
  ): Promise<Collection[]> {
    // Active roots whose tier grants the viewer (CL4/CL5) — the collection side
    // of the effectively-shared composition. Membership via the join table,
    // exactly like listShared on artefacts.
    const memberCollectionIds = this.db
      .select({ id: collectionAccess.collectionId })
      .from(collectionAccess)
      .where(eq(collectionAccess.userId, viewerId));
    const rows = await this.db
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.tenantId, scope.tenantId),
          eq(collection.status, "active"),
          ne(collection.ownerId, viewerId),
          // Roots only — nested collections' tiers are never consulted (CL4).
          isNull(collection.parentId),
          or(
            inArray(collection.visibility, ["authenticated", "public"]),
            and(
              eq(collection.visibility, "selected"),
              inArray(collection.id, memberCollectionIds),
            ),
          ),
        ),
      );
    // Recipients never manage membership; empty sharedWith like listShared.
    return rows.map((r) => toAggregate(r, []));
  }

  async listByRoots(
    rootIds: readonly string[],
    scope: TenantScope,
  ): Promise<Collection[]> {
    if (rootIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(collection)
      .where(
        and(
          eq(collection.tenantId, scope.tenantId),
          eq(collection.status, "active"),
          inArray(collection.rootId, [...rootIds]),
        ),
      );
    return rows.map((r) => toAggregate(r, []));
  }

  private async granteesOf(collectionId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: collectionAccess.userId })
      .from(collectionAccess)
      .where(eq(collectionAccess.collectionId, collectionId))
      .orderBy(collectionAccess.grantedAt);
    return rows.map((r) => r.userId);
  }

  private async granteesByCollection(
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({
        collectionId: collectionAccess.collectionId,
        userId: collectionAccess.userId,
      })
      .from(collectionAccess)
      .where(inArray(collectionAccess.collectionId, ids))
      .orderBy(collectionAccess.grantedAt);
    for (const r of rows) {
      const list = out.get(r.collectionId);
      if (list) list.push(r.userId);
      else out.set(r.collectionId, [r.userId]);
    }
    return out;
  }

  private async syncAccessList(
    collectionId: string,
    want: readonly string[],
  ): Promise<void> {
    const current = await this.db
      .select({ userId: collectionAccess.userId })
      .from(collectionAccess)
      .where(eq(collectionAccess.collectionId, collectionId));
    const currentIds = new Set(current.map((r) => r.userId));
    const wantSet = new Set(want);
    const toRemove = [...currentIds].filter((id) => !wantSet.has(id));
    const toAdd = want.filter((id) => !currentIds.has(id));
    if (toRemove.length > 0) {
      await this.db
        .delete(collectionAccess)
        .where(
          and(
            eq(collectionAccess.collectionId, collectionId),
            inArray(collectionAccess.userId, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      const now = new Date();
      await this.db
        .insert(collectionAccess)
        .values(toAdd.map((userId) => ({ collectionId, userId, grantedAt: now })));
    }
  }
}

function toRow(c: Collection): CollectionRow {
  return {
    id: c.id,
    ownerId: c.ownerId,
    tenantId: c.tenantId,
    name: c.name,
    parentId: c.parentId,
    rootId: c.rootId,
    visibility: c.visibility,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    archivedAt: c.archivedAt,
  };
}

function toAggregate(row: CollectionRow, sharedWith: string[]): Collection {
  return {
    id: row.id,
    ownerId: row.ownerId,
    tenantId: row.tenantId,
    name: row.name,
    parentId: row.parentId,
    rootId: row.rootId,
    visibility: row.visibility,
    sharedWith,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}
