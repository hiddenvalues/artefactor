import {
  shareArtefact,
  unshareArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import {
  ArtefactNotFound,
  InvariantViolation,
} from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Visibility } from "../../domain/artefact/visibility";
import { mintUniqueSlug } from "./slug";

// Application command for S5 — Share / unshare. Unifies the three visibility
// transitions (share, change tier, unshare) behind one operation. Loads the
// artefact, enforces owner authority (AH9), mints a unique slug on first share
// (AH4/6), and delegates the state transition + remaining invariants (archived
// block, slug retention) to the pure domain functions.
export interface SetArtefactVisibilityInput {
  artefactId: string;
  requesterId: string; // the authenticated user making the request
  visibility: Visibility;
  scope: TenantScope; // the caller's tenant scope (S22/AH17)
}

export interface SetArtefactVisibilityDeps {
  repo: ArtefactRepository;
  generateSlug?: () => string;
  now?: () => Date;
  // Max attempts to mint a non-colliding slug before giving up.
  maxSlugAttempts?: number;
}

export async function setArtefactVisibilityCommand(
  input: SetArtefactVisibilityInput,
  deps: SetArtefactVisibilityDeps,
): Promise<Artefact> {
  const existing = await deps.repo.findById(input.artefactId, input.scope);
  // A non-owner is told the same thing as for a missing artefact, so a private
  // artefact's existence cannot be probed (AH8/AH9).
  if (!existing || existing.ownerId !== input.requesterId) {
    throw new ArtefactNotFound(input.artefactId);
  }
  // AH20/CL5 — a contained artefact's own tier is dormant and not editable;
  // access is changed on the collection (or the artefact moved out first).
  if (existing.collectionId !== null) {
    throw new InvariantViolation(
      "visibility is inherited from the collection — change it there, or move the artefact to top level",
    );
  }

  const now = (deps.now ?? (() => new Date()))();
  let updated: Artefact;

  if (input.visibility === "private") {
    updated = unshareArtefact(existing, { now });
  } else {
    // Mint a fresh unique slug only when the artefact has none yet; otherwise
    // the retained slug is reused (handled inside shareArtefact).
    const newSlug = existing.publicSlug
      ? undefined
      : await mintUniqueSlug(deps);
    updated = shareArtefact(existing, { tier: input.visibility, newSlug, now });
  }

  await deps.repo.save(updated);
  return updated;
}
