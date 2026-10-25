import { Hono } from "hono";
import type { Collection } from "../../domain/collection/collection";
import {
  CollectionInvariantViolation,
  CollectionNotFound,
} from "../../domain/collection/errors";
import { VISIBILITIES } from "../../domain/artefact/visibility";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { COLLECTION_DESCRIPTION_MAX } from "../../domain/collection/description";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { BookmarkRepository } from "../../domain/bookmark/bookmark-repository";
import type { DataRepository } from "../../domain/data/data-repository";
import type { ViewRepository } from "../../domain/views/view-repository";
import type { PayloadStore, ThumbnailStore } from "../../domain/artefact/ports";
import type { UserDirectory } from "../data/user-directory";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";
import { ScryptLinkPasswordHasher } from "../../infra/crypto/link-password-hasher";
import { linkGateSummary, parseLinkGate } from "../link-gate/http";
import {
  clearCollectionLinkGateCommand,
  createCollectionCommand,
  editCollectionCommand,
  setCollectionLinkGateCommand,
  grantCollectionAccessCommand,
  listCollectionAccessMembers,
  listOwnCollections,
  revokeCollectionAccessCommand,
} from "../collections/collections.command";
import {
  archiveCollectionCommand,
  deleteCollectionCommand,
  restoreCollectionCommand,
} from "../collections/lifecycle.command";
import { setCollectionBookmark } from "../bookmarks/bookmarks.command";
import { ejectArtefactCommand } from "../collections/move-artefact.command";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import { toArtefactSummary } from "./artefacts";
import type { ArtefactSummary } from "../../shared/contracts";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type {
  AccessListResponse,
  CollectionLifecycleResponse,
  CollectionListResponse,
  CollectionSummary,
  CreateCollectionRequest,
  EditCollectionRequest,
  GrantAccessRequest,
} from "../../shared/contracts";

export interface CollectionRoutesDeps {
  collectionRepo: CollectionRepository;
  artefactRepo: ArtefactRepository;
  bookmarkRepo: BookmarkRepository;
  dataRepo: DataRepository;
  viewRepo: ViewRepository;
  payloadStore: PayloadStore;
  // S35 (hosting.delete.removes-everything via collections.lifecycle.delete-cascades) — the delete cascade removes
  // each artefact's thumbnails.
  thumbnailStore: ThumbnailStore;
  userDirectory: UserDirectory;
  resolveScope: TenantScopeResolver;
  // S32b — hashes a root's link password (default: scrypt).
  linkPasswordHasher?: LinkPasswordHasher;
}

