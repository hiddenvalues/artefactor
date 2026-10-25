import type { Context } from "hono";
import type { OrganizationContext } from "../shared/contracts";
import type { AuthEnv } from "./middleware/auth";

// S53 — the organization context the account menu shows: which org is active
// and the caller's memberships, each with its role. An enabler seam beside
// `TenantScopeResolver` and `AccessPolicy`: the composition root injects a
// provider, and a superset supplies BetterAuth's memberships (ET7) without
// editing core. The domain still stores no org data (`identity.org.delegated`).
//
// The provider only reports and carries out: whether a switch is allowed is
// decided in core, by the `/api/me/active-organization` handler, which calls
// `activate` only for an id `get` listed.
export interface OrganizationContextProvider {
  // The signed-in caller's context, or `null` when there is none.
  get(c: Context<AuthEnv>): OrganizationContext | null | Promise<OrganizationContext | null>;
  // Makes `organizationId` the caller's active org. Core has already checked it.
  activate(c: Context<AuthEnv>, organizationId: string): void | Promise<void>;
}

// The OSS default: a single-team deployment has no organization context, so
// `/api/me` is unchanged and the switch route always answers 404.
// r[impl identity.org-context.oss-absent+2]
export const noOrganizationContext: OrganizationContextProvider = {
  get: () => null,
  activate: () => {
    throw new Error("noOrganizationContext has no organization to activate");
  },
};
