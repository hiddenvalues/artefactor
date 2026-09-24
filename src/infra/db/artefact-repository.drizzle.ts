import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { db as Db } from "./client";
import { artefact, artefactAccess } from "./schema";
import type { Artefact } from "../../domain/artefact/artefact";
import type {
  ArtefactRepository,
  ListByOwnerOptions,
  ThumbnailJob,
} from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

type Database = typeof Db;
type ArtefactRow = typeof artefact.$inferSelect;

// Drizzle/SQLite adapter for the ArtefactRepository port. The aggregate maps
// 1:1 onto the `artefact` row plus its `selected`-tier access list, which lives
// in the `artefact_access` join table (S16); the 100 MB HTML payload itself
// lives on the filesystem (see infra/storage) — the row only carries ref +
// bytes + hash.
export class DrizzleArtefactRepository implements ArtefactRepository {
  constructor(private readonly db: Database) {}

  // Upsert by id so the same port serves create (S2) and later mutations
  // (edit/share/archive in S3/S5/S7), then reconcile the access list (S16).
  // `thumbnail_hash` is inserted as NULL and left out of the update set (AH26):
  // only recordThumbnail writes it, so a concurrent edit can't revert a render.
  async save(a: Artefact): Promise<void> {
    const { thumbnailHash: _never, ...row } = toRow(a);
    await this.db
      .insert(artefact)
      .values({ ...row, thumbnailHash: null })
      .onConflictDoUpdate({ target: artefact.id, set: row });
    await this.syncAccessList(a.id, a.sharedWith);
  }

  // S35 (AH26) — compare-and-set against the current payload hash; `updated_at`
  // is deliberately not touched.
  async recordThumbnail(id: string, renderedHash: string): Promise<boolean> {
    // `returning` (not the driver's affected-row count) keeps this dialect-neutral,
    // so the Postgres mirror stays byte-identical (P3).
    const recorded = await this.db
      .update(artefact)
      .set({ thumbnailHash: renderedHash })
      .where(and(eq(artefact.id, id), eq(artefact.payloadHash, renderedHash)))
      .returning({ id: artefact.id });
    return recorded.length > 0;
  }

  // S35 (AH17 note) — the render sweep's system read: tenant-agnostic by design,
  // internal only, and projecting just what the renderer needs (S37: plus the
  // payload size, for the render input cap).
  async listNeedingThumbnail(limit: number): Promise<ThumbnailJob[]> {
    return this.db
      .select({
        id: artefact.id,
        payloadRef: artefact.payloadRef,
        payloadHash: artefact.payloadHash,
        thumbnailHash: artefact.thumbnailHash,
        payloadSize: artefact.payloadBytes,
      })
      .from(artefact)
      .where(
        and(
          eq(artefact.status, "active"),
          or(
            isNull(artefact.thumbnailHash),
            ne(artefact.thumbnailHash, artefact.payloadHash),
          ),
        ),
      )
      .limit(limit);
  }

  // Permanent delete (AH11). The data_entry and artefact_access FKs are ON
  // DELETE CASCADE, so the artefact's data + grants are removed with it; the
  // payload file is removed separately by the delete command.
  async delete(id: string): Promise<void> {
    await this.db.delete(artefact).where(eq(artefact.id, id));
  }

  async findById(id: string, scope: TenantScope): Promise<Artefact | null> {
    // Tenant-scoped (S22/AH17, T2): a row in another tenant is invisible.
    const [row] = await this.db
      .select()
      .from(artefact)
      .where(and(eq(artefact.id, id), eq(artefact.tenantId, scope.tenantId)))
      .limit(1);
    return row ? toAggregate(row, await this.granteesOf(id)) : null;
  }

  async findBySlug(slug: string): Promise<Artefact | null> {
    const [row] = await this.db
      .select()
      .from(artefact)
      .where(eq(artefact.publicSlug, slug))
      .limit(1);
    return row ? toAggregate(row, await this.granteesOf(row.id)) : null;
  }

