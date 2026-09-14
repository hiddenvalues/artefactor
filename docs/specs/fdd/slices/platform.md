# Platform & enabler seams

### S0 — Scaffold
- **Status:** done
- **Depends on:** —

*Prerequisite, not a domain slice.*

Monolith builds and runs: Hono serves the Svelte app; Drizzle connected to SQLite with
migrations; Tailwind + shadcn-svelte wired; pure `domain/` layer + Vitest harness; Docker
image builds and runs locally. **Full detail: [`s0-scaffold.md`](../s0-scaffold.md).**

### S22 — Tenant scope + access-policy seam
- **Status:** done
- **Depends on:** S6, S10, S14

*Enabler; behaviour-preserving.*

Two thin core seams that let a superset be **multi-tenant**, byte-identical in OSS. (DDD amendments:
`ddd/artefact-hosting.md` AH17/AH18, `ddd/identity-access.md` IA5. EE context:
`ee/docs/specs/ddd/tenancy.md`.)
> **Progress:** **done — A1 + A2 + B + C.** A1 — `Artefact.tenantId` + the `tenant_id` column (both schemas,
> migration `0006`) default to `DEFAULT_TENANT` and are stamped at create. A2 — `findById`,
> `listByOwner`, and `listShared` are now **scope-aware** (take a `TenantScope`,
> `domain/artefact/tenant-scope.ts`); `findBySlug` stays **tenant-global** because a slug is a
> globally-unique capability (AH6) and the per-tier tenant check for a slug-served artefact is the
> `AccessPolicy`'s job (part B). The scope is resolved per request by an injected
> `TenantScopeResolver` (OSS default `singletonScopeResolver` → `DEFAULT_TENANT`, byte-identical;
> threaded through `createApp`/`createApiRoutes` + the artefact/data/view route factories + the MCP
> `createMcpRoutes`). A `TenantScope` is a **single** tenant (the active org), not an org-set: a
> multi-org user works within one active org per request, which also maps 1:1 onto the EP2 RLS
> `SET LOCAL app.tenant_id`. Behaviour-preserving — all existing tests stay green; new in-memory
> tests prove a stub multi-tenant scope excludes other-tenant rows and that `findBySlug` stays
> cross-tenant. B — the **`AccessPolicy` port** (`domain/artefact/access.ts`): `ViewableArtefact`
> carries `tenantId`, and the matrix is factored so its **one policy-decided cell** — a signed-in
> non-owner asking for the `authenticated` tier — delegates to
> `grantsAuthenticatedTier(viewerId, tenantId)` (`canViewArtefactUnder`; the sync `canViewArtefact`
> stays the OSS default form). AH7/AH8/AH9 are fixed **by construction**: the policy is never asked
> about the anonymous, the owner's own view, other tiers, or archived. Injected through
> `createApp`/`createApiRoutes` (default `defaultAccessPolicy`, byte-identical) into the paths where
> the **slug capability crosses tenants**: serving (`/a/:slug` shell + frame) and the slug-resolved
> data/viewers reads. Deliberately **not** threaded into id-addressed reads (bookmarks, dashboards)
> or `canViewCollection`: those resolve via the tenant-scoped repo (T2), and within a scope the
> viewer is a co-member by construction (collections additionally have no slugs and are signed-in
> only), so a policy there could never decide differently. C — the sign-up allowlist accepts the
> `"*"` allow-all sentinel (IA5). Route-level tests (`server/access-policy.test.ts`) prove a stub
> co-member policy grants a member, denies a signed-in non-member with a flat 404 (AH8), keeps the
> anonymous redirect uniform, never denies the owner, and leaves `public` untouched.
- **Scope.** `Artefact` gains `tenantId` (immutable; migration defaults existing + new rows to
  `DEFAULT_TENANT`). `ArtefactRepository` list/find take a **`TenantScope`**; OSS wires the singleton
  scope, so listing/serving is unchanged. Subordinate reads (data, views, versions) inherit the
  scope. *(AH17)*
- **Access policy.** Extract the access-matrix decision into an **`AccessPolicy`** port; OSS wires
  the default = the current matrix. Only the `authenticated` tier is overridable; AH8/AH9 are fixed.
  *(AH18)*
