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
import { ArtefactConflict } from "../../domain/artefact/errors";

type Database = typeof Db;
type ArtefactRow = typeof artefact.$inferSelect;
// What a save writes through: the client itself, or a transaction opened on it (S60).
type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;
export type AtomicRunner = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

// Drizzle/SQLite adapter for the ArtefactRepository port. The aggregate maps
// 1:1 onto the `artefact` row plus its `selected`-tier access list, which lives
// in the `artefact_access` join table (S16); the 100 MB HTML payload itself
// lives on the filesystem (see infra/storage) — the row only carries ref +
// bytes + hash.
export class DrizzleArtefactRepository implements ArtefactRepository {
  // S60 — `atomic` runs a save's guarded write and access-list sync as one unit on the executor it
  // hands over. The default runs them on the client one after the other: better-sqlite3 refuses an
  // async transaction callback. A deployment that can (Postgres) injects a transaction runner.
  constructor(
    private readonly db: Database,
    private readonly atomic: AtomicRunner = (fn) => fn(db),
  ) {}

  // A compare-and-set on `revision` (S60): revision 0 inserts the row, refusing an id that exists;
  // revision n updates it only while the stored revision is still n. Either way the row is written
  // at the next revision, and only then is the access list reconciled (S16), on the same executor
  // — inside one transaction where `atomic` opens one, so a sync failure rolls the row back and a
  // concurrent save waits on the row lock until both have committed. A conflicted save never
  // reaches the sync, so it writes nothing. This code stays byte-identical to the Postgres mirror,
  // which a parity check holds it to; only the wiring differs. `returning` (not an affected-row
  // count) keeps it dialect-neutral. `thumbnail_hash` is inserted as NULL and left out of the
  // update set (hosting.thumbnail.recorded-by-compare-and-set): only recordThumbnail writes it,
  // so a concurrent edit can't revert a render.
  // r[impl hosting.save.no-lost-update]
  async save(a: Artefact): Promise<Artefact> {
    const { thumbnailHash: _never, ...row } = toRow(a);
    const next = { ...row, revision: a.revision + 1 };
    return this.atomic(async (tx) => {
      const [saved] =
        a.revision === 0
          ? await tx
              .insert(artefact)
              .values({ ...next, thumbnailHash: null })
              .onConflictDoNothing({ target: artefact.id })
              .returning()
          : await tx
              .update(artefact)
              .set(next)
              .where(and(eq(artefact.id, a.id), eq(artefact.revision, a.revision)))
              .returning();
      if (!saved) throw new ArtefactConflict(a.id);
      await syncAccessList(tx, a.id, a.sharedWith);
      return toAggregate(saved, [...a.sharedWith]);
    });
  }

  // S35 — compare-and-set against the current payload hash; `updated_at`
  // is deliberately not touched.
  // r[impl hosting.thumbnail.recorded-by-compare-and-set]
  async recordThumbnail(id: string, renderedHash: string): Promise<boolean> {
    // `returning` (not the driver's affected-row count) keeps this dialect-neutral,
    // so the Postgres mirror stays byte-identical.
    const recorded = await this.db
      .update(artefact)
      .set({ thumbnailHash: renderedHash })
      .where(and(eq(artefact.id, id), eq(artefact.payloadHash, renderedHash)))
      .returning({ id: artefact.id });
    return recorded.length > 0;
  }

  // S35 (hosting.thumbnail.sweep-is-system-read) — the render sweep's system read:
  // tenant-agnostic by design, internal only, and projecting just what the renderer needs
  // (S37: plus the payload size, for the render input cap).
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

  // Permanent delete (hosting.delete.removes-everything). The data_entry and
  // artefact_access FKs are ON DELETE CASCADE, so the artefact's data + grants
  // are removed with it; the payload file is removed separately by the delete
  // command.
  async delete(id: string): Promise<void> {
    await this.db.delete(artefact).where(eq(artefact.id, id));
  }

  async findById(id: string, scope: TenantScope): Promise<Artefact | null> {
    // Tenant-scoped (S22, hosting.tenant.invisible-to-oss): a row in another tenant is
    // invisible.
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
          // (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant); those flow in via the
          // effectively-shared composition.
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

}

// Reconcile the persisted grant rows to match the aggregate's `sharedWith`
// (S16), on the executor the save runs on (S60). Diffs add/remove so unchanged
// grants keep their `granted_at`.
async function syncAccessList(
  tx: Executor,
  artefactId: string,
  want: readonly string[],
): Promise<void> {
  const current = await tx
    .select({ userId: artefactAccess.userId })
    .from(artefactAccess)
    .where(eq(artefactAccess.artefactId, artefactId));
  const currentIds = new Set(current.map((r) => r.userId));
  const wantSet = new Set(want);
  const toRemove = [...currentIds].filter((id) => !wantSet.has(id));
  const toAdd = want.filter((id) => !currentIds.has(id));
  if (toRemove.length > 0) {
    await tx
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
    await tx
      .insert(artefactAccess)
      .values(toAdd.map((userId) => ({ artefactId, userId, grantedAt: now })));
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
    linkPasswordHash: a.linkGate.passwordHash,
    linkExpiresAt: a.linkGate.expiresAt,
    linkGateVersion: a.linkGate.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    archivedAt: a.archivedAt,
    revision: a.revision,
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
    linkGate: {
      passwordHash: row.linkPasswordHash,
      expiresAt: row.linkExpiresAt,
      version: row.linkGateVersion,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    revision: row.revision,
  };
}
