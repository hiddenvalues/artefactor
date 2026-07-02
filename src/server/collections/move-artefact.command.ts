import type { Artefact } from "../../domain/artefact/artefact";
import type { Collection } from "../../domain/collection/collection";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { moveArtefactToCollection } from "../../domain/collection/move-artefact";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { loadOwnCollection } from "./get-own-collection";
import { mintUniqueSlug } from "../artefacts/slug";

// Application command for S25 — add/move an artefact to a collection, or back
// to top level (collectionId = null). Owner-only on both sides (CL1/CL9);
// moving into a tree whose root is shared mints the slug at the transition
// (CL6/AH21) so the artefact is addressable the moment it is effectively shared.
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
    collection = await loadOwnCollection(deps.collectionRepo, {
      id: input.collectionId,
      ownerId: input.requesterId,
      scope: input.scope,
    });
    root =
      collection.parentId === null
        ? collection
        : await deps.collectionRepo.findById(collection.rootId, input.scope);
    if (!root) {
      // A dangling chain never happens under the FK, but fail closed (CL10).
      throw new ArtefactNotFound(input.artefactId);
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
