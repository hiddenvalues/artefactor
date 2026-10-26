// Identity & Access — whether an address may be invited to an organization
// (S58, `identity.org-admin.invite-domain`). A pure check over what the
// superset's provider reports: core decides it, and the provider's `invite` is
// called only for an address admitted here. Framework-free, beside the sign-up
// allowlist whose domain parsing it reuses.

import { emailDomain } from "./email-domain";
import { wellFormedEmail } from "../../shared/email";

export type InviteRefusal = "invalid-email" | "outside-domains" | "already-member" | "already-invited";

/** What the check reads of the org: its invite domains, members and pending invitations. */
export interface InviteTarget {
  inviteDomains: readonly string[];
  members: readonly { email: string }[];
  invitations: readonly { email: string }[];
}

/**
 * The normalized (trimmed, lower-cased) address when it may be invited, else
 * why not. Unlike the sign-up allowlist, a domain matches only exactly — no
 * subdomain and no `*` wildcard — so an empty list admits no one.
 */
// r[impl identity.org-admin.invite-domain+2]
export function admitInvite(email: string, org: InviteTarget): { email: string } | { refused: InviteRefusal } {
  // "Valid" means "could be delivered to" (`wellFormedEmail`), the same test an
  // artefact share invitation's address passes.
  const address = wellFormedEmail(email);
  const domain = address ? emailDomain(address) : null;
  if (!address || !domain) return { refused: "invalid-email" };
  if (!org.inviteDomains.some((d) => d.trim().toLowerCase() === domain)) return { refused: "outside-domains" };
  const same = (e: { email: string }) => e.email.trim().toLowerCase() === address;
  if (org.members.some(same)) return { refused: "already-member" };
  if (org.invitations.some(same)) return { refused: "already-invited" };
  return { email: address };
}
