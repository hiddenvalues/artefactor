import { Hono, type Context } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import type { OrganizationContextProvider } from "../org-context";
import {
  noOrganizationAdministration,
  type OrganizationAdministration,
  type OrganizationRecord,
} from "../org-admin";
import { admitInvite } from "../../domain/identity/invite";
import type {
  InviteRequest,
  OrganizationSettings,
  OrgRole,
  RenameOrganizationRequest,
} from "../../shared/contracts";

// The longest organization name `PATCH /api/organization` accepts, after trimming.
const MAX_NAME_LENGTH = 100;

export interface OrganizationRoutesDeps {
  organizations: OrganizationContextProvider;
  administration: OrganizationAdministration;
}

// The org a request acts on, and the caller's role in it.
interface ActiveOrg {
  id: string;
  role: OrgRole;
}

// S58 — Organization settings screen and its administration seam: the active
// org's settings, and renaming, inviting and revoking for an owner or admin.
// Core decides everything here; the injected `OrganizationAdministration` only
// reports and carries out, and never sees a request core refused.
// r[impl platform.org-settings.routes]
export function createOrganizationRoutes({ organizations, administration }: OrganizationRoutesDeps) {
  const r = new Hono<AuthEnv>();

  // The caller's active org and role, from the org context alone: no org id is
  // read from the request. `null` — no context, or no administration (OSS) —
  // answers 404 on every route.
  // r[impl identity.org-admin.active-org-only+2]
  async function activeOrg(c: Context<AuthEnv>): Promise<ActiveOrg | null> {
    // r[impl identity.org-admin.oss-absent+2]
    if (administration === noOrganizationAdministration) return null;
    const context = await organizations.get(c);
    const active = context?.memberships.find((m) => m.id === context.activeId);
    return active ? { id: active.id, role: active.role } : null;
  }

  // r[impl identity.org-admin.owner-or-admin+2]
  const administers = (role: OrgRole) => role === "owner" || role === "admin";

  // What the screen shows of `record` to a caller with `role`: owners first and
  // otherwise in joined order, and the invitations and invite domains only to
  // those who administer it.
  function settings(record: OrganizationRecord, role: OrgRole): OrganizationSettings {
    const owners = record.members.filter((m) => m.role === "owner");
    const members = [...owners, ...record.members.filter((m) => m.role !== "owner")];
    // A BetterAuth org always has an owner; an empty row only guards a provider that lists none.
    const owner = owners[0] ?? { name: "", email: "" };
    return {
      id: record.id,
      name: record.name,
      owner: { name: owner.name, email: owner.email },
      role,
      members,
      ...(administers(role) ? { invitations: record.invitations, inviteDomains: record.inviteDomains } : {}),
    };
  }

  const notFound = (c: Context<AuthEnv>) => c.json({ error: "not found" }, 404);
  const forbidden = (c: Context<AuthEnv>) => c.json({ error: "forbidden" }, 403);
  const fresh = async (c: Context<AuthEnv>, org: ActiveOrg) =>
    settings(await administration.read(c, org.id), org.role);

  r.get("/", requireAuth, async (c) => {
    const org = await activeOrg(c);
    if (!org) return notFound(c);
    return c.json<OrganizationSettings>(await fresh(c, org));
  });

  r.patch("/", requireAuth, async (c) => {
    const org = await activeOrg(c);
    if (!org) return notFound(c);
    if (!administers(org.role)) return forbidden(c);
    const body = (await c.req.json().catch(() => null)) as Partial<RenameOrganizationRequest> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: `name must be 1–${MAX_NAME_LENGTH} characters` }, 400);
    }
    await administration.rename(c, org.id, name);
    return c.json<OrganizationSettings>(await fresh(c, org));
  });

  r.post("/invitations", requireAuth, async (c) => {
    const org = await activeOrg(c);
    if (!org) return notFound(c);
    if (!administers(org.role)) return forbidden(c);
    const body = (await c.req.json().catch(() => null)) as Partial<InviteRequest> | null;
    const admitted = admitInvite(typeof body?.email === "string" ? body.email : "", await administration.read(c, org.id));
    if ("refused" in admitted) {
      const conflict = admitted.refused === "already-member" || admitted.refused === "already-invited";
      return c.json({ error: admitted.refused }, conflict ? 409 : 400);
    }
    await administration.invite(c, org.id, admitted.email);
    return c.json<OrganizationSettings>(await fresh(c, org), 201);
  });

  r.delete("/invitations/:id", requireAuth, async (c) => {
    const org = await activeOrg(c);
    if (!org) return notFound(c);
    if (!administers(org.role)) return forbidden(c);
    if (!(await administration.revoke(c, org.id, c.req.param("id")))) return notFound(c);
    return c.json<OrganizationSettings>(await fresh(c, org));
  });

  return r;
}
