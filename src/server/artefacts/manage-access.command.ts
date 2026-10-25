import type { Artefact } from "../../domain/artefact/artefact";
import { grantAccess, revokeAccess } from "../../domain/artefact/access-list";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { loadOwnArtefact } from "./get-own-artefact";
import { mutateArtefact } from "./mutate-artefact";

// Application commands for S16 — manage the `selected`-tier access list. The
// owner adds/removes individual members; access is consulted only while the
// artefact's visibility is `selected` (hosting.access-list.retained). Loads the
// artefact, treats a non-owner (or unknown id) as not-found so a private
// artefact's existence can't be probed (hosting.authority.owner-only), delegates
// the set transition + archived guard to the pure domain functions, and persists
// (the repo syncs the join table).
export interface ManageAccessInput {
  artefactId: string;
  requesterId: string; // the authenticated user making the request
  userId: string; // the user being granted / revoked
  scope: TenantScope; // the caller's tenant scope (S22, hosting.tenant.invisible-to-oss)
}

export interface ManageAccessDeps {
  repo: ArtefactRepository;
  now?: () => Date;
}

async function loadOwned(
  input: ManageAccessInput,
  deps: ManageAccessDeps,
): Promise<Artefact> {
  return loadOwnArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
}

export async function grantAccessCommand(
  input: ManageAccessInput,
  deps: ManageAccessDeps,
): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  return mutateArtefact(deps.repo, {
    load: () => loadOwned(input, deps),
    apply: (existing) => grantAccess(existing, input.userId, now),
  });
}

export async function revokeAccessCommand(
  input: ManageAccessInput,
  deps: ManageAccessDeps,
): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  return mutateArtefact(deps.repo, {
    load: () => loadOwned(input, deps),
    apply: (existing) => revokeAccess(existing, input.userId, now),
  });
}

// Read the current member ids for the owner's artefact (powers the manage-access
// panel). Non-owner / unknown → not-found, like the mutating commands.
export async function listAccessMembers(
  input: { artefactId: string; requesterId: string; scope: TenantScope },
  deps: ManageAccessDeps,
): Promise<string[]> {
  const existing = await loadOwned(
    { ...input, userId: "" },
    deps,
  );
  return [...existing.sharedWith];
}
