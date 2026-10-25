import type { Context } from "hono";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import type { AuthEnv } from "./auth";

// S22 (hosting.tenant.invisible-to-oss) — how a request resolves to the tenant scope its artefact
// reads run under. This is the injection seam (mirrors the S24 adapter/auth injection): the
// composition root supplies a resolver, the shared route handlers call it, and a superset overrides
// *which* tenant a request sees **without editing core**.
//
// OSS wires `singletonScopeResolver` — every request maps to `DEFAULT_TENANT`, so
// the scope filter is a no-op and behaviour is byte-identical. A multi-tenant
// superset injects a resolver that reads the caller's **active org** from the
// session (ET2), which also drives the Postgres RLS `SET LOCAL app.tenant_id`
// backstop (EP2).
// r[impl platform.tenancy.scope-excludes-other-tenants+2]
export type TenantScopeResolver = (
  c: Context<AuthEnv>,
) => TenantScope | Promise<TenantScope>;

// The OSS / single-tenant resolver: every request is the one implicit tenant.
export const singletonScopeResolver: TenantScopeResolver = () => SINGLETON_SCOPE;
