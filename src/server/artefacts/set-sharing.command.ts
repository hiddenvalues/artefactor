import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { DomainError } from "../../domain/artefact/errors";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";
import { applySharing, type SharingChange } from "../../domain/artefact/sharing";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { loadOwnArtefact } from "./get-own-artefact";
import { mutateArtefact } from "./mutate-artefact";
import { mintUniqueSlug } from "./slug";

// Application command for S55 — Manage access dialog: one draft, saved
// atomically. Loads the owned artefact (missing, not owned or out of scope →
// not found, hosting.authority.owner-only), checks every *added* member against
// the user directory (as `POST …/access` checks one), applies the whole change
// through the pure `applySharing`, and persists it with a single `save`.

// An added member the user directory doesn't know
// (hosting.access-list.owner-managed-set: registered users only).
export class UnknownMember extends DomainError {}

export interface SetSharingInput {
  artefactId: string;
  requesterId: string;
  scope: TenantScope;
  change: SharingChange;
}

export interface SetSharingDeps {
  repo: ArtefactRepository;
  hasher: LinkPasswordHasher;
  // The subset of the given ids that are registered users.
  knownUsers: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
  generateSlug?: () => string;
  maxSlugAttempts?: number;
  now?: () => Date;
}

// r[impl hosting.sharing.atomic-save]
export async function setSharingCommand(input: SetSharingInput, deps: SetSharingDeps): Promise<Artefact> {
  const now = (deps.now ?? (() => new Date()))();
  // Re-applied to the fresh aggregate on a save conflict (S60): the member check and
  // the slug decision both read the newest stored artefact.
  return mutateArtefact(deps.repo, {
    load: () =>
      loadOwnArtefact(deps.repo, {
        id: input.artefactId,
        ownerId: input.requesterId,
        scope: input.scope,
      }),
    apply: async (existing) => {
      const { members } = input.change;
      if (members !== undefined) {
        const added = [...new Set(members)].filter((id) => !existing.sharedWith.includes(id));
        if (added.length > 0) {
          const known = await deps.knownUsers(added);
          if (added.some((id) => !known.has(id))) throw new UnknownMember("unknown user");
        }
      }

      // A slug is minted only for a first share (hosting.slug.minted-once-retained);
      // a retained one is reused.
      const newSlug =
        input.change.visibility !== "private" && existing.publicSlug === null ? await mintUniqueSlug(deps) : undefined;

      // Every part is applied in memory first; any refusal throws before the write.
      return applySharing(existing, input.requesterId, input.change, {
        now,
        newSlug,
        hasher: deps.hasher,
      });
    },
  });
}
