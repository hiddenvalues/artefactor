import type { Collection } from "../../domain/collection/collection";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

// Load a collection the requester owns, regardless of status (the lifecycle
// commands need the archived one). Missing, not-owned, and out-of-scope all
// surface identically as not-found, so a collection's existence never leaks to
// a non-owner (mirroring hosting.access.matrix, hosting.authority.owner-only).
// r[impl collections.authority.owner-only+3]
// r[impl collections.access.no-existence-leak]
export async function loadOwnCollection(
  repo: CollectionRepository,
  params: { id: string; ownerId: string; scope: TenantScope },
): Promise<Collection> {
  const collection = await repo.findById(params.id, params.scope);
  if (!collection || collection.ownerId !== params.ownerId) {
    throw new CollectionNotFound(params.id);
  }
  return collection;
}
