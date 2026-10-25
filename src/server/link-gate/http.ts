import type { LinkGate } from "../../domain/artefact/link-gate";
import type { LinkGateSummary } from "../../shared/contracts";

// The BFF shapes of a link gate, shared by both holders — an artefact (S32a)
// and a collection root (S32b).

// The body of a gate change. `nullable` allows `null` (clear) on the link-gate
// routes; the tier-change routes only set. "invalid" on any other shape, a
// non-string password, or an unparseable expiry.
export function parseLinkGate(
  body: unknown,
  nullable: boolean,
): { password?: string | null; expiresAt?: Date | null } | "invalid" {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid";
  const { password, expiresAt } = body as Record<string, unknown>;
  const out: { password?: string | null; expiresAt?: Date | null } = {};
  if (password !== undefined) {
    if (password === null && nullable) out.password = null;
    else if (typeof password === "string") out.password = password;
    else return "invalid";
  }
  if (expiresAt !== undefined) {
    if (expiresAt === null && nullable) out.expiresAt = null;
    else if (typeof expiresAt === "string" && !Number.isNaN(Date.parse(expiresAt))) {
      out.expiresAt = new Date(expiresAt);
    } else return "invalid";
  }
  return out;
}

// The owner's view of a gate: whether a password is set (never the hash) and
// the expiry; null when there is no gate.
export function linkGateSummary(gate: LinkGate): LinkGateSummary | null {
  const { passwordHash, expiresAt } = gate;
  if (passwordHash === null && expiresAt === null) return null;
  return { passwordProtected: passwordHash !== null, expiresAt: expiresAt?.toISOString() ?? null };
}
