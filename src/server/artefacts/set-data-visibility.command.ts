import { setDataVisibility, type Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { DataVisibility } from "../../domain/artefact/visibility";
import { loadOwnArtefact } from "./get-own-artefact";
import { mutateArtefact } from "./mutate-artefact";

// Application command for S41 — Owner-set data visibility: shared or own-only.
// Loads the artefact in the caller's tenant scope (missing, not owned or out of
// scope → not found, hosting.access.no-existence-leak), then delegates to the
// pure transition, which refuses an archived artefact
// (hosting.lifecycle.archived-frozen). Per artefact: allowed while contained
// (hosting.data-visibility.owner-set).
export interface SetDataVisibilityInput {
  artefactId: string;
  requesterId: string;
  dataVisibility: DataVisibility;
  scope: TenantScope;
}

export async function setDataVisibilityCommand(
  input: SetDataVisibilityInput,
  deps: { repo: ArtefactRepository; now?: () => Date },
): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  // An unchanged setting comes back as the same object, so nothing is saved (S60).
  return mutateArtefact(deps.repo, {
    load: () =>
      loadOwnArtefact(deps.repo, {
        id: input.artefactId,
        ownerId: input.requesterId,
        scope: input.scope,
      }),
    apply: (existing) =>
      setDataVisibility(existing, input.requesterId, input.dataVisibility, { now }),
  });
}
