import type { Artefact } from "../../domain/artefact/artefact";
import { mintUniqueSlug, type MintSlugDeps } from "../artefacts/slug";

// An artefact whose effective visibility leaves `private` through its tree — moved into a shared
// tree (hosting.slug.minted-on-move-into-shared-tree), or its root changing to a shared tier
// (hosting.slug.minted-on-root-share) — gets its slug at that transition if it has none, so every
// effectively shared artefact is addressable. A slug it already has is retained
// (hosting.slug.minted-once-retained). Minting changes no tier and bumps no timestamps.
// r[impl collections.slug.minted-on-effective-share]
export async function withEffectiveShareSlug(
  artefact: Artefact,
  deps: MintSlugDeps,
): Promise<Artefact> {
  if (artefact.publicSlug) return artefact;
  return { ...artefact, publicSlug: await mintUniqueSlug(deps) };
}
