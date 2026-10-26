# Artefact Collections

## Slices

### S25 — Collections (folder tree + inherited access)

- **Status:** done
- **Depends on:** S2, S5, S6, S10, S16, S22
- **Delivers:** collections.tree.single-owner, collections.collection.name-required,
  collections.tree.shape-fixed, collections.access.root-governs-tree,
  collections.access.set-on-root-only, collections.access.contained-own-tier-dormant,
  collections.slug.minted-on-effective-share, collections.lifecycle.archived-inert,
  collections.authority.owner-only, collections.access.no-existence-leak,
  collections.access.archived-root-serves-nothing,
  collections.access.unresolvable-chain-fails-closed, hosting.access.effective-from-tree-root,
  hosting.access.dormant-tier-frozen, hosting.shared.lists-effectively-shared,
  hosting.slug.minted-on-move-into-shared-tree, hosting.slug.minted-on-root-share,
  hosting.collection.same-tenant

Nestable, owner-only collections whose access the contained artefacts inherit. (New DDD
bounded context: `ddd/artefact-collections.md`; amends `ddd/artefact-hosting.md` —
`Artefact.collectionId`, effective access (`hosting.access.effective-from-tree-root`), slug on
effective share (`hosting.slug.minted-on-move-into-shared-tree`,
`hosting.slug.minted-on-root-share`).)

- **Domain** — new `Collection` aggregate (`id`, `ownerId`, `tenantId`, `name`, immutable
  `parentId`/`rootId`, `visibility` + `sharedWith` consulted on roots only, `status`, timestamps)
  with pure transitions `createCollection` (`collections.tree.single-owner`,
  `collections.collection.name-required`, `collections.tree.shape-fixed`; `rootId` = own id or
  parent's), `renameCollection`, `setCollectionAccess` (**roots only**,
  `collections.access.set-on-root-only`; reuses the `hosting.access-list.retained`,
  `hosting.access-list.owner-managed-set` access-list semantics), and `moveArtefactToCollection`
  on the Artefact side (tenant match, archived-block). Pure helpers: `effectiveViewable(artefact,
  root)` (`collections.access.contained-own-tier-dormant`) feeding the **unchanged**
  `canViewArtefact`, and `collectSubtree(collections, id)` for cascades. A `CollectionRepository`
  port (`save`, `delete`, `findById`, `listByOwner` (± archived), `listSharedRoots`, `listByRoots`
  — scope-aware like the artefact repository of S22 — Tenant scope + access-policy seam) +
  in-memory double.
- **Commands** — create / rename+access / manage access-list (mirroring S16) / move-artefact (mints
  a slug when the target tree's root is shared and the artefact has none,
  `hosting.slug.minted-on-move-into-shared-tree`, `collections.slug.minted-on-effective-share`; a
  root access change to a shared tier likewise back-fills slugs across the subtree).
- **Persistence** — new `collection` table (+ `collection_access` join table mirroring
  `artefact_access`), `artefact.collection_id` FK column; Drizzle repo; migration. `rootId`
  is denormalized (safe: immutable), so effective access resolves via plain joins, and
  "effectively shared" needs no recursive query: `listShared` adds `collection_id IS NULL`
  (dormancy, `collections.access.contained-own-tier-dormant`) and the shared-composition adds
  artefacts in trees whose root grants the viewer (`listSharedRoots` + `listByRoots` +
  `listByCollectionIds` on the artefact repo).
- **BFF** — `GET/POST /api/collections`, `PATCH /api/collections/:id`,
  `GET/POST/DELETE /api/collections/:id/access(/:userId)`,
  `PUT /api/artefacts/:id/collection`; serve/data/view gates resolve effective access first;
  artefact summaries expose `collectionId` + `effectiveVisibility`.
