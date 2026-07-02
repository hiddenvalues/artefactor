import type { Collection } from "./collection";
import type { TenantScope } from "../artefact/tenant-scope";

export interface ListCollectionsOptions {
  // Include archived collections (the Archive view). Defaults to false.
  includeArchived?: boolean;
}

// Port: persistence for the Collection aggregate. Scope-aware like the artefact
// repository (S22 A2): reads never return rows outside the scope's tenant.
export interface CollectionRepository {
  // Persists the aggregate including its access list (`sharedWith`) — the
  // adapter syncs the membership set as part of the save, exactly as the
  // artefact adapter does for S16.
  save(collection: Collection): Promise<void>;
  // Permanently remove a collection row (CL8; archived-only is enforced by the
  // delete command). A no-op if the id does not exist.
  delete(id: string): Promise<void>;
  findById(id: string, scope: TenantScope): Promise<Collection | null>;
  // The owner's collections, active-only by default; name-ordered is left to
  // the client (the whole list is small and tree-shaped anyway).
  listByOwner(
    ownerId: string,
    scope: TenantScope,
    options?: ListCollectionsOptions,
  ): Promise<Collection[]>;
  // Active **root** collections whose (visibility, sharedWith) grants the
  // viewer, excluding the viewer's own — the collection side of the
  // effectively-shared composition (CL5): `authenticated`/`public` roots plus
  // `selected` roots the viewer is a member of.
  listSharedRoots(viewerId: string, scope: TenantScope): Promise<Collection[]>;
  // Every active collection in the given trees (rootId ∈ rootIds) — expands
  // shared roots into the collection-id set their artefacts live under.
  listByRoots(rootIds: readonly string[], scope: TenantScope): Promise<Collection[]>;
}
