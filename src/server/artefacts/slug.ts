import { randomBytes } from "node:crypto";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";

// A short, random, URL-safe slug. Slug generation lives in the application layer
// (not the pure domain) so the domain stays free of node:crypto — mirroring how
// the create command supplies the artefact id. Uniqueness (AH6) is enforced by
// the caller, which collision-checks against the repository at mint time.
export function generateSlug(): string {
  // 8 random bytes → 11 url-safe base64 chars; ample space, no padding.
  return randomBytes(8).toString("base64url");
}

export interface MintSlugDeps {
  repo: Pick<ArtefactRepository, "findBySlug">;
  generateSlug?: () => string;
  // Max attempts to mint a non-colliding slug before giving up.
  maxSlugAttempts?: number;
}

// Mint a fresh slug, collision-checked against the repository (AH6). Shared by
// every path that first shares an artefact: set-visibility (AH4) and the
// collections effective-share transitions (AH21/CL6).
export async function mintUniqueSlug(deps: MintSlugDeps): Promise<string> {
  const gen = deps.generateSlug ?? generateSlug;
  const attempts = deps.maxSlugAttempts ?? 5;
  for (let i = 0; i < attempts; i++) {
    const slug = gen();
    if ((await deps.repo.findBySlug(slug)) === null) return slug; // AH6
  }
  throw new Error("could not mint a unique slug after several attempts");
}
