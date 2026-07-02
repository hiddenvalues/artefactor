import { randomUUID } from "node:crypto";
import {
  createCollection,
  grantCollectionAccess,
  renameCollection,
  revokeCollectionAccess,
  setCollectionAccess,
  type Collection,
} from "../../domain/collection/collection";
import { collectSubtree } from "../../domain/collection/tree";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Visibility } from "../../domain/artefact/visibility";
import { mintUniqueSlug } from "../artefacts/slug";
import { loadOwnCollection } from "./get-own-collection";

// Application commands for S25 — Collections. Owner authority (CL9) and the
// no-leak rule (CL10) are enforced here; the pure domain transitions own the
// aggregate invariants.

export interface CreateCollectionInput {
  requesterId: string;
  name: string;
  parentId?: string | null;
  // Meaningful on roots only (CL4); validated against the enum by the route.
  visibility?: Visibility;
  scope: TenantScope;
}

export interface CollectionCommandDeps {
  collectionRepo: CollectionRepository;
  newId?: () => string;
  now?: () => Date;
}

export async function createCollectionCommand(
  input: CreateCollectionInput,
  deps: CollectionCommandDeps,
): Promise<Collection> {
  let parent: Collection | null = null;
  if (input.parentId) {
    // Non-owner / unknown parent → uniform not-found (CL10); the factory then
    // enforces same-owner/tenant + active-parent (CL1/CL3).
    parent = await loadOwnCollection(deps.collectionRepo, {
      id: input.parentId,
      ownerId: input.requesterId,
      scope: input.scope,
    });
  }
  const collection = createCollection({
    id: (deps.newId ?? randomUUID)(),
    ownerId: input.requesterId,
    name: input.name,
    parent,
    visibility: input.visibility,
    // Stamped from the resolved scope, like Artefact.tenantId at create (S22).
    tenantId: input.scope.tenantId,
    now: (deps.now ?? (() => new Date()))(),
  });
  await deps.collectionRepo.save(collection);
  return collection;
}

export interface EditCollectionInput {
  collectionId: string;
  requesterId: string;
  name?: string;
  visibility?: Visibility;
  scope: TenantScope;
}

// Slug back-fill (CL6/AH21) needs the artefacts, so edit carries the artefact
// repo (+ slug knobs for tests).
export interface EditCollectionDeps extends CollectionCommandDeps {
  artefactRepo: ArtefactRepository;
  generateSlug?: () => string;
  maxSlugAttempts?: number;
}

// Rename and/or change the access tier ("Rename & access"). A tier change to a
// shared tier back-fills slugs across the subtree's artefacts (CL6/AH21) —
// including archived ones, so a later restore cannot surface an effectively
// shared artefact without an address.
export async function editCollectionCommand(
  input: EditCollectionInput,
  deps: EditCollectionDeps,
): Promise<Collection> {
  let collection = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const now = (deps.now ?? (() => new Date()))();

  if (input.name !== undefined) {
    collection = renameCollection(collection, input.name, { now });
  }
  let tierChanged = false;
  if (input.visibility !== undefined) {
    const before = collection.visibility;
    collection = setCollectionAccess(collection, input.visibility, { now });
    tierChanged = collection.visibility !== before;
  }
  await deps.collectionRepo.save(collection);

  if (tierChanged && collection.visibility !== "private") {
    await backfillSlugs(collection, input.scope, deps);
  }
  return collection;
}

// Mint a slug for every slugless artefact in the tree (CL6/AH21). Minting only
// sets the retained address (AH5) — it changes no tier and bumps no timestamps.
async function backfillSlugs(
  root: Collection,
  scope: TenantScope,
  deps: EditCollectionDeps,
): Promise<void> {
  const all = await deps.collectionRepo.listByOwner(root.ownerId, scope, {
    includeArchived: true,
  });
  const subtreeIds = collectSubtree(all, root.id).map((c) => c.id);
  const artefacts = await deps.artefactRepo.listByCollectionIds(
    subtreeIds,
    scope,
    { includeArchived: true },
  );
  for (const artefact of artefacts) {
    if (artefact.publicSlug) continue; // mint once, retain (AH5)
    const slug = await mintUniqueSlug({
      repo: deps.artefactRepo,
      generateSlug: deps.generateSlug,
      maxSlugAttempts: deps.maxSlugAttempts,
    });
    await deps.artefactRepo.save({ ...artefact, publicSlug: slug });
  }
}

export interface ManageCollectionAccessInput {
  collectionId: string;
  requesterId: string;
  userId: string; // the user being granted / revoked
  scope: TenantScope;
}

// The `selected`-tier access list on a root (CL4), mirroring the S16 artefact
// commands. Granting a member can be the moment the tree becomes effectively
// shared for them, but the tier itself is what mints slugs (a `selected` root
// was set via editCollectionCommand first, which back-filled).
export async function grantCollectionAccessCommand(
  input: ManageCollectionAccessInput,
  deps: CollectionCommandDeps,
): Promise<Collection> {
  const existing = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const updated = grantCollectionAccess(
    existing,
    input.userId,
    (deps.now ?? (() => new Date()))(),
  );
  await deps.collectionRepo.save(updated);
  return updated;
}

export async function revokeCollectionAccessCommand(
  input: ManageCollectionAccessInput,
  deps: CollectionCommandDeps,
): Promise<Collection> {
  const existing = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const updated = revokeCollectionAccess(
    existing,
    input.userId,
    (deps.now ?? (() => new Date()))(),
  );
  await deps.collectionRepo.save(updated);
  return updated;
}

export async function listCollectionAccessMembers(
  input: { collectionId: string; requesterId: string; scope: TenantScope },
  deps: CollectionCommandDeps,
): Promise<string[]> {
  const existing = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  return [...existing.sharedWith];
}

// The owner's collections (the sidebar tree / archive view).
export async function listOwnCollections(
  input: { requesterId: string; includeArchived?: boolean; scope: TenantScope },
  deps: { collectionRepo: CollectionRepository },
): Promise<Collection[]> {
  return deps.collectionRepo.listByOwner(input.requesterId, input.scope, {
    includeArchived: input.includeArchived ?? false,
  });
}

export { CollectionNotFound };
