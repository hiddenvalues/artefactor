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
import {
  setArtefactLinkGate,
  type LinkPasswordHasher,
} from "../../domain/artefact/link-gate";
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
  // S32a (AH31) — link protection set atomically with the change to `public`;
  // refused with any other tier. Leaving `public` clears the gate (domain rule).
  linkGate?: { password?: string; expiresAt?: Date };
}

export interface SetArtefactVisibilityDeps {
  repo: ArtefactRepository;
  generateSlug?: () => string;
  now?: () => Date;
  // Max attempts to mint a non-colliding slug before giving up.
  maxSlugAttempts?: number;
  // S32a — hashes a link password given with the change to `public`.
  hasher?: LinkPasswordHasher;
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

  if (input.linkGate !== undefined && input.visibility !== "public") {
    throw new InvariantViolation("link protection can only be set on a public artefact"); // AH31
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
    if (input.linkGate !== undefined) {
      if (!deps.hasher) throw new Error("a link password hasher is required to set a gate");
      // Validated before anything is saved, so a bad gate shares nothing.
      updated = await setArtefactLinkGate(
        updated,
        { requesterId: input.requesterId, ...input.linkGate, now },
        deps.hasher,
      );
    }
  }

  await deps.repo.save(updated);
  return updated;
}
