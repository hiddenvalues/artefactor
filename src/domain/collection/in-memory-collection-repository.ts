import type { Collection } from "./collection";
import type {
  CollectionRepository,
  ListCollectionsOptions,
} from "./collection-repository";
import type { TenantScope } from "../artefact/tenant-scope";

// In-memory implementation of the CollectionRepository port — the primary TDD
// test double for the collections slices (S25–S27).
export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly store = new Map<string, Collection>();

  async save(collection: Collection): Promise<void> {
    this.store.set(collection.id, { ...collection });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findById(id: string, scope: TenantScope): Promise<Collection | null> {
    const found = this.store.get(id);
    if (!found || found.tenantId !== scope.tenantId) return null;
    return { ...found };
  }

  async listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListCollectionsOptions,
  ): Promise<Collection[]> {
    const includeArchived = options?.includeArchived ?? false;
    return [...this.store.values()]
      .filter(
        (c) =>
          c.tenantId === scope.tenantId &&
          c.ownerId === ownerId &&
          (includeArchived || c.status === "active"),
      )
      .map((c) => ({ ...c }));
  }

  async listSharedRoots(
    viewerId: string,
    scope: TenantScope,
  ): Promise<Collection[]> {
    return [...this.store.values()]
      .filter(
        (c) =>
          c.tenantId === scope.tenantId &&
          c.status === "active" &&
          c.parentId === null &&
          c.ownerId !== viewerId &&
          (c.visibility === "authenticated" ||
            c.visibility === "public" ||
            (c.visibility === "selected" && c.sharedWith.includes(viewerId))),
      )
      .map((c) => ({ ...c }));
  }

  async listByRoots(
    rootIds: readonly string[],
    scope: TenantScope,
  ): Promise<Collection[]> {
    const roots = new Set(rootIds);
    return [...this.store.values()]
      .filter(
        (c) =>
          c.tenantId === scope.tenantId &&
          c.status === "active" &&
          roots.has(c.rootId),
      )
      .map((c) => ({ ...c }));
  }
}
