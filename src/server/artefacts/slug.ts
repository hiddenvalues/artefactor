import { randomBytes } from "node:crypto";

// A short, random, URL-safe slug. Slug generation lives in the application layer
// (not the pure domain) so the domain stays free of node:crypto — mirroring how
// the create command supplies the artefact id. Uniqueness
// (hosting.slug.globally-unique) is enforced by the caller, which
// collision-checks against the repository at mint time.
// r[impl hosting.slug.random-token]
export function generateSlug(): string {
  // 8 random bytes → 11 url-safe base64 chars; ample space, no padding.
  return randomBytes(8).toString("base64url");
}

export interface MintSlugDeps {
  // The repository whose slugs must stay unique: the artefacts
  // (hosting.slug.globally-unique), or the collections (S44) — the two namespaces
  // are independent.
  repo: { findBySlug(slug: string): Promise<unknown> };
  generateSlug?: () => string;
  // Max attempts to mint a non-colliding slug before giving up.
  maxSlugAttempts?: number;
}

// Mint a fresh slug, collision-checked against the repository (hosting.slug.globally-unique).
// Shared by every path that first shares an artefact: set-visibility (hosting.slug.shared-has-slug)
// and the collections effective-share transitions (hosting.slug.minted-on-move-into-shared-tree,
// hosting.slug.minted-on-root-share, collections.slug.minted-on-effective-share), and by a root collection's first share (S44).
// r[impl hosting.slug.globally-unique]
export async function mintUniqueSlug(deps: MintSlugDeps): Promise<string> {
  const gen = deps.generateSlug ?? generateSlug;
  const attempts = deps.maxSlugAttempts ?? 5;
  for (let i = 0; i < attempts; i++) {
    const slug = gen();
    if ((await deps.repo.findBySlug(slug)) === null) return slug; // hosting.slug.globally-unique
  }
  throw new Error("could not mint a unique slug after several attempts");
}
