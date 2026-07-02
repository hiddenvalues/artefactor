import type { Artefact } from "./artefact";
import type {
  ArtefactRepository,
  ListByOwnerOptions,
} from "./artefact-repository";
import type { TenantScope } from "./tenant-scope";

// In-memory implementation of the ArtefactRepository port. This is the primary
// TDD test double for domain slices (S2+) — no database required.
export class InMemoryArtefactRepository implements ArtefactRepository {
  private readonly store = new Map<string, Artefact>();

  async save(artefact: Artefact): Promise<void> {
    this.store.set(artefact.id, { ...artefact });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findById(id: string, scope: TenantScope): Promise<Artefact | null> {
    const found = this.store.get(id);
    // Outside the scope's tenant the row is invisible (S22/AH17, T2).
    if (!found || found.tenantId !== scope.tenantId) return null;
    return { ...found };
  }

  async findBySlug(slug: string): Promise<Artefact | null> {
    // Global by design — a slug is a tenant-agnostic capability (AH6).
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
          // In a collection the own tier is dormant (AH20/CL5) — those flow in
          // via the effectively-shared composition, not this query.
          a.collectionId === null &&
          (a.visibility === "authenticated" ||
            a.visibility === "public" ||
            // `selected` shows only to the members it was shared with (AH8/13).
            (a.visibility === "selected" &&
              a.sharedWith.includes(viewerId))),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((a) => ({ ...a }));
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
      .map((a) => ({ ...a }));
  }
}
