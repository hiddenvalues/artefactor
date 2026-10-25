import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { mutateArtefact } from "../artefacts/mutate-artefact";

// S60 (hosting.save.reapply-on-conflict) — a collection-wide command saves each artefact it
// cascades to through `mutateArtefact`: every attempt loads it by id and decides on that copy, and
// a save conflict reloads and re-decides. Never the listed copy itself: `listByCollectionIds`
// carries no access list (`sharedWith` is empty), and saving it would delete every grant the
// artefact holds (S16). An artefact deleted meanwhile, or moved out of the
// subtree, is left alone. `change` returns its argument for "nothing to do". Returns whether a
// change was saved.
export async function cascadeTo(
  repo: ArtefactRepository,
  listed: Artefact,
  scope: TenantScope,
  subtreeIds: ReadonlySet<string>,
  change: (a: Artefact) => Artefact | Promise<Artefact>,
): Promise<boolean> {
  let changed = false;
  try {
    await mutateArtefact(repo, {
      load: async () => {
        const fresh = await repo.findById(listed.id, scope);
        if (!fresh) throw new ArtefactNotFound(listed.id);
        return fresh;
      },
      apply: async (a) => {
        const inSubtree = a.collectionId !== null && subtreeIds.has(a.collectionId);
        const next = inSubtree ? await change(a) : a;
        changed = next !== a;
        return next;
      },
    });
  } catch (err) {
    if (err instanceof ArtefactNotFound) return false;
    throw err;
  }
  return changed;
}
