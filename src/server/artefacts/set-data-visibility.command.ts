import { setDataVisibility, type Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { DataVisibility } from "../../domain/artefact/visibility";
import { loadOwnArtefact } from "./get-own-artefact";

// Application command for S41 — Owner-set data visibility: shared or own-only.
// Loads the artefact in the caller's tenant scope (missing, not owned or out of
// scope → not found, AH8), then delegates to the pure transition, which refuses
// an archived artefact (AH7). Per artefact: allowed while contained (AH30).
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
  const existing = await loadOwnArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });
  const updated = setDataVisibility(existing, input.requesterId, input.dataVisibility, {
    now: (deps.now ?? (() => new Date()))(),
  });
  if (updated !== existing) await deps.repo.save(updated);
  return updated;
}
