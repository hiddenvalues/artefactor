import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactConflict } from "../../domain/artefact/errors";

// S60 — Save concurrency: a save never overwrites a newer artefact. A command saves through this
// helper so a lost race re-applies its intent, never its stale snapshot: on `ArtefactConflict` it
// reloads and re-runs `apply` — the command's own domain function, which re-checks every invariant
// on the fresh copy — at most `MAX_ATTEMPTS` times in all. Errors from `load` and `apply` propagate
// at once, so a racing archive or revoke wins.
export const MAX_ATTEMPTS = 3;

export interface Mutation {
  load: () => Promise<Artefact>;
  // Returning the loaded object itself means "nothing to change": no save.
  apply: (artefact: Artefact) => Artefact | Promise<Artefact>;
}

// A `load` for a command that already holds the aggregate it read first: the first attempt uses
// it, every retry reloads.
export function loadedThenReload(
  first: Artefact,
  reload: () => Promise<Artefact>,
): () => Promise<Artefact> {
  let held: Artefact | null = first;
  return async () => {
    const next = held;
    held = null;
    return next ?? reload();
  };
}

// r[impl hosting.save.reapply-on-conflict]
export async function mutateArtefact(
  repo: ArtefactRepository,
  { load, apply }: Mutation,
): Promise<Artefact> {
  for (let attempt = 1; ; attempt++) {
    const loaded = await load();
    const updated = await apply(loaded);
    if (updated === loaded) return loaded;
    try {
      return await repo.save(updated);
    } catch (err) {
      if (!(err instanceof ArtefactConflict) || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}
