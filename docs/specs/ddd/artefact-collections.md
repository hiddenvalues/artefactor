# Bounded Context: Artefact Collections (organization)

Two ways to organize a growing number of artefacts, modeled on Metabase's sidebar:

- **Collections** — a nestable folder tree an owner sorts their artefacts into. A collection
  has the **same access model as an artefact** (`private` / `selected` / `authenticated` /
  `public` + a `sharedWith` access list), and everything inside a collection tree **inherits
  the tree root's access**. Collections archive and permanently delete with a **cascade**.
- **Bookmarks** — a flat, per-user list of pinned artefacts and collections. Pure
  convenience; no access semantics.

**Owner-only in v1.** Collections are the owner's organization tool. Other users never see a
collection as an object: no collection pages for non-owners, no collection grouping in
"Shared with you", no collection slugs. What a collection's access level *does* is set the
**effective access of the artefacts inside it** — those artefacts appear to other users
individually (in "Shared with you", via their slug links), exactly like artefacts shared
directly. Viewer-facing collections are a possible later extension, not part of this context.

## Aggregate: `Collection`

Aggregate root. The consistency boundary for one folder node.

| Field | Type | Notes |
|-------|------|-------|
| `id` | CollectionId (uuid) | Identity. Immutable. |
| `ownerId` | UserId | The BetterAuth user id of the Owner. Immutable. |
| `tenantId` | TenantId | As on `Artefact` (AH17). Immutable; OSS: `DEFAULT_TENANT`. |
| `name` | string | Human label. Required, non-empty. Not unique. |
| `parentId` | CollectionId \| null | Nesting. `null` = top-level (a **root**). **Immutable** — v1 has no re-parenting (see CL3). |
| `rootId` | CollectionId | The tree root: own `id` for a root, else the parent's `rootId`. **Immutable** (derivable because `parentId` is immutable; denormalized so effective access resolves without recursion). |
| `visibility` | Visibility | Same enum as `Artefact`. **Consulted only on a root** (CL4). |
| `sharedWith` | Set\<UserId\> | The `selected`-tier access list, exactly as on `Artefact` (AH13/14 semantics). Consulted only on a root while `visibility = selected`. |
| `status` | Status | `active` \| `archived`. |
| `createdAt` / `updatedAt` / `archivedAt` | timestamps | As on `Artefact`. |

`Artefact` (Artefact Hosting) gains **`collectionId: CollectionId | null`** — see the
Artefact Hosting amendment (AH20/AH21). `null` = top-level / not in a collection.

## Invariants — collections

1. **Ownership**: `ownerId` is present and immutable. A collection tree never spans owners:
   a child's `ownerId` and `tenantId` equal its parent's. An artefact may only be placed in
   a collection with the **same `ownerId`** (and `tenantId`) as the artefact. *(CL1)*
2. **Name**: non-empty (trimmed). *(CL2)*
3. **Fixed shape**: `parentId` (and therefore `rootId`) is set at create and never changes —
   **no re-parenting in v1**. This rules out cycles by construction and makes `rootId` a safe
   denormalization. The parent must exist, be **active**, and satisfy CL1 at create time.
   Artefacts move freely between collections; collections do not. *(CL3)*
4. **Root governs the subtree**: the **effective access** of every collection and artefact in
   a tree is the **root's** `(visibility, sharedWith)`. A non-root collection's own
   `visibility`/`sharedWith` are carried but **never consulted** (mirrors how `sharedWith` is
   carried but unconsulted outside the `selected` tier, AH13). Changing access is therefore
   only meaningful — and only allowed — **on a root**; the UI shows nested collections and
   contained artefacts as "Inherited". Changing a root's access changes the effective access
   of everything inside, at once. *(CL4)*
5. **Effective artefact access**: an artefact with `collectionId = null` is governed by its
   own `(visibility, sharedWith)` exactly as before (AH8). An artefact inside a collection is
   governed by its tree root's — its **own `visibility`/`sharedWith` lie dormant** (retained
   verbatim, resurfacing when moved back to top level; the dormant *tier* cannot be changed
   while contained, though the access list may still be curated per AH14 — it is simply not
   consulted). The access matrix
   itself (AH8, `canViewArtefact`) is unchanged: effective access is **resolved at read time**
   into the same viewer-facing slice the matrix already takes. *(CL5)*
