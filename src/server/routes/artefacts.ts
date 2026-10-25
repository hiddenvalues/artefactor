import { Hono } from "hono";
import { MAX_PAYLOAD_BYTES, type Artefact } from "../../domain/artefact/artefact";
import {
  ArtefactNotFound,
  InvariantViolation,
} from "../../domain/artefact/errors";
import { DATA_VISIBILITIES, VISIBILITIES } from "../../domain/artefact/visibility";
import {
  createArtefactCommand,
  type CreateArtefactDeps,
} from "../artefacts/create-artefact.command";
import { setArtefactVisibilityCommand } from "../artefacts/set-visibility.command";
import { setDataVisibilityCommand } from "../artefacts/set-data-visibility.command";
import { clearLinkGateCommand, setLinkGateCommand } from "../artefacts/link-gate.command";
import { setSharingCommand, UnknownMember } from "../artefacts/set-sharing.command";
import { linkGateSummary, parseLinkGate } from "../link-gate/http";
import { isLinkExpired, type LinkPasswordHasher } from "../../domain/artefact/link-gate";
import type { SharingChange } from "../../domain/artefact/sharing";
import { ScryptLinkPasswordHasher } from "../../infra/crypto/link-password-hasher";
import {
  grantAccessCommand,
  revokeAccessCommand,
  listAccessMembers,
} from "../artefacts/manage-access.command";
import {
  editArtefactCommand,
  type EditArtefactInput,
} from "../artefacts/edit-artefact.command";
import {
  archiveArtefactCommand,
  deleteArtefactCommand,
  restoreArtefactCommand,
} from "../artefacts/lifecycle.command";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { recordArtefactView } from "../views/views.command";
import { moveArtefactCommand } from "../collections/move-artefact.command";
import { setArtefactBookmark } from "../bookmarks/bookmarks.command";
import { linkPassesOf } from "../link-gate/passes";
import type { AccessPolicy } from "../../domain/artefact/access";
import { loadArtefactRoot } from "../collections/effective";
import { effectiveVisibility } from "../../domain/collection/effective-access";
import {
  CollectionInvariantViolation,
  CollectionNotFound,
  RestoreUnderArchivedCollection,
} from "../../domain/collection/errors";
import { renderHostShell } from "../runtime/shell";
import { mintFrame, type Framing } from "../runtime/framing";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import type { UserDirectory } from "../data/user-directory";
import type { ThumbnailStore } from "../../domain/artefact/ports";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type {
  AccessListResponse,
  ArtefactListResponse,
  ArtefactSummary,
  GrantAccessRequest,
  MoveArtefactRequest,
  SetDataVisibilityRequest,
  SetVisibilityRequest,
} from "../../shared/contracts";
import type { Visibility } from "../../domain/artefact/visibility";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

// Route-level deps: the command deps plus the data repo needed to seed the S13
// localStorage bootstrap when serving the owner-preview HTML, and the user
// directory used to enrich + validate the S16 access list.
export type ArtefactRoutesDeps = CreateArtefactDeps & {
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  // S25/S27 — effective-access resolution, move-to-collection, and bookmarks.
  collectionRepo: CollectionRepository;
  bookmarkRepo: BookmarkRepository;
  userDirectory: UserDirectory;
  // S22 (hosting.tenant.invisible-to-oss) — resolves the request's tenant scope for the
  // owner-scoped reads.
  resolveScope: TenantScopeResolver;
  // S35 (hosting.delete.removes-everything) — permanent delete removes the thumbnail files.
  thumbnailStore: ThumbnailStore;
  // S36 — mints the owner-preview shell's first frame URL.
  framing: Framing;
  // S32a — hashes link passwords (default: scrypt).
  linkPasswordHasher?: LinkPasswordHasher;
  // The deployment's `authenticated`-tier policy (hosting.access.policy-decided) for the bookmark
  // add's read authorization; the OSS default when absent.
  accessPolicy?: AccessPolicy;
};

