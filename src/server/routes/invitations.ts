import { Hono, type Context } from "hono";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { loadOwnArtefact } from "../artefacts/get-own-artefact";
import type { ShareInvitations } from "../share-invitations";
import { wellFormedEmail } from "../../shared/email";
import type { InviteRequest, InviteResult, ShareInvitation } from "../../shared/contracts";

export interface InvitationRoutesDeps {
  repo: ArtefactRepository;
  resolveScope: TenantScopeResolver;
  invitations: ShareInvitations | null;
}

// S33b — Share-invitation seam: an artefact's pending invitations, and inviting
// and revoking. Core decides everything here; the injected `ShareInvitations`
// only records and mails, and never sees a request core refused. With no port
// (OSS) every route answers 404.
export function createInvitationRoutes({ repo, resolveScope, invitations }: InvitationRoutesDeps) {
  const r = new Hono<AuthEnv>();
  const notFound = (c: Context<AuthEnv>) => c.json({ error: "not found" }, 404);

  // The port and the caller's own artefact, or the answer refusing it: no port,
  // or an artefact the caller doesn't own (or that doesn't exist), is the same
  // 404. Listing and revoking need nothing more, whatever the artefact's state:
  // pending invitations are kept like the retained access list, so the owner can
  // still withdraw one after the artefact went private, was archived or filed.
  // r[impl hosting.invitations.route-decides-target+2]
  async function ownTarget(
    c: Context<AuthEnv>,
  ): Promise<{ artefact: Artefact; port: ShareInvitations } | Response> {
    if (!invitations) return notFound(c);
    try {
      const artefact = await loadOwnArtefact(repo, {
        id: c.req.param("id")!,
        ownerId: ownerId(c),
        scope: await resolveScope(c),
      });
      return { artefact, port: invitations };
    } catch (err) {
      if (err instanceof ArtefactNotFound) return notFound(c);
      throw err;
    }
  }

  // An invite also needs a target EI2's invitation accepts (active, top-level,
  // shared): an archived, contained or private one is a 409.
  const invitable = (artefact: Artefact) =>
    artefact.status === "active" && artefact.collectionId === null && artefact.visibility !== "private";

  r.post("/:id/invitations", requireAuth, async (c) => {
    const target = await ownTarget(c);
    if (target instanceof Response) return target;
    if (!invitable(target.artefact)) return c.json({ error: "not-invitable" }, 409);
    const body = (await c.req.json().catch(() => null)) as Partial<InviteRequest> | null;
    const email = wellFormedEmail(typeof body?.email === "string" ? body.email : "");
    if (!email || email === c.get("user")!.email.trim().toLowerCase()) {
      return c.json({ error: "invalid-email" }, 400);
    }
    return c.json<InviteResult>(await target.port.invite(c, target.artefact.id, email));
  });

  r.get("/:id/invitations", requireAuth, async (c) => {
    const target = await ownTarget(c);
    if (target instanceof Response) return target;
    return c.json<ShareInvitation[]>(await target.port.list(c, target.artefact.id));
  });

  r.delete("/:id/invitations/:invitationId", requireAuth, async (c) => {
    const target = await ownTarget(c);
    if (target instanceof Response) return target;
    if (!(await target.port.revoke(c, target.artefact.id, c.req.param("invitationId")))) return notFound(c);
    return c.body(null, 204);
  });

  return r;
}
