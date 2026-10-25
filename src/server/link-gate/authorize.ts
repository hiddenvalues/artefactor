import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import type { Artefact } from "../../domain/artefact/artefact";
import {
  authorizeArtefactRead,
  type ArtefactReadVerdict,
} from "../../domain/artefact/link-gate";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { EffectiveLinkGate } from "../../domain/collection/effective-access";
import { resolveEffectiveRead } from "../collections/effective";
import { NO_PASSES, type PassLookup } from "./passes";

export interface AuthorizeReadDeps {
  collectionRepo: CollectionRepository;
  accessPolicy?: AccessPolicy;
}

export interface AuthorizeReadOptions {
  passes?: PassLookup;
  now?: Date;
}

export interface ReadDecision {
  verdict: ArtefactReadVerdict;
  // The gate the read was decided under and its holder (S32b): the artefact's
  // own at top level, its tree root's when contained. A pass is issued, looked
  // up and carried in a frame token for this holder; unlock verifies against
  // this gate.
  linkGate: EffectiveLinkGate;
}

// S32a (the hosting.link-gate.* requirements) — one read authorization for every server path:
// resolve the effective access (hosting.access.effective-from-tree-root), then the matrix under the
// policy (hosting.access.policy-decided), then the link gate for the public cell's extra audience
// only. S32b: the gate, and the holder whose pass counts, are the effective ones — a contained
// artefact's tree root's.
export async function decideRead(
  deps: AuthorizeReadDeps,
  artefact: Artefact,
  viewerId: string | null,
  options: AuthorizeReadOptions = {},
): Promise<ReadDecision> {
  const { viewable, linkGate } = await resolveEffectiveRead(artefact, deps.collectionRepo);
  const verdict = await authorizeArtefactRead(
    {
      artefact,
      effective: viewable,
      gate: linkGate.gate,
      viewerId,
      pass: (options.passes ?? NO_PASSES)(linkGate.holderId),
      now: options.now ?? new Date(),
    },
    deps.accessPolicy ?? defaultAccessPolicy,
  );
  return { verdict, linkGate };
}

export async function authorizeRead(
  deps: AuthorizeReadDeps,
  artefact: Artefact,
  viewerId: string | null,
  options: AuthorizeReadOptions = {},
): Promise<ArtefactReadVerdict> {
  return (await decideRead(deps, artefact, viewerId, options)).verdict;
}
