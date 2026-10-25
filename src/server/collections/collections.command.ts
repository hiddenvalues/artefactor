import { randomUUID } from "node:crypto";
import {
  assignCollectionSlug,
  createCollection,
  grantCollectionAccess,
  describeCollection,
  renameCollection,
  revokeCollectionAccess,
  setCollectionAccess,
  type Collection,
} from "../../domain/collection/collection";
import { collectSubtree } from "../../domain/collection/tree";
import { CollectionInvariantViolation, CollectionNotFound } from "../../domain/collection/errors";
import { clearCollectionLinkGate, setCollectionLinkGate } from "../../domain/collection/link-gate";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Visibility } from "../../domain/artefact/visibility";
import { mintUniqueSlug } from "../artefacts/slug";
import { loadOwnCollection } from "./get-own-collection";
import { cascadeTo } from "./cascade-artefact";
import { withEffectiveShareSlug } from "./share-slug";
import type { Artefact } from "../../domain/artefact/artefact";

// Application commands for S25 — Collections. Owner authority (collections.authority.owner-only) and the
// no-leak rule (collections.access.no-existence-leak) are enforced here; the pure domain transitions own the
// aggregate invariants.

export interface CreateCollectionInput {
  requesterId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  // Roots only (collections.access.set-on-root-only): the factory refuses it with a parentId.
  // Validated against the enum by the route.
  visibility?: Visibility;
  scope: TenantScope;
}

export interface CollectionCommandDeps {
  collectionRepo: CollectionRepository;
  newId?: () => string;
  now?: () => Date;
  // Slug knobs for tests — a root's slug (S44) and the collections.slug.minted-on-effective-share back-fill.
  generateSlug?: () => string;
  maxSlugAttempts?: number;
}

// S44 — a root gets its slug on its first transition to a shared tier, and keeps
// it (retained like hosting.slug.minted-once-retained). Collision-checked against
// the other collection slugs only: artefact and collection slugs are independent
// namespaces.
// r[impl collections.public-link.root-slug-minted]
async function withRootSlug(
  collection: Collection,
  deps: CollectionCommandDeps,
): Promise<Collection> {
  if (collection.parentId !== null) return collection;
  if (collection.visibility === "private" || collection.publicSlug !== null) return collection;
  const slug = await mintUniqueSlug({
    repo: deps.collectionRepo,
    generateSlug: deps.generateSlug,
    maxSlugAttempts: deps.maxSlugAttempts,
  });
  return assignCollectionSlug(collection, slug);
}

export async function createCollectionCommand(
  input: CreateCollectionInput,
  deps: CollectionCommandDeps,
): Promise<Collection> {
  let parent: Collection | null = null;
  if (input.parentId) {
    // Non-owner / unknown parent → uniform not-found (collections.access.no-existence-leak); the factory then
    // enforces same-owner/tenant + active-parent (collections.tree.single-owner, collections.tree.shape-fixed).
    parent = await loadOwnCollection(deps.collectionRepo, {
      id: input.parentId,
      ownerId: input.requesterId,
      scope: input.scope,
    });
  }
  const created = createCollection({
    id: (deps.newId ?? randomUUID)(),
    ownerId: input.requesterId,
    name: input.name,
    description: input.description,
    parent,
    visibility: input.visibility,
    // Stamped from the resolved scope, like Artefact.tenantId at create (S22).
    tenantId: input.scope.tenantId,
    now: (deps.now ?? (() => new Date()))(),
  });
  const collection = await withRootSlug(created, deps);
  await deps.collectionRepo.save(collection);
  return collection;
}

export interface EditCollectionInput {
  collectionId: string;
  requesterId: string;
  name?: string;
  // S74 — a string sets it, null clears it, undefined leaves it.
  description?: string | null;
  visibility?: Visibility;
  // S32b — link protection set with the root's change to `public` (only then).
  linkGate?: { password?: string; expiresAt?: Date };
  scope: TenantScope;
}

// Slug back-fill (collections.slug.minted-on-effective-share, hosting.slug.minted-on-root-share) needs the artefacts, so edit carries the
// artefact repo (+ slug knobs for tests); a gate set with the tier needs the hasher.
export interface EditCollectionDeps extends CollectionCommandDeps {
  artefactRepo: ArtefactRepository;
  hasher?: LinkPasswordHasher;
}

