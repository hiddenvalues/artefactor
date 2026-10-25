import type { Artefact } from "./artefact";
import { ArtefactConflict } from "./errors";
import type {
  ArtefactRepository,
  ListByOwnerOptions,
  ThumbnailJob,
} from "./artefact-repository";
import type { TenantScope } from "./tenant-scope";

// In-memory implementation of the ArtefactRepository port. This is the primary
// TDD test double for domain slices (S2+) — no database required.
export class InMemoryArtefactRepository implements ArtefactRepository {
  private readonly store = new Map<string, Artefact>();

  async save(artefact: Artefact): Promise<Artefact> {
    // S60 (hosting.save.no-lost-update) — the same compare-and-set as the Drizzle adapter.
    const stored = this.store.get(artefact.id);
    // A stored row is at revision ≥ 1 and a missing one counts as 0, so a revision-0 save of an
    // existing id and a revision-n save of a deleted one both miss.
    const current = stored ? stored.revision : 0;
    if (current !== artefact.revision) {
      throw new ArtefactConflict(artefact.id);
    }
    // A save never writes thumbnailHash; only recordThumbnail does
    // (hosting.thumbnail.recorded-by-compare-and-set).
    const saved = {
      ...artefact,
      thumbnailHash: stored?.thumbnailHash ?? null,
      revision: artefact.revision + 1,
    };
    this.store.set(artefact.id, saved);
    return { ...saved };
  }

  async recordThumbnail(id: string, renderedHash: string): Promise<boolean> {
    const found = this.store.get(id);
    if (!found || found.payloadHash !== renderedHash) return false;
    this.store.set(id, { ...found, thumbnailHash: renderedHash });
    return true;
  }

  async listNeedingThumbnail(limit: number): Promise<ThumbnailJob[]> {
    return [...this.store.values()]
      .filter((a) => a.status === "active" && a.thumbnailHash !== a.payloadHash)
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        payloadRef: a.payloadRef,
        payloadHash: a.payloadHash,
        thumbnailHash: a.thumbnailHash,
        payloadSize: a.payloadBytes,
      }));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findById(id: string, scope: TenantScope): Promise<Artefact | null> {
    const found = this.store.get(id);
    // Outside the scope's tenant the row is invisible (S22, hosting.tenant.invisible-to-oss).
    if (!found || found.tenantId !== scope.tenantId) return null;
    return { ...found };
  }

  async findBySlug(slug: string): Promise<Artefact | null> {
    // Global by design — a slug is a tenant-agnostic capability (hosting.slug.globally-unique).
    for (const a of this.store.values()) {
      if (a.publicSlug === slug) return { ...a };
    }
    return null;
  }

  async listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]> {
    const includeArchived = options?.includeArchived ?? false;
    return [...this.store.values()]
      .filter(
        (a) =>
          a.tenantId === scope.tenantId &&
          a.ownerId === ownerId &&
          (includeArchived || a.status === "active"),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((a) => ({ ...a }));
  }

  async listShared(
    viewerId: string,
    scope: TenantScope,
  ): Promise<Artefact[]> {
    return [...this.store.values()]
      .filter(
        (a) =>
          a.tenantId === scope.tenantId &&
          a.status === "active" &&
          a.ownerId !== viewerId &&
          // In a collection the own tier is dormant (hosting.access.effective-from-tree-root, collections.access.contained-own-tier-dormant)
          // — those flow in via the effectively-shared composition, not this query.
          a.collectionId === null &&
          (a.visibility === "authenticated" ||
            a.visibility === "public" ||
            // `selected` shows only to the members it was shared with
            // (hosting.access.matrix, hosting.access-list.retained).
            (a.visibility === "selected" &&
              a.sharedWith.includes(viewerId))),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      // No access list, as on the SQL adapters: recipients don't see co-members.
      .map((a) => ({ ...a, sharedWith: [] }));
  }

  async listByCollectionIds(
    collectionIds: readonly string[],
    scope: TenantScope,
    options?: ListByOwnerOptions,
  ): Promise<Artefact[]> {
    const includeArchived = options?.includeArchived ?? false;
    const ids = new Set(collectionIds);
    return [...this.store.values()]
      .filter(
        (a) =>
          a.tenantId === scope.tenantId &&
          a.collectionId !== null &&
          ids.has(a.collectionId) &&
          (includeArchived || a.status === "active"),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      // No access list, as on the SQL adapters: a listed copy is never saved (S60).
      .map((a) => ({ ...a, sharedWith: [] }));
  }
}