// BFF routes for the Artefact Hosting context. S2 adds manual HTML upload;
// API-push ingestion (S9) reuses the same command behind key auth.
export function createArtefactRoutes(deps: ArtefactRoutesDeps) {
  const r = new Hono<AuthEnv>();
  const hasher = deps.linkPasswordHasher ?? new ScryptLinkPasswordHasher();

  // Resolve one owned artefact's effective tier (hosting.access.effective-from-tree-root) for a
  // summary response.
  const effectiveVisOf = async (a: Artefact): Promise<Visibility> =>
    effectiveVisibility(a, await loadArtefactRoot(a, deps.collectionRepo));

  // Batch variant for list responses: one collections read covers the owner's
  // own trees; a container it doesn't know is another owner's tree the artefact
  // was contributed into (S29/collections.contributor.on-root-access-list) — those resolve per artefact via the repo.
  const effectiveVisMap = async (
    owner: string,
    scope: TenantScope,
  ): Promise<(a: Artefact) => Promise<Visibility>> => {
    const all = await deps.collectionRepo.listByOwner(owner, scope, {
      includeArchived: true,
    });
    const byId = new Map(all.map((col) => [col.id, col]));
    return async (a) => {
      if (a.collectionId === null) return a.visibility;
      const direct = byId.get(a.collectionId);
      if (!direct) return effectiveVisOf(a); // cross-owner container (collections.contributor.on-root-access-list)
      const root = byId.get(direct.rootId);
      // Unresolvable chain fails closed (hosting.access.effective-from-tree-root), matching
      // resolveEffectiveViewable.
      return root?.visibility ?? "private";
    };
  };

  // S10 — "Your artefacts". The signed-in owner lists their own artefacts;
  // archived ones are hidden by default
  // (hosting.lifecycle.archived-hidden-from-listings). Grouping/filtering by kind
  // is a client concern — the BFF returns the flat, most-recent-first list.
  // r[impl hosting.list.own-active+2]
  r.get("/", requireAuth, async (c) => {
    // `?archived=true` returns the owner's archived artefacts (the "Your
    // artefacts" archived view, used to restore them in S7); otherwise active only.
    const archived = c.req.query("archived") === "true";
    const scope = await deps.resolveScope(c);
    const owned = await deps.repo.listByOwner(ownerId(c), scope, {
      includeArchived: archived,
    });
    const artefacts = archived
      ? owned.filter((a) => a.status === "archived")
      : owned;
    const effVis = await effectiveVisMap(ownerId(c), scope);
    return c.json<ArtefactListResponse>({
      artefacts: await Promise.all(
        artefacts.map(async (a) => toArtefactSummary(a, await effVis(a), ownerId(c))),
      ),
    });
  });

  // S4 — Owner views own artefact. Owner-only detail for a single active artefact
  // (any visibility, including a never-shared private one). Non-owner, unknown,
  // or archived → 404 (existence/archived-state not leaked,
  // hosting.lifecycle.archived-not-served, hosting.access.no-existence-leak).
  r.get("/:id", requireAuth, async (c) => {
    try {
      const artefact = await loadOwnActiveArtefact(deps.repo, {
        id: c.req.param("id"),
        ownerId: ownerId(c),
        scope: await deps.resolveScope(c),
      });
      return c.json<ArtefactSummary>(
        toArtefactSummary(artefact, await effectiveVisOf(artefact), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // S4 + S12 — Owner views own artefact content. The in-app preview path (the
  // `/a/:slug` route only works once an artefact is shared). Like the slug route,
  // `/:id/raw` returns the S12 host **shell** (toolbar + iframe) and the artefact
  // itself lives in `/:id/raw/frame`. Addressed by id so a never-shared private
  // artefact still previews + persists. Non-owner / unknown / archived → 404.
  r.get("/:id/raw", requireAuth, async (c) => {
    try {
      const artefact = await loadOwnActiveArtefact(deps.repo, {
        id: c.req.param("id"),
        ownerId: ownerId(c),
        scope: await deps.resolveScope(c),
      });
      const scope = await deps.resolveScope(c);
      // S47 — the owner opening their preview is a view too, recorded as on
      // `/a/:slug`: best-effort, so a store hiccup never breaks serving.
      // r[impl views.record.on-owner-preview]
      try {
        await recordArtefactView(artefact.id, ownerId(c), { viewRepo: deps.viewRepo });
      } catch {
        // Non-critical — serve the preview regardless.
      }
      const own = await deps.dataRepo.findByArtefactAndAuthor(artefact.id, ownerId(c));
      // S36 — the owner preview's frame opens on a `raw` token carrying the
      // tenant scope this read ran under.
      const minted = mintFrame(deps.framing, "raw", artefact.id, {
        artefactId: artefact.id,
        viewerId: ownerId(c),
        authorId: null,
        tenantId: scope.tenantId,
      });
      return c.html(
        renderHostShell({
          title: artefact.title,
          kind: artefact.kind,
          updatedAt: artefact.updatedAt.toISOString(),
          // S36 — the owner preview's frame opens on a `raw` token carrying the
          // tenant scope this read ran under.
          frameUrl: minted.frameUrl,
          channel: minted.channel,
          mintEndpoint: `/api/artefacts/${encodeURIComponent(artefact.id)}/frame-token`,
          dataEndpoint: `/api/artefacts/${encodeURIComponent(artefact.id)}/data/me`,
          seedUpdatedAt: own?.updatedAt.toISOString() ?? null,
          authorsEndpoint: `/api/artefacts/${encodeURIComponent(artefact.id)}/data/authors`,
          viewersEndpoint: `/api/artefacts/${encodeURIComponent(artefact.id)}/viewers`,
          viewerId: ownerId(c),
          ownerId: artefact.ownerId,
          usesStorage: artefact.usesStorage,
          linkExpired: isLinkExpired(artefact, new Date()),
        }),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  // The artefact itself for the owner preview (`/:id/raw/frame`) is a frame
  // route (`routes/frame.ts`, S36): token-authenticated, never cookie-read.

  // S5 — Share / unshare. Owner sets the visibility tier; `private` unshares
  // (retaining the slug), `authenticated`/`public` share (minting on first
  // share). Non-owner or unknown id → 404 (existence is not leaked); archived
  // → 400. Returns the updated summary (with the slug once shared).
  r.put("/:id/visibility", requireAuth, async (c) => {
    const body = await c.req
      .json<Partial<SetVisibilityRequest>>()
      .catch(() => ({}) as Partial<SetVisibilityRequest>);
    const visibility = body.visibility;
    if (!visibility || !VISIBILITIES.includes(visibility)) {
      return c.json({ error: "visibility must be one of " + VISIBILITIES.join(", ") }, 400);
    }
    // S32a (hosting.link-gate.public-only) — optional link protection, set with the change to
    // `public`.
    const linkGate = body.linkGate === undefined ? undefined : parseLinkGate(body.linkGate, false);
    if (linkGate === "invalid") {
      return c.json({ error: "linkGate must be { password?: string, expiresAt?: ISO date }" }, 400);
    }
    try {
      const updated = await setArtefactVisibilityCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          visibility,
          scope: await deps.resolveScope(c),
          linkGate: linkGate as { password?: string; expiresAt?: Date } | undefined,
        },
        { repo: deps.repo, hasher },
      );
      return c.json<ArtefactSummary>(toArtefactSummary(updated, updated.visibility, ownerId(c)));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S55 — the Manage access dialog's Done: tier, access list, link gate and
  // data visibility saved together (hosting.sharing.atomic-save). Owner-only: a
  // non-owner or unknown id → 404 (hosting.access.no-existence-leak); a bad body, an unknown added member or
  // any refused part → 400, and nothing is saved.
  r.put("/:id/sharing", requireAuth, async (c) => {
    const change = parseSharing(await c.req.json().catch(() => null));
    if (change === "invalid") {
      return c.json(
        {
          error:
            "body must be { visibility, members?: string[], linkGate?: { password?, expiresAt? }, dataVisibility? }",
        },
        400,
      );
    }
    try {
      const updated = await setSharingCommand(
        { artefactId: c.req.param("id"), requesterId: ownerId(c), scope: await deps.resolveScope(c), change },
        {
          repo: deps.repo,
          hasher,
          knownUsers: async (ids) => new Set((await deps.userDirectory.lookup([...ids])).keys()),
        },
      );
      return c.json<ArtefactSummary>(toArtefactSummary(updated, await effectiveVisOf(updated), ownerId(c)));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof UnknownMember) return c.json({ error: "unknown user" }, 400);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S32a — Link protection on a public artefact (hosting.link-gate.public-only). Owner-only: a
  // non-owner or unknown id is a flat 404 (hosting.access.no-existence-leak); archived, not public,
  // contained, a bad password or a past expiry → 400. An omitted half is kept, `null` clears it;
  // DELETE clears both. Returns the updated owner summary.
  r.put("/:id/link-gate", requireAuth, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const gate = parseLinkGate(body, true);
    if (gate === "invalid") {
      return c.json(
        { error: "body must be { password?: string | null, expiresAt?: ISO date | null }" },
        400,
      );
    }
    try {
      const updated = await setLinkGateCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
          ...gate,
        },
        { repo: deps.repo, hasher },
      );
      return c.json<ArtefactSummary>(toArtefactSummary(updated, updated.visibility, ownerId(c)));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  r.delete("/:id/link-gate", requireAuth, async (c) => {
    try {
      const updated = await clearLinkGateCommand(
        { artefactId: c.req.param("id"), requesterId: ownerId(c), scope: await deps.resolveScope(c) },
        { repo: deps.repo },
      );
      return c.json<ArtefactSummary>(toArtefactSummary(updated, updated.visibility, ownerId(c)));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S41 — Owner-set data visibility (hosting.data-visibility.owner-set). Owner-only, per artefact
  // (settable while contained). Non-owner or unknown id → 404 (hosting.access.no-existence-leak);
  // archived → 400, as for every other mutation. Returns the updated summary.
  r.put("/:id/data-visibility", requireAuth, async (c) => {
    // A JSON `null` or scalar body parses fine, so check it is an object first.
    const body: unknown = await c.req.json().catch(() => null);
    const dataVisibility =
      typeof body === "object" && body !== null
        ? (body as Partial<SetDataVisibilityRequest>).dataVisibility
        : undefined;
    if (!dataVisibility || !DATA_VISIBILITIES.includes(dataVisibility)) {
      return c.json(
        { error: "dataVisibility must be one of " + DATA_VISIBILITIES.join(", ") },
        400,
      );
    }
    try {
      const updated = await setDataVisibilityCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          dataVisibility,
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.json<ArtefactSummary>(
        toArtefactSummary(updated, await effectiveVisOf(updated), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S16 — Manage access (the `selected` tier's member list). All three are
  // owner-only; a non-owner or unknown id is a flat 404 (existence not leaked,
  // hosting.authority.owner-only). Membership is consulted only while visibility
  // is `selected`, but it can be curated at any tier.

  // List the current members, enriched with display identity for the picker.
  r.get("/:id/access", requireAuth, async (c) => {
    try {
      const memberIds = await listAccessMembers(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      const identities = await deps.userDirectory.lookup(memberIds);
      return c.json<AccessListResponse>({
        members: memberIds.map((id) => ({
          id,
          name: identities.get(id)?.name ?? "",
          email: identities.get(id)?.email ?? "",
        })),
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // Grant a user access. Validates the target is a real registered user so the
  // list can't accrue dangling ids. 204 on success.
  r.post("/:id/access", requireAuth, async (c) => {
    const body = await c.req
      .json<Partial<GrantAccessRequest>>()
      .catch(() => ({}) as Partial<GrantAccessRequest>);
    const userId = body.userId;
    if (!userId || typeof userId !== "string") {
      return c.json({ error: "userId is required" }, 400);
    }
    try {
      const known = await deps.userDirectory.lookup([userId]);
      if (!known.has(userId)) {
        return c.json({ error: "unknown user" }, 400);
      }
      await grantAccessCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          userId,
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // Revoke a user's access. Idempotent — revoking a non-member still 204s.
  r.delete("/:id/access/:userId", requireAuth, async (c) => {
    try {
      await revokeAccessCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          userId: c.req.param("userId"),
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S3 — Edit artefact. Owner updates any of title / kind / payload
  // (multipart/form-data; only the provided fields change). Archived/non-owner →
  // 404; empty title, empty/oversize payload, unknown kind → 400
  // (hosting.payload.size-bounds, hosting.artefact.title-required,
  // hosting.lifecycle.archived-not-served, hosting.access.no-existence-leak).
  r.patch("/:id", requireAuth, async (c) => {
    const body = await c.req.parseBody();
    const input: EditArtefactInput = {
      artefactId: c.req.param("id"),
      requesterId: ownerId(c),
      scope: await deps.resolveScope(c),
    };
    if (typeof body.title === "string") input.title = body.title;
    if (typeof body.kind === "string") input.kind = body.kind;
    if (body.payload instanceof File) {
      if (body.payload.size > MAX_PAYLOAD_BYTES) {
        return c.json({ error: "payload exceeds the 100 MB cap" }, 400);
      }
      input.payload = new Uint8Array(await body.payload.arrayBuffer());
    }
    try {
      const updated = await editArtefactCommand(input, deps);
      return c.json<ArtefactSummary>(
        toArtefactSummary(updated, await effectiveVisOf(updated), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S7 — Archive (soft-delete). Owner-only; active → archived (hosting.lifecycle.archive-stamps-archived-at).
  r.post("/:id/archive", requireAuth, async (c) => {
    try {
      const updated = await archiveArtefactCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.json<ArtefactSummary>(
        toArtefactSummary(updated, await effectiveVisOf(updated), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S7 — Restore. Owner-only; archived → active at the prior visibility
  // (hosting.authority.owner-only).
  r.post("/:id/restore", requireAuth, async (c) => {
    try {
      const updated = await restoreArtefactCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo, collectionRepo: deps.collectionRepo },
      );
      return c.json<ArtefactSummary>(
        toArtefactSummary(updated, await effectiveVisOf(updated), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      // The web app's copy names, never ids (collections.lifecycle.restore-under-active-parent).
      if (err instanceof RestoreUnderArchivedCollection) {
        return c.json({ error: err.namesOnly }, 400);
      }
      throw err;
    }
  });

  // S15 — Permanent delete (hosting.delete.archived-only). Owner-only; allowed only for an archived
  // artefact. Non-owner / unknown → 404; active (not archived) → 400. Removes
  // the row, its payload file, and all its data entries. 204 on success.
  r.delete("/:id", requireAuth, async (c) => {
    try {
      await deleteArtefactCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        {
          repo: deps.repo,
          dataRepo: deps.dataRepo,
          viewRepo: deps.viewRepo,
          bookmarkRepo: deps.bookmarkRepo,
          payloadStore: deps.payloadStore,
          thumbnailStore: deps.thumbnailStore,
        },
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S25/S29 — Add/move to collection (or back to top level with null). The mover owns the
  // artefact; the target is their own collection or a tree they contribute to
  // (hosting.collection.move-into-own-or-contributed); moving into a shared tree mints the slug
  // (collections.slug.minted-on-effective-share).
  r.put("/:id/collection", requireAuth, async (c) => {
    const body = await c.req
      .json<Partial<MoveArtefactRequest>>()
      .catch(() => ({}) as Partial<MoveArtefactRequest>);
    if (body.collectionId !== null && typeof body.collectionId !== "string") {
      return c.json({ error: "collectionId must be a collection id or null" }, 400);
    }
    try {
      const moved = await moveArtefactCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          collectionId: body.collectionId,
          scope: await deps.resolveScope(c),
        },
        { artefactRepo: deps.repo, collectionRepo: deps.collectionRepo },
      );
      return c.json<ArtefactSummary>(
        toArtefactSummary(moved, await effectiveVisOf(moved), ownerId(c)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound || err instanceof CollectionNotFound)
        return c.json({ error: "not found" }, 404);
      if (
        err instanceof InvariantViolation ||
        err instanceof CollectionInvariantViolation
      )
        return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S27 — Bookmark / unbookmark a viewable artefact (collections.bookmark.artefact-view-gated).
  // Idempotent (collections.bookmark.set-semantics).
  r.put("/:id/bookmark", requireAuth, async (c) => {
    try {
      await setArtefactBookmark(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          bookmarked: true,
          scope: await deps.resolveScope(c),
          passes: linkPassesOf(c),
        },
        {
          bookmarkRepo: deps.bookmarkRepo,
          artefactRepo: deps.repo,
          collectionRepo: deps.collectionRepo,
          accessPolicy: deps.accessPolicy,
        },
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  r.delete("/:id/bookmark", requireAuth, async (c) => {
    try {
      await setArtefactBookmark(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          bookmarked: false,
          scope: await deps.resolveScope(c),
        },
        {
          bookmarkRepo: deps.bookmarkRepo,
          artefactRepo: deps.repo,
          collectionRepo: deps.collectionRepo,
        },
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // S2 — Create artefact. Authenticated owner uploads title + kind + an HTML file
  // (multipart/form-data). The session user becomes the ownerId
  // (hosting.create.owner-is-creator).
  // r[impl hosting.create.from-upload+2]
  // r[impl hosting.create.owner-from-session+2]
  r.post("/", requireAuth, async (c) => {
    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const file = body.payload;

    if (!(file instanceof File)) {
      return c.json({ error: "an HTML payload file is required" }, 400);
    }
    // Reject oversize before buffering the whole file into memory (hosting.payload.size-bounds).
    if (file.size > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "payload exceeds the 100 MB cap" }, 400);
    }

    const payload = new Uint8Array(await file.arrayBuffer());
    try {
      const scope = await deps.resolveScope(c);
      const artefact = await createArtefactCommand(
        { ownerId: ownerId(c), title, kind, payload, tenantId: scope.tenantId },
        deps,
      );
      return c.json<ArtefactSummary>(toArtefactSummary(artefact, artefact.visibility, ownerId(c)), 201);
    } catch (err) {
      if (err instanceof InvariantViolation) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  return r;
}

// S55 — the shape of a `SetSharingRequest`; "invalid" on anything else.
function parseSharing(body: unknown): SharingChange | "invalid" {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid";
  const { visibility, members, linkGate, dataVisibility } = body as Record<string, unknown>;
  if (typeof visibility !== "string" || !(VISIBILITIES as readonly string[]).includes(visibility)) return "invalid";
  const change: SharingChange = { visibility: visibility as Visibility };
  if (members !== undefined) {
    if (!Array.isArray(members) || !members.every((m) => typeof m === "string" && m !== "")) return "invalid";
    change.members = members as string[];
  }
  if (linkGate !== undefined) {
    const gate = parseLinkGate(linkGate, true);
    if (gate === "invalid") return "invalid";
    change.linkGate = gate;
  }
  if (dataVisibility !== undefined) {
    if (typeof dataVisibility !== "string" || !(DATA_VISIBILITIES as readonly string[]).includes(dataVisibility))
      return "invalid";
    change.dataVisibility = dataVisibility as NonNullable<SharingChange["dataVisibility"]>;
  }
  return change;
}

// S35 — the card preview URL, versioned by the recorded hash so a
// re-render busts the immutable cache. Archived artefacts are inert
// (hosting.lifecycle.archived-not-served): no URL.
// r[impl hosting.thumbnail.summary-url]
function thumbnailUrlOf(a: Artefact): string | null {
  if (a.thumbnailHash === null || a.status !== "active") return null;
  return `/api/artefacts/${encodeURIComponent(a.id)}/thumbnail?v=${a.thumbnailHash}`;
}

// `effectiveVisibility` (hosting.access.effective-from-tree-root) defaults to the artefact's own
// tier — correct for every top-level artefact; callers pass the resolved tier for contained ones
// (the create path is always top-level, hosting.artefact.owner-required). `viewerId` is who the
// summary is for: `linkGate` rides only on the owner's own summaries (S32a), never on a summary
// another user sees.
export function toArtefactSummary(
  a: Artefact,
  effectiveVis: Visibility = a.visibility,
  viewerId: string | null = null,
): ArtefactSummary {
  return {
    // r[impl hosting.link-gate.owner-summary-only]
    ...(viewerId === a.ownerId ? { linkGate: linkGateSummary(a.linkGate) } : {}),
    id: a.id,
    ownerId: a.ownerId,
    title: a.title,
    kind: a.kind,
    visibility: a.visibility,
    effectiveVisibility: effectiveVis,
    collectionId: a.collectionId,
    status: a.status,
    publicSlug: a.publicSlug,
    payloadBytes: a.payloadBytes,
    usesStorage: a.usesStorage,
    dataVisibility: a.dataVisibility,
    // The one field thumbnail state reaches: derived host chrome, never access,
    // serving or listing.
    // r[impl hosting.thumbnail.host-chrome-only]
    thumbnailUrl: thumbnailUrlOf(a),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
