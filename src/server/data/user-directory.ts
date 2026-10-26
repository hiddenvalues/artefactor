// A BFF-level lookup from BetterAuth user id → display identity, used to enrich
// the S12 data-context switcher so the host picker shows names/emails instead of
// raw author ids. This is deliberately a *host* concern: the Artefact Data
// context stores only opaque author ids (AD), and the BFF composes them with the
// Identity context for presentation. The Drizzle implementation lives in
// `infra/db/user-directory.drizzle.ts`.
import type { TenantScope } from "../../domain/artefact/tenant-scope";

export interface UserIdentity {
  name: string;
  email: string;
}

// A directory user with their id — what the S16 member picker needs.
export interface DirectoryUser extends UserIdentity {
  id: string;
}

export interface UserSearchOptions {
  // Exclude this user id from the results (the caller never shares with self). A
  // multi-tenant adapter also reads it as the caller who owns the grants it searches.
  excludeId?: string;
  // Cap the number of hits (defaults to a small page size in the adapter).
  limit?: number;
}

export interface UserDirectory {
  // Resolve the given user ids; unknown ids are simply absent from the map.
  lookup(ids: string[]): Promise<Map<string, UserIdentity>>;
  // Search registered users by name or email (substring, case-insensitive) for
  // the S16 add-member picker, within the caller's tenant scope. Empty/blank query
  // returns no results.
  // r[impl hosting.access-list.members-from-directory]
  search(
    query: string,
    scope: TenantScope,
    options?: UserSearchOptions,
  ): Promise<DirectoryUser[]>;
}