6. **Effectively-shared ⟹ slug** (extends AH4/AH5): when an artefact's *effective* visibility
   first leaves `private` — by being **moved into** a tree whose root is shared, or by a root's
   access **changing** to a shared tier — a slug is **minted eagerly at that transition** for
   any contained artefact that has none (and retained per AH5). Without this, an effectively
   shared artefact would be unreachable ("Shared with you" opens artefacts by slug). *(CL6)*
7. **Archive cascades down**: archiving a collection archives **every descendant collection
   and every active artefact in the subtree** (each via its own archive transition, AH7).
   Restoring a collection restores the whole subtree. An artefact archived individually
   *before* the collection was archived is restored along with it — the cascade does not
   track provenance (documented simplification). An **archived collection is inert**: no
   rename, no access change, no new children, no artefacts moved in or out. *(CL7)*
8. **Delete is archived-only and cascades**: a collection may be permanently deleted only
   while `archived`, only by its owner. Deletion removes **every descendant collection and
   every artefact in the subtree** — each artefact deleted fully per AH11 (row, payload file,
   data entries, view entries) — plus all bookmarks of the deleted items. Sequential
   best-effort like AH11, with FK cascades as the DB-level backstop. *(CL8)*
9. **Owner authority**: only a request authenticated as `ownerId` may create, rename, change
   access of, archive, restore, or delete a collection, or move artefacts in/out of it. *(CL9)*
10. **No existence leak**: to a non-owner, a collection is indistinguishable from a missing
    one (uniform not-found), mirroring AH8. Collections never appear in any non-owner
    listing. *(CL10)*

## Invariants — bookmarks

1. **Per-user, set semantics**: a bookmark is a `(userId, target)` pair where target is one
   artefact or one collection; at most one per pair. Adding an existing bookmark and removing
   a missing one are no-ops. *(BM1)*
2. **Anything you can view**: a user may bookmark any artefact they can currently **view**
   (the effective access matrix, CL5/AH20 — their own, or one shared to them at any tier).
   Adding a bookmark to a non-viewable artefact is a uniform not-found (no leak, AH8);
   **removing** one's own bookmark row is always allowed (it is the user's own data — e.g.
   cleanup after access was revoked). Collections are owner-only *objects* in v1 (CL10), so
   for collections this degenerates to "your own" until collections become viewer-facing. *(BM2)*
3. **No access semantics**: bookmarks never affect visibility, serving, or listings other
   than the user's own bookmark list. Targets that are archived **or no longer viewable**
   (access revoked, tier lowered) are **hidden at read time, not pruned** — the row survives,
   and the pin reappears if the target is restored or re-shared. *(BM3)*
4. **Lifecycle-bound**: permanently deleting an artefact or collection removes its bookmark
   rows (FK cascade backstop, explicit delete in the command). *(BM4)*

## Effective-access resolution (read path)

Resolved at read time — single source of truth, no denormalized copy of access onto rows:

```
effectiveViewable(artefact, root: Collection | null): ViewableArtefact
  root = null (top-level)  → { status, ownerId, visibility, sharedWith } of the artefact
  root ≠ null              → { status: artefact.status, ownerId: artefact.ownerId,
                               visibility: root.visibility, sharedWith: root.sharedWith }
```

The result feeds the existing `canViewArtefact` unchanged. The root is found in two lookups
(`collectionId → collection.rootId → root`) thanks to the denormalized `rootId`; the serve
path scopes the lookups by the artefact's own `tenantId`. The archive cascade (CL7) keeps an
artefact's own `status` consistent with its tree, and belt-and-braces, an **archived root
renders the slice archived** (an archived tree serves nothing even if an artefact inside was
restored out of step, e.g. via the artefact-level restore endpoint) and an **unresolvable
chain fails closed** (treated as `private`).

"Shared with you" (S14) becomes **effectively-shared**: others' top-level artefacts whose own
visibility grants the viewer, **plus** others' artefacts inside trees whose **root** grants
the viewer. Artefacts inside collections are excluded from the own-visibility query (their
own tier is dormant, CL5). Enforced server-side; the UI merely reflects it.

## BFF endpoints