// Rename, describe and/or change the access tier ("Edit details & access"). A tier change to a shared tier
// back-fills slugs across the subtree's artefacts (collections.slug.minted-on-effective-share, hosting.slug.minted-on-root-share) —
// including archived ones, so a later restore cannot surface an effectively shared artefact without
// an address.
export async function editCollectionCommand(
  input: EditCollectionInput,
  deps: EditCollectionDeps,
): Promise<Collection> {
  if (input.linkGate !== undefined && input.visibility !== "public") {
    throw new CollectionInvariantViolation("link protection is set with the change to public");
  }
  let collection = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const now = (deps.now ?? (() => new Date()))();

  if (input.name !== undefined) {
    collection = renameCollection(collection, input.name, { now });
  }
  if (input.description !== undefined) {
    collection = describeCollection(collection, input.description, { now });
  }
  let tierChanged = false;
  if (input.visibility !== undefined) {
    const before = collection.visibility;
    collection = setCollectionAccess(collection, input.visibility, { now });
    tierChanged = collection.visibility !== before;
    // S44 — the root's slug lands in the same save as the tier change.
    if (tierChanged) collection = await withRootSlug(collection, deps);
  }
  // S32b — the gate lands in the same save as the tier change (atomic).
  if (input.linkGate !== undefined) {
    if (!deps.hasher) throw new Error("a link password hasher is required to set a gate");
    collection = await setCollectionLinkGate(
      collection,
      { requesterId: input.requesterId, ...input.linkGate, now },
      deps.hasher,
    );
  }
  await deps.collectionRepo.save(collection);

  if (tierChanged && collection.visibility !== "private") {
    await backfillSlugs(collection, input.scope, deps);
  }
  return collection;
}

// Mint a slug for every slugless artefact in the tree (collections.slug.minted-on-effective-share, hosting.slug.minted-on-root-share).
// Minting only sets the retained address (hosting.slug.minted-once-retained) — it changes no tier
// and bumps no timestamps.
// r[impl hosting.slug.minted-on-root-share]
async function backfillSlugs(
  root: Collection,
  scope: TenantScope,
  deps: EditCollectionDeps,
): Promise<void> {
  const all = await deps.collectionRepo.listByOwner(root.ownerId, scope, {
    includeArchived: true,
  });
  const subtreeIds = new Set(collectSubtree(all, root.id).map((c) => c.id));
  const artefacts = await deps.artefactRepo.listByCollectionIds(
    [...subtreeIds],
    scope,
    { includeArchived: true },
  );
  // Re-checked on the reloaded copy after a save conflict (S60), so a slug minted
  // meanwhile is retained, never replaced.
  const mint = (artefact: Artefact): Promise<Artefact> =>
    withEffectiveShareSlug(artefact, {
      repo: deps.artefactRepo,
      generateSlug: deps.generateSlug,
      maxSlugAttempts: deps.maxSlugAttempts,
    });
  for (const artefact of artefacts) {
    if (artefact.publicSlug) continue;
    await cascadeTo(deps.artefactRepo, artefact, scope, subtreeIds, mint);
  }
}

export interface ManageCollectionAccessInput {
  collectionId: string;
  requesterId: string;
  userId: string; // the user being granted / revoked
  scope: TenantScope;
}

// The `selected`-tier access list on a root (collections.access.root-governs-tree), mirroring the S16 artefact
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

// S32b — link protection on a public root. Load in the caller's scope (unknown
// or not theirs → not found, collections.access.no-existence-leak), then the pure transitions, which refuse a
// non-owner, an archived, nested or non-public collection, a bad password and
// a past expiry (`collections.link-gate.public-root-only`).
export interface SetCollectionLinkGateInput {
  collectionId: string;
  requesterId: string;
  scope: TenantScope;
  // undefined = keep; null = clear.
  password?: string | null;
  expiresAt?: Date | null;
}

export async function setCollectionLinkGateCommand(
  input: SetCollectionLinkGateInput,
  deps: CollectionCommandDeps & { hasher: LinkPasswordHasher },
): Promise<Collection> {
  const existing = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const updated = await setCollectionLinkGate(
    existing,
    {
      requesterId: input.requesterId,
      password: input.password,
      expiresAt: input.expiresAt,
      now: (deps.now ?? (() => new Date()))(),
    },
    deps.hasher,
  );
  await deps.collectionRepo.save(updated);
  return updated;
}

export async function clearCollectionLinkGateCommand(
  input: { collectionId: string; requesterId: string; scope: TenantScope },
  deps: CollectionCommandDeps,
): Promise<Collection> {
  const existing = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const updated = clearCollectionLinkGate(existing, {
    requesterId: input.requesterId,
    now: (deps.now ?? (() => new Date()))(),
  });
  await deps.collectionRepo.save(updated);
  return updated;
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
