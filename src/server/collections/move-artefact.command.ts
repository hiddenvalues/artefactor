import type { Artefact } from "../../domain/artefact/artefact";
import type { Collection } from "../../domain/collection/collection";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import {
  evictFromCollection,
  moveArtefactToCollection,
} from "../../domain/collection/move-artefact";
import { canContributeToTree } from "../../domain/collection/collection-access";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { loadOwnCollection } from "./get-own-collection";
import { mintUniqueSlug } from "../artefacts/slug";

// Application command for S25/S29 — add/move an artefact to a collection, or
// back to top level (collectionId = null). The mover must own the artefact; the
// target must be their own collection **or** a tree they contribute to
// (CL1/CL12). Moving into a tree whose root is shared mints the slug at the
// transition (CL6/AH21) so the artefact is addressable the moment it is
// effectively shared.
export interface MoveArtefactInput {
  artefactId: string;
  requesterId: string;
  collectionId: string | null;
  scope: TenantScope;
}

export interface MoveArtefactDeps {
  artefactRepo: ArtefactRepository;
  collectionRepo: CollectionRepository;
  generateSlug?: () => string;
  maxSlugAttempts?: number;
  now?: () => Date;
}

export async function moveArtefactCommand(
  input: MoveArtefactInput,
  deps: MoveArtefactDeps,
): Promise<Artefact> {
  const artefact = await loadOwnActiveArtefact(deps.artefactRepo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });

  let collection: Collection | null = null;
  let root: Collection | null = null;
  if (input.collectionId !== null) {
    collection = await deps.collectionRepo.findById(
      input.collectionId,
      input.scope,
    );
    root =
      collection && collection.parentId !== null
        ? await deps.collectionRepo.findById(collection.rootId, input.scope)
        : collection;
    // Missing, dangling-chain, and not-permitted are all one uniform
    // not-found, so a target's existence never leaks (CL10/AH8). Permitted =
    // the mover's own collection, or a tree they contribute to (CL12).
    if (
      !collection ||
      !root ||
      !(
        collection.ownerId === input.requesterId ||
        canContributeToTree(root, input.requesterId)
      )
    ) {
      throw new CollectionNotFound(input.collectionId);
    }
  }

  let moved = moveArtefactToCollection(artefact, collection, {
    now: (deps.now ?? (() => new Date()))(),
  });

  // Effective share transition → mint the retained address (CL6/AH21).
  if (root && root.visibility !== "private" && moved.publicSlug === null) {
    const slug = await mintUniqueSlug({
      repo: deps.artefactRepo,
      generateSlug: deps.generateSlug,
      maxSlugAttempts: deps.maxSlugAttempts,
    });
    moved = { ...moved, publicSlug: slug };
  }

  await deps.artefactRepo.save(moved);
  return moved;
}

// Eject an artefact from the requester's collection to top level (CL13). The
// one cross-aggregate write: the collection owner curates *membership* of their
// container — never the artefact itself, which falls back to its dormant own
// tier untouched. Works regardless of the artefact's status.
export interface EjectArtefactInput {
  collectionId: string;
  artefactId: string;
  requesterId: string;
  scope: TenantScope;
}

export async function ejectArtefactCommand(
  input: EjectArtefactInput,
  deps: { artefactRepo: ArtefactRepository; collectionRepo: CollectionRepository; now?: () => Date },
): Promise<Artefact> {
  // Collection-owner authority; unknown / non-owned → uniform 404 (CL10).
  const collection = await loadOwnCollection(deps.collectionRepo, {
    id: input.collectionId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const artefact = await deps.artefactRepo.findById(
    input.artefactId,
    input.scope,
  );
  // Direct containment only — an artefact elsewhere is not this collection's.
  if (!artefact || artefact.collectionId !== collection.id) {
    throw new ArtefactNotFound(input.artefactId);
  }
  const evicted = evictFromCollection(artefact, {
    now: (deps.now ?? (() => new Date()))(),
  });
  await deps.artefactRepo.save(evicted);
  return evicted;
}