- **Client** — sidebar shell (hamburger, collections tree with auto-expand + `+`), collection
  page (breadcrumb, access control with inheritance note, `⋯` menu, sub-collection cards,
  scoped sort/kind-chips/density artefact list), add/move-to-collection modal (tree picker +
  inline create + top-level option), create/edit editor, "Inherited" read-only access control +
  "in \<Collection\>" chip on artefact cards.
- **Boundary:** **OSS**. Tenant scope threads through as in S22 — Tenant scope + access-policy
  seam (`tenantId` on the row, scope-aware reads); the EE pg schema mirrors the new tables (parity
  check).

All owner-scoped (`collections.authority.owner-only`, `collections.access.no-existence-leak`);
`requireAuth` + tenant scope as everywhere else:

| Method | Path | Purpose |
| -------- | ------ | --------- |
| `GET` | `/api/collections` | Owner's collections (active; `?archived=true` for the archive view, S26) |
| `POST` | `/api/collections` | Create (`name`, optional `description` (S74), optional `parentId`, optional `visibility` — roots only) |
| `PATCH` | `/api/collections/:id` | Rename; describe (`description`, S74); change access (`visibility`, roots only; `linkGate?` with `visibility: public`, S32b) |
| `GET/POST/DELETE` | `/api/collections/:id/access(/:userId)` | `selected`-tier access list, mirroring the artefact endpoints (roots only) |
| `PUT` | `/api/artefacts/:id/collection` | Move artefact (`{ collectionId \| null }`); owner-only; mints a slug per `collections.slug.minted-on-effective-share` |

Artefact summaries (owner list, detail) additionally expose `collectionId` and the resolved
`effectiveVisibility` so the client can render the "Inherited" state and the "in
\<Collection\>" chip without re-deriving policy.

**Acceptance:** each criterion restates a requirement the slice delivers:

- A private artefact moved into an `authenticated`-root tree is viewable by another signed-in user
  (and got a slug); moved back to top level it is private again (own tier resurfaces, slug
  retained) (`hosting.access.effective-from-tree-root`,
  `collections.access.contained-own-tier-dormant`, `hosting.slug.minted-on-move-into-shared-tree`).
- An artefact whose *own* tier is `public` inside a `private` tree is **not** viewable by others
  and absent from "Shared with you" (`collections.access.contained-own-tier-dormant`,
  `hosting.shared.lists-effectively-shared`).
- Changing a root to `selected` + granting a member makes subtree artefacts viewable by that member
  only (`collections.access.root-governs-tree`).
- `setCollectionAccess` on a non-root, and a tier given at create together with a parent, are
  rejected (`collections.access.set-on-root-only`).
- A child created under another owner's or an archived collection is rejected
  (`collections.tree.single-owner`, `collections.lifecycle.archived-inert`).
- Non-owner collection reads/mutations → uniform 404 (`collections.access.no-existence-leak`).
- All existing Hosting tests stay green (top-level artefacts behave byte-identically).

r[collections.access-dialog.no-stale-results]
In a collection's people-only access dialog, directory results of an older query are never shown.

### S26 — Collection lifecycle (cascade archive / restore / delete + Archive view)

- **Status:** done
- **Depends on:** S15, S25
- **Delivers:** collections.lifecycle.archive-cascades, collections.lifecycle.restore-cascades,
  collections.lifecycle.restore-under-active-parent, collections.lifecycle.delete-archived-only,
  collections.lifecycle.delete-cascades

- **Commands** — `archiveCollectionCommand` (archive every descendant collection + active
  artefact in the subtree; returns cascade counts for the toast), `restoreCollectionCommand`
  (restores the subtree, including previously individually-archived artefacts — documented
  simplification), `deleteCollectionCommand` (archived-only,
  `collections.lifecycle.delete-archived-only`: per-artefact full delete — payload file + data
  entries + view entries + bookmarks — then the collections; FK cascades as backstop).
- **BFF** — `POST /api/collections/:id/archive|restore`, `DELETE /api/collections/:id`;
  `GET /api/collections?archived=true`.
