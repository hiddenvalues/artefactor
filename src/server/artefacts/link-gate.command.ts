import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import {
  clearArtefactLinkGate,
  setArtefactLinkGate,
  type LinkPasswordHasher,
} from "../../domain/artefact/link-gate";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { mutateArtefact } from "./mutate-artefact";

// Application commands for S32a — Link controls on public artefacts: password + expiry. Load the
// artefact in the caller's tenant scope (missing or out of scope → not found,
// hosting.access.no-existence-leak), then delegate to the pure hosting.link-gate.public-only
// transitions, which refuse a non-owner (as not found), an archived, contained or non-public
// artefact, a bad password and a past expiry.

export interface LinkGateDeps {
  repo: ArtefactRepository;
  hasher: LinkPasswordHasher;
  now?: () => Date;
}

export interface SetLinkGateInput {
  artefactId: string;
  requesterId: string;
  scope: TenantScope;
  // undefined = keep; null = clear.
  password?: string | null;
  expiresAt?: Date | null;
}

async function load(repo: ArtefactRepository, id: string, scope: TenantScope): Promise<Artefact> {
  const found = await repo.findById(id, scope);
  if (!found) throw new ArtefactNotFound(id);
  return found;
}

export async function setLinkGateCommand(
  input: SetLinkGateInput,
  deps: LinkGateDeps,
): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  return mutateArtefact(deps.repo, {
    load: () => load(deps.repo, input.artefactId, input.scope),
    apply: (existing) =>
      setArtefactLinkGate(
        existing,
        { requesterId: input.requesterId, password: input.password, expiresAt: input.expiresAt, now },
        deps.hasher,
      ),
  });
}

export async function clearLinkGateCommand(
  input: { artefactId: string; requesterId: string; scope: TenantScope },
  deps: Omit<LinkGateDeps, "hasher">,
): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  return mutateArtefact(deps.repo, {
    load: () => load(deps.repo, input.artefactId, input.scope),
    apply: (existing) => clearArtefactLinkGate(existing, { requesterId: input.requesterId, now }),
  });
}
