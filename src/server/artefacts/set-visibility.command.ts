import {
  assertTierEditable,
  shareArtefact,
  unshareArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import { InvariantViolation } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import {
  setArtefactLinkGate,
  type LinkPasswordHasher,
} from "../../domain/artefact/link-gate";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Visibility } from "../../domain/artefact/visibility";
import { mintUniqueSlug } from "./slug";
import { loadOwnArtefact } from "./get-own-artefact";
import { mutateArtefact } from "./mutate-artefact";

// Application command for S5 — Share / unshare. Unifies the three visibility
// transitions (share, change tier, unshare) behind one operation. Loads the
// artefact, enforces owner authority (hosting.authority.owner-only), mints a
// unique slug on first share (hosting.slug.shared-has-slug,
// hosting.slug.globally-unique), and delegates the state transition + remaining
// invariants (archived block, slug retention) to the pure domain functions.
export interface SetArtefactVisibilityInput {
  artefactId: string;
  requesterId: string; // the authenticated user making the request
  visibility: Visibility;
  scope: TenantScope; // the caller's tenant scope (S22, hosting.tenant.invisible-to-oss)
  // S32a (hosting.link-gate.public-only) — link protection set atomically with the change to
  // `public`; refused with any other tier. Leaving `public` clears the gate (domain rule).
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
  // A non-owner is told the same thing as for a missing artefact, so a private
  // artefact's existence cannot be probed (hosting.access.no-existence-leak,
  // hosting.authority.owner-only).
  const now = (deps.now ?? (() => new Date()))();
  // Re-applied to the fresh aggregate on a save conflict (S60), so the slug decision
  // below always sees the newest stored slug.
  return mutateArtefact(deps.repo, {
    load: () =>
      loadOwnArtefact(deps.repo, {
        id: input.artefactId,
        ownerId: input.requesterId,
        scope: input.scope,
      }),
    apply: async (existing) => {
      // A contained artefact's own tier is dormant and not editable.
      assertTierEditable(existing);
      // A gate is set only with the change to `public` (hosting.link-gate.public-only).
      if (input.linkGate !== undefined && input.visibility !== "public") {
        throw new InvariantViolation("link protection can only be set on a public artefact");
      }
      if (input.visibility === "private") return unshareArtefact(existing, { now });

      // Mint a fresh unique slug only when the artefact has none yet; otherwise
      // the retained slug is reused (handled inside shareArtefact).
      const newSlug = existing.publicSlug
        ? undefined
        : await mintUniqueSlug(deps);
      const shared = shareArtefact(existing, { tier: input.visibility, newSlug, now });
      if (input.linkGate === undefined) return shared;
      if (!deps.hasher) throw new Error("a link password hasher is required to set a gate");
      // Validated before anything is saved, so a bad gate shares nothing.
      return setArtefactLinkGate(
        shared,
        { requesterId: input.requesterId, ...input.linkGate, now },
        deps.hasher,
      );
    },
  });
}