- **Client** — the dashboard's inline archived section is replaced by the sidebar **Archive
  view**: archived subtree tops + individually-archived loose artefacts, each with Restore /
  Delete permanently; archive toasts carry the cascade count + **Undo** (restore); the
  permanent-delete confirm names the cascade (N artefacts, M sub-collections, including
  already-archived descendants).
- **Boundary:** **OSS**.

| Method | Path | Purpose |
| -------- | ------ | --------- |
| `POST` | `/api/collections/:id/archive` | Archive with cascade; returns cascade counts for the toast |
| `POST` | `/api/collections/:id/restore` | Restore the subtree |
| `DELETE` | `/api/collections/:id` | Permanent delete with cascade (archived-only); 204 |

**Acceptance:** each criterion restates a requirement the slice delivers:

- Archiving a collection archives all descendant collections/artefacts (archived artefacts stop
  serving, `hosting.lifecycle.archived-not-served`) (`collections.lifecycle.archive-cascades`).
- Restore brings the subtree back at prior tiers; an artefact archived individually then caught in
  a collection archive restores with the collection (`collections.lifecycle.restore-cascades`).
- Restoring a collection, or an artefact, under an archived collection is refused, naming the
  topmost archived collection in its chain, and restores nothing: `POST /api/collections/:id/restore`
  and `POST /api/artefacts/:id/restore` answer `400` naming them by name only, the connector by id
  and name (`collections.lifecycle.restore-under-active-parent`).
- Delete of an active collection is rejected (`collections.lifecycle.delete-archived-only`).
- Delete removes descendant rows, payload files, data entries, view entries, bookmarks
  (`collections.lifecycle.delete-cascades`).

### S27 — Bookmarks (per-user pins)

- **Status:** done
- **Depends on:** S25
- **Delivers:** collections.bookmark.set-semantics, collections.bookmark.artefact-view-gated,
  collections.bookmark.collection-view-gated, collections.bookmark.hidden-not-pruned,
  collections.bookmark.removed-with-target

The S25 edge is for bookmarkable collections; artefact bookmarks alone would only need S10.

- **Domain** — a thin per-user store mirroring the S21 pattern: `Bookmark` records
  (`userId`, artefact **or** collection target), `BookmarkRepository` port (`listByUser`,
  `add`, `remove`, `deleteByArtefact`, `deleteByCollection`) + in-memory double. Set
  semantics (`collections.bookmark.set-semantics`); adds are gated on *effective view access* in
  the command (`collections.bookmark.artefact-view-gated`,
  `collections.bookmark.collection-view-gated` — anything you can view; removes ungated).
- **Persistence** — `artefact_bookmark` + `collection_bookmark` join tables (`user_id`,
  target id, `created_at`; PK on the pair; FK `ON DELETE CASCADE`).
- **BFF** — the endpoints below. Permanent deletes (S15/S26) also remove bookmark rows
  (`collections.bookmark.removed-with-target`).
- **Client** — sidebar **Bookmarks** section (collections before artefacts, one-click
  remove), `⋯` menu **Bookmark / Remove bookmark**, a bookmark toggle on "Shared with you"
  cards/rows, a toggle on the collection page header, bookmark badges on cards/rows and tree
  nodes. Archived / no-longer-viewable targets hidden at read
  (`collections.bookmark.hidden-not-pruned`); a bookmarked artefact you don't own opens via its
  slug link.
- **Boundary:** **OSS**.

| Method | Path | Purpose |
| -------- | ------ | --------- |
| `GET` | `/api/bookmarks` | The caller's bookmarks, resolved to the live targets they can still view (artefact and collection summaries) |
| `PUT/DELETE` | `/api/artefacts/:id/bookmark` | Bookmark / unbookmark a viewable artefact (remove is ungated) |
| `PUT/DELETE` | `/api/collections/:id/bookmark` | Bookmark / unbookmark a viewable collection |

