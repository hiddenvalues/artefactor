import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import type { Artefact } from "../../domain/artefact/artefact";
import {
  authorizeArtefactRead,
  type ArtefactReadVerdict,
} from "../../domain/artefact/link-gate";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveEffectiveViewable } from "../collections/effective";
import { NO_PASSES, type PassLookup } from "./passes";

export interface AuthorizeReadDeps {
  collectionRepo: CollectionRepository;
  accessPolicy?: AccessPolicy;
}

export interface AuthorizeReadOptions {
  passes?: PassLookup;
  now?: Date;
}

// S32a (AH22–AH24) — one read authorization for every server path: resolve the
// effective access (AH20), then the matrix under the policy (AH18), then the
// link gate for the public cell's extra audience only.
export async function authorizeRead(
  deps: AuthorizeReadDeps,
  artefact: Artefact,
  viewerId: string | null,
  options: AuthorizeReadOptions = {},
): Promise<ArtefactReadVerdict> {
  return authorizeArtefactRead(
    {
      artefact,
      effective: await resolveEffectiveViewable(artefact, deps.collectionRepo),
      viewerId,
      pass: (options.passes ?? NO_PASSES)(artefact.id),
      now: options.now ?? new Date(),
    },
    deps.accessPolicy ?? defaultAccessPolicy,
  );
}
