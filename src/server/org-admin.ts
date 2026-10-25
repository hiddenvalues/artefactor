import type { Context } from "hono";
import type { OrgInvitation, OrgMember } from "../shared/contracts";
import type { AuthEnv } from "./middleware/auth";

// S58 — the organization administration the Organization settings screen
// drives: an org's name, members, pending invitations and invite domains, and
// renaming, inviting and revoking. An enabler seam beside the organization
// context (`OrganizationContextProvider`): the composition root injects it, and
// a superset supplies BetterAuth's organization plugin (ET4) without editing
// core. The domain still stores no org data (`identity.org.delegated`).
//
// The provider only reports and carries out. Which org, who may administer it
// and which addresses may be invited are decided in core, by the
// `/api/organization` routes, which pass the org id they resolved from the org
// context — never one from the request — and call a change only once allowed.
export interface OrganizationAdministration {
  read(c: Context<AuthEnv>, orgId: string): OrganizationRecord | Promise<OrganizationRecord>;
  rename(c: Context<AuthEnv>, orgId: string, name: string): void | Promise<void>;
  // Records the invitation and notifies the invitee; what it grants is the superset's.
  invite(c: Context<AuthEnv>, orgId: string, email: string): void | Promise<void>;
  // `false`: no such pending invitation in this org.
  revoke(c: Context<AuthEnv>, orgId: string, invitationId: string): boolean | Promise<boolean>;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  // In the order they joined, earliest first.
  members: OrgMember[];
  // Pending only.
  invitations: OrgInvitation[];
  // The domains an address may be invited from; empty = none.
  inviteDomains: string[];
}

const absent = (): never => {
  throw new Error("noOrganizationAdministration has no organization");
};

// The OSS default: a single-team deployment has no organization, so every
// organization route answers 404 before reaching it (the routes' `activeOrg`).
export const noOrganizationAdministration: OrganizationAdministration = {
  read: absent,
  rename: absent,
  invite: absent,
  revoke: absent,
};
