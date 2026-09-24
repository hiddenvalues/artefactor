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
import { moveArtefactCommand } from "../collections/move-artefact.command";
import { setArtefactBookmark } from "../bookmarks/bookmarks.command";
import { loadArtefactRoot } from "../collections/effective";
import { effectiveVisibility } from "../../domain/collection/effective-access";
import {
  CollectionInvariantViolation,
  CollectionNotFound,
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
  // S22 (AH17) — resolves the request's tenant scope for the owner-scoped reads.
  resolveScope: TenantScopeResolver;
  // S35 (AH11) — permanent delete removes the thumbnail files.
  thumbnailStore: ThumbnailStore;
  // S36 — mints the owner-preview shell's first frame URL.
  framing: Framing;
};

// BFF routes for the Artefact Hosting context. S2 adds manual HTML upload;
// API-push ingestion (S9) reuses the same command behind key auth.
export function createArtefactRoutes(deps: ArtefactRoutesDeps) {
  const r = new Hono<AuthEnv>();

  // Resolve one owned artefact's effective tier (AH20) for a summary response.
  const effectiveVisOf = async (a: Artefact): Promise<Visibility> =>
    effectiveVisibility(a, await loadArtefactRoot(a, deps.collectionRepo));

  // Batch variant for list responses: one collections read covers the owner's
  // own trees; a container it doesn't know is another owner's tree the artefact
  // was contributed into (S29/CL12) — those resolve per artefact via the repo.
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
      if (!direct) return effectiveVisOf(a); // cross-owner container (CL12)
      const root = byId.get(direct.rootId);
      // Unresolvable chain fails closed (AH20), matching resolveEffectiveViewable.
      return root?.visibility ?? "private";
    };
  };

  // S10 — "Your artefacts". The signed-in owner lists their own artefacts;
  // archived ones are hidden by default (AH7). Grouping/filtering by kind is a
  // client concern — the BFF returns the flat, most-recent-first list.
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
        artefacts.map(async (a) => toArtefactSummary(a, await effVis(a))),
      ),
    });
  });

  // S4 — Owner views own artefact. Owner-only detail for a single active
  // artefact (any visibility, including a never-shared private one). Non-owner,
  // unknown, or archived → 404 (existence/archived-state not leaked, AH7/8).
  r.get("/:id", requireAuth, async (c) => {
    try {
      const artefact = await loadOwnActiveArtefact(deps.repo, {
        id: c.req.param("id"),
        ownerId: ownerId(c),
        scope: await deps.resolveScope(c),
      });
      return c.json<ArtefactSummary>(
        toArtefactSummary(artefact, await effectiveVisOf(artefact)),
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
    try {
      const updated = await setArtefactVisibilityCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          visibility,
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.json<ArtefactSummary>(toArtefactSummary(updated));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S41 — Owner-set data visibility (AH30). Owner-only, per artefact (settable
  // while contained). Non-owner or unknown id → 404 (AH8); archived → 400, as
  // for every other mutation. Returns the updated summary.
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
        toArtefactSummary(updated, await effectiveVisOf(updated)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S16 — Manage access (the `selected` tier's member list). All three are
  // owner-only; a non-owner or unknown id is a flat 404 (existence not leaked,
  // AH9). Membership is consulted only while visibility is `selected`, but it
  // can be curated at any tier.

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
  // (multipart/form-data; only the provided fields change). Archived/non-owner
  // → 404; empty title, empty/oversize payload, unknown kind → 400 (AH2, 3, 7, 8).
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
        toArtefactSummary(updated, await effectiveVisOf(updated)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S7 — Archive (soft-delete). Owner-only; active → archived (AH7).
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
        toArtefactSummary(updated, await effectiveVisOf(updated)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S7 — Restore. Owner-only; archived → active at the prior visibility (AH9).
  r.post("/:id/restore", requireAuth, async (c) => {
    try {
      const updated = await restoreArtefactCommand(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        { repo: deps.repo },
      );
      return c.json<ArtefactSummary>(
        toArtefactSummary(updated, await effectiveVisOf(updated)),
      );
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      if (err instanceof InvariantViolation) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // S15 — Permanent delete (AH11). Owner-only; allowed only for an archived
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

  // S25 — Add/move to collection (or back to top level with null). Owner-only
  // on both sides (CL1/CL9); moving into a shared tree mints the slug (CL6).
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
        toArtefactSummary(moved, await effectiveVisOf(moved)),
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

  // S27 — Bookmark / unbookmark (own artefacts only, BM2). Idempotent (BM1).
  r.put("/:id/bookmark", requireAuth, async (c) => {
    try {
      await setArtefactBookmark(
        {
          artefactId: c.req.param("id"),
          requesterId: ownerId(c),
          bookmarked: true,
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

  // S2 — Create artefact. Authenticated owner uploads title + kind + an HTML
  // file (multipart/form-data). The session user becomes the ownerId (AH1).
  r.post("/", requireAuth, async (c) => {
    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const file = body.payload;

    if (!(file instanceof File)) {
      return c.json({ error: "an HTML payload file is required" }, 400);
    }
    // Reject oversize before buffering the whole file into memory (AH2).
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
      return c.json<ArtefactSummary>(toArtefactSummary(artefact), 201);
    } catch (err) {
      if (err instanceof InvariantViolation) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  return r;
}

// S35 (AH25/AH27) — the card preview URL, versioned by the recorded hash so a
// re-render busts the immutable cache. Archived artefacts are inert (AH7): no URL.
function thumbnailUrlOf(a: Artefact): string | null {
  if (a.thumbnailHash === null || a.status !== "active") return null;
  return `/api/artefacts/${encodeURIComponent(a.id)}/thumbnail?v=${a.thumbnailHash}`;
}

// `effectiveVisibility` (AH20) defaults to the artefact's own tier — correct
// for every top-level artefact; callers pass the resolved tier for contained
// ones (the create path is always top-level, AH1).
export function toArtefactSummary(
  a: Artefact,
  effectiveVis: Visibility = a.visibility,
): ArtefactSummary {
  return {
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
    thumbnailUrl: thumbnailUrlOf(a),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
