# Artefact Collections

### S25 — Collections (folder tree + inherited access)
- **Status:** done
- **Depends on:** S2, S5, S6, S10, S16, S22

Nestable, owner-only collections whose access the contained artefacts inherit. (New DDD
bounded context: `ddd/artefact-collections.md`, invariants CL1–CL10; amends
`ddd/artefact-hosting.md` AH20/AH21 — `Artefact.collectionId`, effective access, slug on
effective share.)
- **Domain** — new `Collection` aggregate (`id`, `ownerId`, `tenantId`, `name`, immutable
  `parentId`/`rootId`, `visibility` + `sharedWith` consulted on roots only, `status`,
  timestamps) with pure transitions `createCollection` (CL1–3; `rootId` = own id or parent's),
  `renameCollection`, `setCollectionAccess` (**roots only**, CL4; reuses the AH13/14 access-list
  semantics), and `moveArtefactToCollection` on the Artefact side (owner/tenant match CL1,
  archived-block). Pure helpers: `effectiveViewable(artefact, root)` (CL5) feeding the
  **unchanged** `canViewArtefact`, and `collectSubtree(collections, id)` for cascades. A
  `CollectionRepository` port (`save`, `delete`, `findById`, `listByOwner` (± archived),
  `listSharedRoots`, `listByRoots` — scope-aware like S22 A2) + in-memory double.
- **Commands** — create / rename+access / manage access-list (mirroring S16) / move-artefact
  (mints a slug when the target tree's root is shared and the artefact has none, AH21/CL6;
  a root access change to a shared tier likewise back-fills slugs across the subtree).
- **Persistence** — new `collection` table (+ `collection_access` join table mirroring
  `artefact_access`), `artefact.collection_id` FK column; Drizzle repo; migration. `rootId`
  is denormalized (safe: immutable), so effective access resolves via plain joins, and
  "effectively shared" needs no recursive query: `listShared` adds `collection_id IS NULL`
  (dormancy, CL5) and the shared-composition adds artefacts in trees whose root grants the
  viewer (`listSharedRoots` + `listByRoots` + `listByCollectionIds` on the artefact repo).
- **BFF** — `GET/POST /api/collections`, `PATCH /api/collections/:id`,
  `GET/POST/DELETE /api/collections/:id/access(/:userId)`,
  `PUT /api/artefacts/:id/collection`; serve/data/view gates resolve effective access first;
  artefact summaries expose `collectionId` + `effectiveVisibility`.
- **Client** — sidebar shell (hamburger, collections tree with auto-expand + `+`), collection
  page (breadcrumb, access control with inheritance note, `⋯` menu, sub-collection cards,
  scoped sort/kind-chips/density artefact list), add/move-to-collection modal (tree picker +
  inline create + top-level option), create/edit editor, "Inherited" read-only access control
  + "in \<Collection\>" chip on artefact cards.
- **Acceptance:** a private artefact moved into an `authenticated`-root tree is viewable by
  another signed-in user (and got a slug); moved back to top level it is private again (own
  tier resurfaces, slug retained); an artefact whose *own* tier is `public` inside a `private`
  tree is **not** viewable by others and absent from "Shared with you"; changing a root to
  `selected` + granting a member makes subtree artefacts viewable by that member only;
  `setCollectionAccess` on a non-root is rejected; a child created under another owner's or an
  archived collection is rejected; non-owner collection reads/mutations → uniform 404 (CL10);
  all existing Hosting tests stay green (top-level artefacts behave byte-identically).
- **Boundary:** **OSS**. Tenant scope threads through like S22 A2 (`tenantId` on the row,
  scope-aware reads); the EE pg schema mirrors the new tables (parity check).

### S26 — Collection lifecycle (cascade archive / restore / delete + Archive view)
- **Status:** done
- **Depends on:** S15, S25

(CL7/CL8.)
- **Commands** — `archiveCollectionCommand` (archive every descendant collection + active
  artefact in the subtree; returns cascade counts for the toast), `restoreCollectionCommand`
  (restores the subtree, including previously individually-archived artefacts — documented
  simplification), `deleteCollectionCommand` (archived-only, CL8: per-artefact full delete —
  payload file + data entries + view entries + bookmarks — then the collections; FK cascades
  as backstop).
- **BFF** — `POST /api/collections/:id/archive|restore`, `DELETE /api/collections/:id`;
  `GET /api/collections?archived=true`.
- **Client** — the dashboard's inline archived section is replaced by the sidebar **Archive
  view**: archived subtree tops + individually-archived loose artefacts, each with Restore /
  Delete permanently; archive toasts carry the cascade count + **Undo** (restore); the
  permanent-delete confirm names the cascade (N artefacts, M sub-collections, including
  already-archived descendants).
- **Acceptance:** archiving a collection archives all descendant collections/artefacts
  (archived artefacts stop serving, AH7); restore brings the subtree back at prior tiers;
  delete of an active collection is rejected (archived-only); delete removes descendant rows,
  payload files, data entries, view entries, bookmarks; an artefact archived individually then
  caught in a collection archive restores with the collection.
- **Boundary:** **OSS**.

### S27 — Bookmarks (per-user pins)
- **Status:** done
- **Depends on:** S25

The S25 edge is for bookmarkable collections; artefact bookmarks alone would only need S10. (BM1–4.)
- **Domain** — a thin per-user store mirroring the S21 pattern: `Bookmark` records
  (`userId`, artefact **or** collection target), `BookmarkRepository` port (`listByUser`,
  `add`, `remove`, `deleteByArtefact`, `deleteByCollection`) + in-memory double. Set
  semantics (BM1); adds are gated on *effective view access* in the command (BM2 —
  anything you can view; removes ungated; collections degenerate to own, CL10).
- **Persistence** — `artefact_bookmark` + `collection_bookmark` join tables (`user_id`,
  target id, `created_at`; PK on the pair; FK `ON DELETE CASCADE`).
- **BFF** — `GET /api/bookmarks`; `PUT/DELETE /api/artefacts/:id/bookmark`;
  `PUT/DELETE /api/collections/:id/bookmark`. Permanent deletes (S15/S26) also remove
  bookmark rows (BM4).
- **Client** — sidebar **Bookmarks** section (collections before artefacts, one-click
  remove), `⋯` menu **Bookmark / Remove bookmark**, a bookmark toggle on "Shared with you"
  cards/rows, a toggle on the collection page header, bookmark badges on cards/rows and tree
  nodes. Archived / no-longer-viewable targets hidden at read (BM3); a bookmarked artefact
  you don't own opens via its slug link.
- **Acceptance:** bookmark add/remove is idempotent; bookmarking a viewable shared artefact
  succeeds; bookmarking a non-viewable one is a uniform 404 (BM2/AH8); removing survives lost
  access; the list returns only the caller's bookmarks; archived or no-longer-viewable
  targets drop out of the list and return on restore/re-share; permanent delete removes the
  rows.
- **Boundary:** **OSS**.

### S28 — Shared collections are viewer-facing (read-only)
- **Status:** done
- **Depends on:** S25

(CL11; relaxes CL10's audience.)
- **Query** — `listSharedCollections(viewerId, scope)`: the shared roots
  (`listSharedRoots`) expanded to full trees (`listByRoots`); every node returned with the
  root owner's display identity and a `canContribute` flag (CL12) — never the grantee list.
  No new ports; no schema change.
- **BFF** — `GET /api/shared/collections` (signed-in). The flat artefact list at
  `GET /api/shared` is unchanged (**both-way listing**).
- **Client** — "Shared with you" gains a **Collections** section (cards, opening the
  collection page); the collection page works read-only for non-owners: breadcrumb within
  the shared tree, effective-tier label (not editable), bookmark toggle, sub-collection
  cards, and a mixed artefact list (others' artefacts with owner attribution; the viewer's
  own contributions as normal cards). Bookmarked shared collections open this page.
- **Acceptance:** a member/`authenticated` viewer lists and opens the tree; a stranger's
  read of any node in a non-granting tree is a uniform 404 (CL10); anonymous requests never
  see a collection; recipients get empty `sharedWith`; an archived root's tree reads 404.
- **Boundary:** **OSS**.

### S29 — Contributors + evict-on-cascade
- **Status:** done
- **Depends on:** S28

(CL1 relaxed; CL12/CL13/CL14.)
- **Domain** — pure `canViewCollection(root, viewerId)` (matrix semantics, signed-in only,
  archived → no one) and `canContributeToTree(root, userId)` (owner, or listed **and**
  viewing); `moveArtefactToCollection` drops the same-owner requirement (tenant + active
  checks stay; authority moves to the command); `evictFromCollection` — guard-free
  containment termination (works on archived artefacts; CL13/CL14).
- **Commands** — move-in gate becomes: artefact owner **and** (own collection or
  contributor of the target's root); create-in = create + move-in (no create change).
  New eject command (collection-owner-only, direct containment). Archive/delete cascades
  **evict foreign artefacts first** (any status), then cascade over the owner's own;
  cascade counts report `evicted` alongside. Collection bookmarks gate on `canViewCollection`.
- **BFF** — `DELETE /api/collections/:id/artefacts/:artefactId`; the owner-list read path
  drops its "containers are all mine" batching assumption (a contributed artefact's
  container belongs to someone else — resolve those roots by id).
- **Client** — "New artefact" from a contributable collection page uploads then moves in;
  the add/move-to-collection picker gains a "Shared with you" group of contributable trees;
  the collection owner sees **Remove from collection** on foreign artefact cards; toasts
  name evictions ("… archived with N artefacts · M returned to their owners").
- **Acceptance:** a listed member creates/moves their artefact into the tree (slug minted
  per CL6 when the root is shared) and it appears for every viewer both flat and in the
  tree; an unlisted `authenticated` viewer's move-in is rejected 404 (CL12/AH8); the
  collection owner ejects a foreign artefact (falls back to its dormant tier) but cannot
  edit/archive/delete it; archiving/deleting the collection evicts foreign artefacts
  (unarchived, undeleted, top-level) and cascades only over the owner's own; restore does
  not re-attach evicted artefacts.
- **Boundary:** **OSS**. No schema change (contributors ride `collection_access`).
