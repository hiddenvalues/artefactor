import { DEFAULT_TENANT } from "./artefact";

// S22 (hosting.tenant.invisible-to-oss) — the tenant boundary a repository read may cross. A
// scope-aware `ArtefactRepository` read never returns a row whose `tenantId` differs from the
// scope's, and subordinate data/view/version reads inherit it.
//
// OSS is single-tenant *by being one deployment*, so every query uses the
// `SINGLETON_SCOPE` and the filter is a no-op (all rows carry `DEFAULT_TENANT`)
// — behaviour is byte-identical. A multi-tenant superset resolves the scope from
// the caller's **active org** per request (ET2), which also maps 1:1 onto the
// Postgres RLS `SET LOCAL app.tenant_id` backstop (EP2). It is deliberately a
// *single* tenant, not a set: a user who belongs to many orgs operates within
// one active org per request, and switching orgs re-scopes every query.
//
// `findBySlug` is intentionally **not** scope-aware: a slug is a globally-unique
// capability (hosting.slug.globally-unique) — the cross-tenant address used by
// public/link serving and the mint-time uniqueness check — and the per-tier
// tenant decision for a slug-served artefact belongs to the `AccessPolicy` seam
// (S22 part B / ET3), not to the repository scope.
// r[impl hosting.tenant.scope-excludes-other-tenants+2]
export interface TenantScope {
  // The single tenant whose artefacts a scoped read may return. OSS: always
  // `DEFAULT_TENANT`.
  readonly tenantId: string;
}

// The OSS / single-tenant scope: every artefact shares `DEFAULT_TENANT`, so scoping by it returns
// the same rows as an unscoped query (hosting.tenant.invisible-to-oss parity).
export const SINGLETON_SCOPE: TenantScope = { tenantId: DEFAULT_TENANT };
