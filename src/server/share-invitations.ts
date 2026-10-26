import type { Context } from "hono";
import type { InviteResult, ShareInvitation } from "../shared/contracts";
import type { AuthEnv } from "./middleware/auth";

// S33b — the share invitations the access dialog sends: an owner invites an
// email with no Account yet to an artefact. An enabler seam like S58's
// `OrganizationAdministration`: the composition root injects it, and a superset
// supplies the invitation aggregate and its mail (EI2) without editing core.
//
// The port only records and carries out. Which artefact, whose, and which
// address are decided in core, by the `/api/artefacts/:id/invitations` routes,
// which call it only once allowed, with the email normalized.
export interface ShareInvitations {
  // Records a pending invitation and mails it, or grants an existing Account at once.
  invite(c: Context<AuthEnv>, artefactId: string, email: string): InviteResult | Promise<InviteResult>;
  // Pending only, oldest first.
  list(c: Context<AuthEnv>, artefactId: string): ShareInvitation[] | Promise<ShareInvitation[]>;
  // `false`: no such pending invitation on this artefact.
  revoke(c: Context<AuthEnv>, artefactId: string, invitationId: string): boolean | Promise<boolean>;
}

// The OSS default: no mail, so no invitations, and every invitation route
// answers 404.
export const noShareInvitations: ShareInvitations | null = null;
