import { defaultAccessPolicy, type AccessPolicy } from "../../domain/artefact/access";
import type { Artefact } from "../../domain/artefact/artefact";
import type { Visibility } from "../../domain/artefact/visibility";
import {
  authorizeArtefactRead,
  type ArtefactReadVerdict,
} from "../../domain/artefact/link-gate";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Collection } from "../../domain/collection/collection";
import { authorizeCollectionRead } from "../../domain/collection/collection-access";
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
  // The effective tier the read was decided on (hosting.access.effective-from-tree-root).
  tier: Visibility;
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
  return { verdict, linkGate, tier: viewable.visibility };
}

// A policy that asks `policy` each (viewer, tenant) question once, for a listing that runs the read
// decision over many candidates of one scope — each would otherwise ask the same question again
// (a membership query per call in a multi-tenant superset). The promise is cached, so concurrent
// asks share it. Built per call and never kept, so a membership change is seen on the next request.
// Wrapping an already memoized policy returns it as is, so a listing composed of others shares one
// cache.
const memoized = new WeakSet<AccessPolicy>();
export function memoizedPolicy(policy: AccessPolicy): AccessPolicy {
  if (memoized.has(policy)) return policy;
  const answers = new Map<string, Promise<boolean>>();
  const wrapped: AccessPolicy = {
    grantsAuthenticatedTier(viewerId, tenantId) {
      const key = JSON.stringify([viewerId, tenantId]);
      let answer = answers.get(key);
      if (!answer) {
        answer = Promise.resolve(policy.grantsAuthenticatedTier(viewerId, tenantId));
        answers.set(key, answer);
      }
      return answer;
    },
  };
  memoized.add(wrapped);
  return wrapped;
}

// The collection twin of `decideRead` (collections.read.follows-root): resolve the tree root by
// its immutable `rootId` in the scope, then the one read decision with the root standing in for the
// artefact. The root holds the tree's gate (S32b), so the pass looked up is the root's. A root
// that does not resolve fails closed (collections.access.unresolvable-chain-fails-closed).
export async function decideCollectionRead(
  deps: AuthorizeReadDeps,
  collection: Collection,
  viewerId: string | null,
  options: AuthorizeReadOptions & { scope: TenantScope },
): Promise<{ granted: boolean; root: Collection | null }> {
  const root =
    collection.parentId === null
      ? collection
      : await deps.collectionRepo.findById(collection.rootId, options.scope);
  if (!root) return { granted: false, root: null };
  const granted = await authorizeCollectionRead(
    {
      root,
      viewerId,
      pass: (options.passes ?? NO_PASSES)(root.id),
      now: options.now ?? new Date(),
    },
    deps.accessPolicy ?? defaultAccessPolicy,
  );
  return { granted, root };
}

export async function authorizeRead(
  deps: AuthorizeReadDeps,
  artefact: Artefact,
  viewerId: string | null,
  options: AuthorizeReadOptions = {},
): Promise<ArtefactReadVerdict> {
  return (await decideRead(deps, artefact, viewerId, options)).verdict;
}