// BFF routes for the Artefact Collections context (S25/S26/S27) — all
// owner-scoped (collections.authority.owner-only): a non-owner or unknown id is a uniform 404 (collections.access.no-existence-leak).
export function createCollectionRoutes(deps: CollectionRoutesDeps) {
  const r = new Hono<AuthEnv>();
  const hasher = deps.linkPasswordHasher ?? new ScryptLinkPasswordHasher();

  // The owner's collections — the sidebar tree (`?archived=true` → the archive
  // view's collections; like the artefact listing, archived-only when asked).
  r.get("/", requireAuth, async (c) => {
    const archived = c.req.query("archived") === "true";
    const collections = await listOwnCollections(
      {
        requesterId: ownerId(c),
        includeArchived: archived,
        scope: await deps.resolveScope(c),
      },
      deps,
    );
    const visible = archived
      ? collections.filter((col) => col.status === "archived")
      : collections;
    return c.json<CollectionListResponse>({
      collections: visible.map((col) => toCollectionSummary(col, ownerId(c))),
    });
  });

  // Create (top-level, or nested via parentId — collections.tree.single-owner, collections.tree.shape-fixed).
  r.post("/", requireAuth, async (c) => {
    const body = await c.req
      .json<Partial<CreateCollectionRequest>>()
      .catch(() => ({}) as Partial<CreateCollectionRequest>);
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "name is required" }, 400);
    }
    if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) {
      return c.json({ error: "visibility must be one of " + VISIBILITIES.join(", ") }, 400);
    }
    if (!isDescriptionField(body.description)) {
      return c.json({ error: DESCRIPTION_FIELD_ERROR }, 400);
    }
    try {
      const collection = await createCollectionCommand(
        {
          requesterId: ownerId(c),
          name: body.name,
          description: body.description,
          parentId: body.parentId ?? null,
          visibility: body.visibility,
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.json<CollectionSummary>(toCollectionSummary(collection, ownerId(c)), 201);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // Edit details & access (collections.collection.name-required, collections.collection.description, collections.access.root-governs-tree). A tier change back-fills slugs (collections.slug.minted-on-effective-share,
  // hosting.slug.minted-on-root-share).
  r.patch("/:id", requireAuth, async (c) => {
    const body = await c.req
      .json<Partial<EditCollectionRequest>>()
      .catch(() => ({}) as Partial<EditCollectionRequest>);
    if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) {
      return c.json({ error: "visibility must be one of " + VISIBILITIES.join(", ") }, 400);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return c.json({ error: "name must be a string" }, 400);
    }
    if (!isDescriptionField(body.description)) {
      return c.json({ error: DESCRIPTION_FIELD_ERROR }, 400);
    }
    // S32b — optional link protection, set with the root's change to `public`.
    const linkGate = body.linkGate === undefined ? undefined : parseLinkGate(body.linkGate, false);
    if (linkGate === "invalid") {
      return c.json({ error: "linkGate must be { password?: string, expiresAt?: ISO date }" }, 400);
    }
    try {
      const collection = await editCollectionCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          name: body.name,
          description: body.description,
          visibility: body.visibility,
          linkGate: linkGate as { password?: string; expiresAt?: Date } | undefined,
          scope: await deps.resolveScope(c),
        },
        { ...deps, hasher },
      );
      return c.json<CollectionSummary>(toCollectionSummary(collection, ownerId(c)));
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // S32b — link protection on a public root (`collections.link-gate.public-root-
  // only`). A non-owner or unknown id is a flat 404 (collections.access.no-existence-leak); archived, nested,
  // not public, a bad password or a past expiry → 400. An omitted half is kept,
  // `null` clears it; DELETE clears both. Returns the updated owner summary.
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
      const collection = await setCollectionLinkGateCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
          ...gate,
        },
        { ...deps, hasher },
      );
      return c.json<CollectionSummary>(toCollectionSummary(collection, ownerId(c)));
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  r.delete("/:id/link-gate", requireAuth, async (c) => {
    try {
      const collection = await clearCollectionLinkGateCommand(
        { collectionId: c.req.param("id"), requesterId: ownerId(c), scope: await deps.resolveScope(c) },
        deps,
      );
      return c.json<CollectionSummary>(toCollectionSummary(collection, ownerId(c)));
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // The `selected`-tier access list on a root (collections.access.root-governs-tree) — mirrors the artefact
  // access endpoints (S16) so the client reuses the same manage-access UI.
  r.get("/:id/access", requireAuth, async (c) => {
    try {
      const memberIds = await listCollectionAccessMembers(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        deps,
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
      return mapCollectionError(c, err);
    }
  });

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
      await grantCollectionAccessCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          userId,
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.body(null, 204);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  r.delete("/:id/access/:userId", requireAuth, async (c) => {
    try {
      await revokeCollectionAccessCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          userId: c.req.param("userId"),
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.body(null, 204);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // Archive the subtree (collections.lifecycle.archive-cascades). Returns cascade counts for the toast copy.
  r.post("/:id/archive", requireAuth, async (c) => {
    try {
      const { collection, cascade } = await archiveCollectionCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.json<CollectionLifecycleResponse>({
        collection: toCollectionSummary(collection, ownerId(c)),
        cascade,
      });
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // Restore the subtree (collections.lifecycle.restore-cascades).
  r.post("/:id/restore", requireAuth, async (c) => {
    try {
      const { collection, cascade } = await restoreCollectionCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.json<CollectionLifecycleResponse>({
        collection: toCollectionSummary(collection, ownerId(c)),
        cascade,
      });
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // Permanent delete with cascade (collections.lifecycle.delete-cascades) — archived-only. 204 on success.
  r.delete("/:id", requireAuth, async (c) => {
    try {
      await deleteCollectionCommand(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.body(null, 204);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  // S29 — eject an artefact from the caller's collection to top level (collections.containment.co-owned).
  // Collection-owner-only; the artefact (any owner, any status) falls back to
  // its dormant own tier untouched.
  r.delete("/:id/artefacts/:artefactId", requireAuth, async (c) => {
    try {
      const evicted = await ejectArtefactCommand(
        {
          collectionId: c.req.param("id"),
          artefactId: c.req.param("artefactId"),
          requesterId: ownerId(c),
          scope: await deps.resolveScope(c),
        },
        { artefactRepo: deps.artefactRepo, collectionRepo: deps.collectionRepo },
      );
      // Post-eviction the artefact is top-level: its own tier is effective.
      return c.json<ArtefactSummary>(toArtefactSummary(evicted));
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.json({ error: "not found" }, 404);
      return mapCollectionError(c, err);
    }
  });

  // Bookmark / unbookmark the collection (S27, collections.bookmark.collection-view-gated). Idempotent.
  r.put("/:id/bookmark", requireAuth, async (c) => {
    try {
      await setCollectionBookmark(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          bookmarked: true,
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.body(null, 204);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  r.delete("/:id/bookmark", requireAuth, async (c) => {
    try {
      await setCollectionBookmark(
        {
          collectionId: c.req.param("id"),
          requesterId: ownerId(c),
          bookmarked: false,
          scope: await deps.resolveScope(c),
        },
        deps,
      );
      return c.body(null, 204);
    } catch (err) {
      return mapCollectionError(c, err);
    }
  });

  return r;
}

// S74 — an optional description: absent, a string, or null to clear. Its
// length is the domain's rule (collections.collection.description), answered 400.
const DESCRIPTION_FIELD_ERROR = `description must be a string of at most ${COLLECTION_DESCRIPTION_MAX} characters, or null`;

function isDescriptionField(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function mapCollectionError(
  c: { json: (o: object, s: 400 | 404) => Response; notFound?: unknown },
  err: unknown,
): Response {
  if (err instanceof CollectionNotFound) {
    return c.json({ error: "not found" }, 404);
  }
  if (err instanceof CollectionInvariantViolation) {
    return c.json({ error: err.message }, 400);
  }
  throw err;
}

// `viewerId` is who the summary is for: `linkGate` and `publicSlug` ride only on
// the owner's own summaries, never on a tree shared with (or bookmarked by)
// anyone else.
// r[impl collections.link-gate.owner-summary-only]
export function toCollectionSummary(col: Collection, viewerId: string | null): CollectionSummary {
  return {
    ...(viewerId === col.ownerId ? { linkGate: linkGateSummary(col.linkGate) } : {}),
    ...(viewerId === col.ownerId ? ownerPublicSlug(col) : {}),
    id: col.id,
    ownerId: col.ownerId,
    name: col.name,
    description: col.description,
    parentId: col.parentId,
    rootId: col.rootId,
    visibility: col.visibility,
    status: col.status,
    createdAt: col.createdAt.toISOString(),
    updatedAt: col.updatedAt.toISOString(),
  };
}

// S44 — a root's public id, so its owner can hand it to a site; a non-root is
// reached through its root and has none.
// r[impl collections.public-link.owner-summary-slug]
function ownerPublicSlug(col: Collection): { publicSlug: string | null } {
  return { publicSlug: col.parentId === null ? col.publicSlug : null };
}