- **Identity.** The sign-up allowlist predicate gains an **allow-all** config option (OSS keeps its
  configured domains). *(IA5)*
- **Acceptance:** under the OSS defaults, every existing access/listing/serving test passes
  unchanged (one tenant; `authenticated` = any signed-in user; allowlist as configured); a stub
  multi-tenant scope makes `listByOwner`/`listShared`/serve exclude other-tenant rows; a stub access
  policy that scopes `authenticated` to a tenant denies a signed-in non-member with a flat 404 (AH8
  holds).
- **Boundary:** **OSS** (the scope + policy must live in the repo/serving/access path). The org
  model, the real scope, and the org-aware policy are the **EE Tenancy/Organizations** context.

### S23 — EE enforcement policy seams (quota / payload-size / branding)
- **Status:** specced
- **Depends on:** S2, S3, S12

*Enabler; behaviour-preserving.*

The core seams the **EE Usage & Quota** context plugs into — all **no-op in OSS**. (DDD:
`ee/docs/specs/ddd/usage-quota.md`; size-cap amendment `ddd/artefact-hosting.md` AH19.)
- **QuotaPolicy.** A `QuotaPolicy` port consulted at `createArtefactCommand` (+ payload-replacing
  edit for the storage fence). OSS default = **allow / unlimited**. *(usage-quota Q1)*
- **Payload-size policy.** Extract `MAX_PAYLOAD_BYTES` into a policy; **OSS default keeps 100 MB**.
  EE drives it from the *Large Artefacts* entitlement (10 MB / 100 MB). *(AH19)*
- **BrandingPolicy.** A `BrandingPolicy` consulted by the host shell on **public** serves; **OSS
  default = no badge**. EE shows the Artefactor badge unless *Remove branding* is held.
- **Acceptance:** under the OSS defaults, creates are unlimited, the size cap is 100 MB, and no badge
  renders — byte-identical; a stub deny-quota makes `create` return `402`; a stub 10 MB size policy
  rejects an 11 MB payload; a stub branding policy renders the badge on a public serve.
- **Boundary:** **OSS** (the seams sit at the create/edit commands and the S12 shell). The metering,
  plan-aware policy, entitlements, and soft fences are the **EE Usage & Quota** context (EQ1–EQ5).

### S24 — Inject persistence ports into the composition
- **Status:** done
- **Depends on:** S2, S11, S12, S21

*Enabler; behaviour-preserving.*

Make the BFF composition accept the domain-port adapters as **injected dependencies**, so a
superset can wire a different backend (Postgres) without forking the composition. (EE context:
`ee/docs/specs/ddd/postgres-persistence.md`.)
- Today `src/server/adapters.ts` builds the SQLite/filesystem adapters as module singletons and
  `createApiRoutes()` imports them directly. Refactor `createApiRoutes()` and the `/api` route
  modules to **take the adapter set** (`{ artefactRepository, dataRepository, viewRepository,
  payloadStore, userDirectory }`) as a parameter; `createApp()` threads it. `adapters.ts` remains
  the **OSS default set** (SQLite + filesystem), passed by the OSS entry. (The serve + MCP route
  factories already take injected deps.)
- **The BetterAuth instance is injected the same way** — `createApp(adapters, auth)` (OSS default =
  the SQLite-backed `auth`); `attachSession` becomes a factory `createAttachSession(auth)`. This is
  required because `artefact.ownerId` and the data/view rows FK to BetterAuth's `user` table and the
  `UserDirectory` reads it, so a superset's Postgres app must back **auth and the domain by the same
  database** — a SQLite/Postgres split would FK-fail. Behaviour-identical for OSS.
- **Acceptance:** every existing route/serving/MCP test passes unchanged under the default
  (SQLite) wiring + default `auth`; a test injecting in-memory/fake adapters into `createApp`
  exercises the full `/a` serve surface **without** touching `adapters.ts`/`client.ts`; no route
  module imports the adapter or auth singleton directly anymore.
- **Boundary:** **OSS** (the composition lives in core). The Postgres adapter set, pg schema, RLS,
  and the EE entry that injects them are the EE **Postgres persistence** context. Behaviour-
  preserving; also a testability win for OSS.