All owner-scoped (CL9/CL10) unless noted; `requireAuth` + tenant scope as everywhere else.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/collections` | Owner's collections (active; `?archived=true` for the archive view) |
| `POST` | `/api/collections` | Create (`name`, optional `parentId`, optional `visibility` — roots only) |
| `PATCH` | `/api/collections/:id` | Rename; change access (`visibility`, roots only) |
| `GET/POST/DELETE` | `/api/collections/:id/access(/:userId)` | `selected`-tier access list, mirroring the artefact endpoints (roots only) |
| `POST` | `/api/collections/:id/archive` | Archive with cascade; returns cascade counts for the toast |
| `POST` | `/api/collections/:id/restore` | Restore the subtree |
| `DELETE` | `/api/collections/:id` | Permanent delete with cascade (archived-only); 204 |
| `PUT` | `/api/artefacts/:id/collection` | Move artefact (`{ collectionId | null }`); owner-only; mints slug per CL6 |
| `GET` | `/api/bookmarks` | The caller's bookmarks (artefact ids + collection ids) |
| `PUT/DELETE` | `/api/artefacts/:id/bookmark` | Bookmark / unbookmark a viewable artefact (BM2; remove is ungated) |
| `PUT/DELETE` | `/api/collections/:id/bookmark` | Bookmark / unbookmark an owned collection |

Artefact summaries (owner list, detail) additionally expose `collectionId` and the resolved
`effectiveVisibility` so the client can render the "Inherited" state and the "in
\<Collection\>" chip without re-deriving policy.

## Realized in the client (owner UI)

A hamburger-toggled left **sidebar** (closed by default): Home, the user's **Bookmarks**
(collections before artefacts, one-click remove), the **Collections** tree (chevron
expand/collapse, auto-expand ancestors of the active collection, `+` to create), and an
**Archive** entry with a count. A dedicated **collection page** (breadcrumb, access control
with inheritance note, bookmark toggle, `⋯` menu — rename & access / new sub-collection /
archive; sub-collection cards; the artefact list reusing the dashboard's sort / kind-filter /
density controls scoped to the collection). The artefact `⋯` menu gains **Bookmark** and
**Add/Move to collection…** (nested tree picker with inline create + "Top level"). The
dashboard's inline archived section is replaced by a full **Archive view** (restore /
delete-permanently, cascade named in the confirm dialog). Artefacts in a collection show
their access control read-only, labelled "Inherited", linking to the collection.

## Relationship to Artefact Hosting

The `Artefact` aggregate stays the access authority for itself; a collection **substitutes
the inputs** to that decision for artefacts inside it (CL5) — the matrix, AH8's no-leak
uniformity, and AH9 owner authority are untouched. `Artefact.collectionId` is specified as an
amendment there (AH20/AH21). Data entries and view entries follow the artefact's *effective*
access automatically, because their gates already call the same matrix.

## Decided

- **Owner-only collections in v1** — no viewer-facing collection objects (see above).
- **Root-governs-subtree inheritance** — one access decision per tree, made at the root
  (CL4); nested collections and artefacts are uniformly "Inherited". (The design prototype
  rendered per-collection access with no nesting semantics; the brief's "sub-collections
  inherit their parent's access" wins, in its simplest coherent form.)
- **No re-parenting of collections in v1** (CL3) — move artefacts, not folders.
- **Bookmarks cover anything you can view** (BM2): any viewable artefact — including ones in
  "Shared with you" — plus your own collections (collections being owner-only objects, CL10).
  View-gated on add, ungated on remove; hidden-not-pruned when access lapses (BM3).
- **`status` + `archivedAt`**, not a boolean — matches the Hosting lifecycle convention
  (the prototype's `archived: bool` is a demo shorthand).
- **No stored color** — the prototype's folder tint has no picker; the client derives a
  stable hue from the collection id.
- **No MCP surface in v1** — like manage-access and permanent delete, collections are
  UI-only; MCP-created artefacts start top-level. (MCP artefact reads report the effective
  visibility so agents aren't misled.)
- **New artefacts always start top-level** (upload and MCP): `collectionId = null`,
  `private` — unchanged create invariants (AH1–3).

## Open questions

_None at the context level. Slice-local details are in the FDD spec (S25–S27)._