**Acceptance:** each criterion restates a requirement the slice delivers:

- Bookmark add/remove is idempotent; the list returns only the caller's bookmarks
  (`collections.bookmark.set-semantics`).
- Bookmarking a viewable shared artefact succeeds; bookmarking a non-viewable one is a uniform 404
  (`hosting.access.no-existence-leak`); removing survives lost access
  (`collections.bookmark.artefact-view-gated`, `collections.bookmark.collection-view-gated`).
- Archived or no-longer-viewable targets drop out of the list and return on restore/re-share
  (`collections.bookmark.hidden-not-pruned`).
- Permanent delete removes the rows (`collections.bookmark.removed-with-target`).

### S28 — Shared collections are viewer-facing (read-only)

- **Status:** done
- **Depends on:** S25
- **Delivers:** collections.read.follows-root, collections.access.no-existence-leak

Relaxes the audience of `collections.access.no-existence-leak` to `collections.read.follows-root`.

- **Query** — `listSharedCollections(viewerId, scope)`: the shared roots
  (`listSharedRoots`) the read decision grants (`collections.read.follows-root` — the access
  policy and the root's link gate, with the request's passes) expanded to full trees
  (`listByRoots`); every node returned with the
  root owner's display identity and a `canContribute` flag
  (`collections.contributor.on-root-access-list`) — never the grantee list. No new ports; no
  schema change.
- **BFF** — the endpoint below (signed-in). The flat artefact list at `GET /api/shared` is
  unchanged (**both-way listing**).
- **Client** — "Shared with you" gains a **Collections** section (cards, opening the
  collection page); the collection page works read-only for non-owners: breadcrumb within
  the shared tree, effective-tier label (not editable), bookmark toggle, sub-collection
  cards, and a mixed artefact list (others' artefacts with owner attribution; the viewer's
  own contributions as normal cards). Bookmarked shared collections open this page.
- **Boundary:** **OSS**.

| Method | Path | Purpose |
| -------- | ------ | --------- |
| `GET` | `/api/shared/collections` | Trees shared *to* the caller: every node of every granting tree, each carrying `canContribute` and the owner's display identity — never the grantee list |

**Acceptance:** each criterion restates a requirement the slice delivers:

- A member/`authenticated` viewer lists and opens the tree; anonymous requests never see a
  collection in the app (S44's root-slug read aside); recipients get empty `sharedWith`; an
  archived root's tree reads 404 (`collections.read.follows-root`).
- A stranger's read of any node in a non-granting tree is a uniform 404
  (`collections.access.no-existence-leak`).

### S29 — Contributors + evict-on-cascade

- **Status:** done
- **Depends on:** S28
- **Delivers:** collections.contributor.on-root-access-list, collections.containment.co-owned,
  collections.lifecycle.cascades-evict-foreign, hosting.collection.move-into-own-or-contributed

Relaxes `collections.tree.single-owner`'s artefact placement to contributors.

- **Domain** — `authorizeCollectionRead` (the artefact read decision on the root: the matrix
  under the access policy, then the root's link gate; signed-in only, archived → no one) and
  `canContributeToTree(root, userId, canRead)` (owner, or listed **and** granted the read);
  `moveArtefactToCollection` drops the same-owner requirement (tenant + active checks stay;
  authority moves to the command); `evictFromCollection` — guard-free containment termination
  (works on archived artefacts; `collections.containment.co-owned`,
  `collections.lifecycle.cascades-evict-foreign`).
- **Commands** — move-in gate becomes: artefact owner **and** (own collection or
  contributor of the target's root); create-in = create + move-in (no create change).
  New eject command (collection-owner-only, direct containment). Archive/delete cascades
  **evict foreign artefacts first** (any status), then cascade over the owner's own;
  cascade counts report `evicted` alongside. Collection bookmarks gate on the same read decision.
- **BFF** — the endpoint below; the owner-list read path drops its "containers are all mine"
  batching assumption (a contributed artefact's container belongs to someone else — resolve those
  roots by id).
- **Client** — "New artefact" from a contributable collection page uploads then moves in;
  the add/move-to-collection picker gains a "Shared with you" group of contributable trees;
  the collection owner sees **Remove from collection** in a foreign artefact's "…" menu; toasts
  name evictions ("… archived with N artefacts · M returned to their owners").
- **Boundary:** **OSS**. No schema change (contributors ride `collection_access`).

| Method | Path | Purpose |
| -------- | ------ | --------- |
| `DELETE` | `/api/collections/:id/artefacts/:artefactId` | Eject an artefact from the caller's collection to top level (collection-owner-only) |

**Acceptance:** each criterion restates a requirement the slice delivers:

- A listed member creates/moves their artefact into the tree (slug minted per
  `collections.slug.minted-on-effective-share` when the root is shared) and it appears for every
  viewer both flat and in the tree; an unlisted `authenticated` viewer's move-in is rejected 404
  (`collections.contributor.on-root-access-list`,
  `hosting.collection.move-into-own-or-contributed`, `hosting.access.no-existence-leak`).
- The collection owner ejects a foreign artefact (falls back to its dormant tier) but cannot
  edit/archive/delete it (`collections.containment.co-owned`).
- Archiving/deleting the collection evicts foreign artefacts (unarchived, undeleted, top-level) and
  cascades only over the owner's own; restore does not re-attach evicted artefacts
  (`collections.lifecycle.cascades-evict-foreign`).

### S44 — Public collection links and anonymous thumbnails

- **Status:** done
- **Depends on:** S25, S28, S32a, S32b, S35, S39
- **Linear:** ALI-394
- **Delivers:** collections.public-link.root-slug-minted,
  collections.public-link.anonymous-tree-read, collections.public-link.anonymous-projection,
  collections.public-link.owner-summary-slug, collections.url.public-tree-read,
  hosting.thumbnail.anonymous-by-slug, hosting.thumbnail.cache-by-audience,
  export.collection.public-slug

A public collection tree a site can list without a login: a root slug, an anonymous read of the
tree by it, and anonymous thumbnails by artefact slug. (DDD amendments:
`ddd/artefact-collections.md` *public collection links* — `collections.read.follows-root` amended;
`ddd/artefact-hosting.md` *anonymous thumbnails* —
`hosting.thumbnail.read-follows-export-matrix` amended; `ddd/deployment-export.md`
format 1.2.)

- **Domain** — `Collection.publicSlug` (`null` at create); a pure `assignCollectionSlug(c, slug)`
  sets it on a slugless root and refuses a non-root. `setCollectionAccess` never touches it
  (retention). `CollectionRepository.findBySlug(slug)` — tenant-global, like the artefact one
  (`hosting.slug.globally-unique`).
- **Commands** — create (a root created shared) and edit (a tier change to a shared tier, in the
  same save) mint the root's slug when it has none, with `mintUniqueSlug` collision-checked
  against the collection repository. A new query `readPublicCollectionTree(slug)` resolves the
  root, applies the gate (root, `public`, active, ungated) and walks the tree scoped by the root's
  own tenant.
- **Persistence** — SQLite: nullable unique `public_slug` on `collection`. Export bundle format
  1.2: `publicSlug` on the collection record, optional to the reader.
- **BFF** — `GET /api/public/collections/:slug`, mounted without `requireAuth`, `Cache-Control:
  public, max-age=300`, one flat 404. The thumbnail route drops `requireAuth`: with a session it
  resolves as before, without one by slug only; its `Cache-Control` follows the audience. The
  owner's collection summaries carry `publicSlug`.
- **Client** — the root's access popover shows a read-only **Public collection id** row with
  a Copy button while the root is `public` and has a slug.
- **Boundary:** **core + ee** — the EE Postgres column, the `app.collection_slug` RLS path and
  the importer ride a separate `ee/` commit.

### S73 — Public collections for an external site: cross-origin read and sign-in/sign-up URLs

- **Status:** done
- **Depends on:** S44, S1, S38, S59
- **Linear:** ALI-602
- **Delivers:** identity.auth-screen.signin-signup-paths

What an external site (the `artefactor.cloud` landing site) needs to list a public collection
from the browser and send a visitor to sign in or sign up. CORS adds no access: the anonymous tree
read already answers anyone with the root slug (`collections.public-link.anonymous-tree-read`,
`collections.public-link.anonymous-projection`); CORS only lets another origin's browser read the
same anonymous answer, never with credentials.

- **BFF** — `GET`/`HEAD /api/public/collections/:slug` and its `OPTIONS` preflight carry Hono's
  `cors` middleware on that path alone, mounted ahead of the session middleware so its errors
  carry it too: `Access-Control-Allow-Origin: *` on every status (the flat 404 included), methods
  `GET, HEAD, OPTIONS`, no credentials, beside the read's `Cache-Control: public, max-age=300`.
  A path under the prefix that names no single slug answers the same JSON 404
  (`collections.url.public-tree-read`), never the SPA's HTML.
  No other route gains CORS.
- **Client** — `/signin` and `/signup` open the auth screen on that tab
  (`identity.auth-screen.signin-signup-paths`, in `identity-access.md`); both are served the SPA
  by the existing fallback, on the app host only. No new server route.
- **Out of scope:** the landing site itself; new fields in the public tree; explicit ordering;
  absolute thumbnail URLs; CORS on any other route or a per-origin allow-list.

**Acceptance:**

r[collections.public-link.cross-origin-read]
The anonymous tree read (`GET`/`HEAD /api/public/collections/:slug`) and its `OPTIONS` preflight
answer any origin with `Access-Control-Allow-Origin: *`, on every status (the 404 included), and
never allow credentials; the preflight answers `204` allowing `GET, HEAD, OPTIONS`. No other route
gains CORS: a credentialed `/api/artefacts` call from another origin gets no
`Access-Control-Allow-Origin`.

### S74 — Collection description

- **Status:** done
- **Depends on:** S25, S44, S39
- **Linear:** ALI-603
- **Delivers:** collections.collection.description, collections.public-link.anonymous-projection, export.collection.description

A collection carries an optional one-line blurb its owner writes, shown on its page and read by the
landing site through the public tree (`collections.collection.description`).

- **Domain** — `Collection.description`, trimmed with whitespace runs (line breaks included)
  collapsed to one space, blank stored as `null`, at most 280 characters once collapsed;
  set at create and by the edit command, so owner authority (`collections.authority.owner-only`)
  and the archived refusal (`collections.lifecycle.archived-inert`) both name describing.
- **Persistence** — a nullable `description` column on `collection`, in both adapters.
- **BFF** — `POST /api/collections` and `PATCH /api/collections/:id` take an optional
  `description`: a string, or `null` to clear; a non-string or an over-limit one answers `400`
  naming the limit; on `PATCH` an absent key leaves it unchanged. `CollectionSummary` carries it.
- **Public tree** — every node carries `description` or `null`
  (`collections.public-link.anonymous-projection`).
- **Export** — format 1.3 (`export.collection.description`).
- **Client** — the collection editor dialog ("Edit details & access", and the owner's More-menu
  item of the same name) gains a **Description** field under Name, a `Textarea` with a live
  "n / 280" counter whose over-limit state blocks Save with an inline error; the collection page
  header renders the description as muted text under the title, before the counts line, and
  nothing when there is none.
- **Out of scope:** rich text or links; descriptions on artefacts; MCP tools for collections;
  descriptions on the Home sidebar, cards or share dialog; the landing site's use of the field.