  async listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]> {
    // Tenant-scoped: the dashboard shows only the active org's artefacts (ET4).
    const tenant = eq(artefact.tenantId, scope.tenantId);
    const where =
      options?.includeArchived === true
        ? and(tenant, eq(artefact.ownerId, ownerId))
        : and(
            tenant,
            eq(artefact.ownerId, ownerId),
            eq(artefact.status, "active"),
          );
    const rows = await this.db
      .select()
      .from(artefact)
      .where(where)
      .orderBy(desc(artefact.updatedAt));
    // The owner manages their artefacts' access lists, so populate `sharedWith`.
    const grantees = await this.granteesByArtefact(rows.map((r) => r.id));
    return rows.map((r) => toAggregate(r, grantees.get(r.id) ?? []));
  }

  async listShared(
    viewerId: string,
    scope: TenantScope,
  ): Promise<Artefact[]> {
    // Cross-owner, active, **within the tenant scope**, excluding the viewer's
    // own. `authenticated`/`public` match outright; a `selected` artefact matches
    // only when the viewer is a member (via the `artefact_access` subquery). Uses
    // the (status, visibility) index + the user_id index on the join table.
    const memberArtefactIds = this.db
      .select({ id: artefactAccess.artefactId })
      .from(artefactAccess)
      .where(eq(artefactAccess.userId, viewerId));
    const rows = await this.db
      .select()
      .from(artefact)
      .where(
        and(
          eq(artefact.tenantId, scope.tenantId),
          eq(artefact.status, "active"),
          ne(artefact.ownerId, viewerId),
          // Top-level only — a contained artefact's own tier is dormant
          // (AH20/CL5); those flow in via the effectively-shared composition.
          isNull(artefact.collectionId),
          or(
            inArray(artefact.visibility, ["authenticated", "public"]),
            and(
              eq(artefact.visibility, "selected"),
              inArray(artefact.id, memberArtefactIds),
            ),
          ),
        ),
      )
      .orderBy(desc(artefact.updatedAt));
    // Recipients don't manage membership and shouldn't see co-members, so the
    // returned aggregates carry an empty `sharedWith` here (it's unused by the
    // "Shared with you" view).
    return rows.map((r) => toAggregate(r, []));
  }

  async listByCollectionIds(
    collectionIds: readonly string[],
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]> {
    if (collectionIds.length === 0) return [];
    const base = and(
      eq(artefact.tenantId, scope.tenantId),
      inArray(artefact.collectionId, [...collectionIds]),
    );
    const where =
      options?.includeArchived === true
        ? base
        : and(base, eq(artefact.status, "active"));
    const rows = await this.db
      .select()
      .from(artefact)
      .where(where)
      .orderBy(desc(artefact.updatedAt));
    return rows.map((r) => toAggregate(r, []));
  }

  // The granted user ids for one artefact, oldest grant first (stable order).
  private async granteesOf(artefactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: artefactAccess.userId })
      .from(artefactAccess)
      .where(eq(artefactAccess.artefactId, artefactId))
      .orderBy(artefactAccess.grantedAt);
    return rows.map((r) => r.userId);
  }

  // Batch variant for list reads — grantees grouped by artefact id.
  private async granteesByArtefact(
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({
        artefactId: artefactAccess.artefactId,
        userId: artefactAccess.userId,
      })
      .from(artefactAccess)
      .where(inArray(artefactAccess.artefactId, ids))
      .orderBy(artefactAccess.grantedAt);
    for (const r of rows) {
      const list = out.get(r.artefactId);
      if (list) list.push(r.userId);
      else out.set(r.artefactId, [r.userId]);
    }
    return out;
  }

  // Reconcile the persisted grant rows to match the aggregate's `sharedWith`
  // (S16). Diffs add/remove so unchanged grants keep their `granted_at`.
  private async syncAccessList(
    artefactId: string,
    want: readonly string[],
  ): Promise<void> {
    const current = await this.db
      .select({ userId: artefactAccess.userId })
      .from(artefactAccess)
      .where(eq(artefactAccess.artefactId, artefactId));
    const currentIds = new Set(current.map((r) => r.userId));
    const wantSet = new Set(want);
    const toRemove = [...currentIds].filter((id) => !wantSet.has(id));
    const toAdd = want.filter((id) => !currentIds.has(id));
    if (toRemove.length > 0) {
      await this.db
        .delete(artefactAccess)
        .where(
          and(
            eq(artefactAccess.artefactId, artefactId),
            inArray(artefactAccess.userId, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      const now = new Date();
      await this.db
        .insert(artefactAccess)
        .values(toAdd.map((userId) => ({ artefactId, userId, grantedAt: now })));
    }
  }
}

function toRow(a: Artefact): ArtefactRow {
  return {
    id: a.id,
    ownerId: a.ownerId,
    tenantId: a.tenantId,
    title: a.title,
    kind: a.kind,
    visibility: a.visibility,
    publicSlug: a.publicSlug,
    collectionId: a.collectionId,
    status: a.status,
    payloadRef: a.payloadRef,
    payloadBytes: a.payloadBytes,
    payloadHash: a.payloadHash,
    usesStorage: a.usesStorage,
    thumbnailHash: a.thumbnailHash,
    dataVisibility: a.dataVisibility,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    archivedAt: a.archivedAt,
  };
}

function toAggregate(row: ArtefactRow, sharedWith: string[]): Artefact {
  return {
    id: row.id,
    ownerId: row.ownerId,
    tenantId: row.tenantId,
    title: row.title,
    kind: row.kind,
    visibility: row.visibility,
    sharedWith,
    publicSlug: row.publicSlug,
    collectionId: row.collectionId,
    status: row.status,
    payloadRef: row.payloadRef,
    payloadBytes: row.payloadBytes,
    payloadHash: row.payloadHash,
    usesStorage: row.usesStorage,
    thumbnailHash: row.thumbnailHash,
    dataVisibility: row.dataVisibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}
