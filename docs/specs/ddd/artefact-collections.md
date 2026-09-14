# Bounded Context: Artefact Collections (organization)

Two ways to organize a growing number of artefacts, modeled on Metabase's sidebar:

- **Collections** — a nestable folder tree an owner sorts their artefacts into. A collection
  has the **same access model as an artefact** (`private` / `selected` / `authenticated` /
  `public` + a `sharedWith` access list), and everything inside a collection tree **inherits
  the tree root's access**. Collections archive and permanently delete with a **cascade**.
- **Bookmarks** — a flat, per-user list of pinned artefacts and collections. Pure
  convenience; no access semantics.

**Shared collections are viewable and collaborative (S28/S29).** A collection whose root's
access grants a **signed-in** viewer is a browsable object for them: it appears (with its
tree) in "Shared with you" alongside the flat artefact list (**both-way listing** — the
artefacts stay listed individually too), and its pages are readable. Anonymous users never
browse collections — there are **no collection slugs**; unauthenticated access remains by
artefact link only (the v0.2 rule). **Contributors** — the people on the root's access list
(CL12) — may additionally place artefacts *they own* into the tree. Everything else about a
collection (name, structure, access, lifecycle) remains the owner's alone (CL9).

## Aggregate: `Collection`

Aggregate root. The consistency boundary for one folder node.

| Field | Type | Notes |
| ------- | ------ | ------- |
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
   a child's `ownerId` and `tenantId` equal its parent's. An artefact may be placed in a
   collection by **its own owner only**, into their own collection or — as a **contributor**
   (CL12) — into another owner's; artefact and collection must share a `tenantId`. *(CL1)*
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
10. **No existence leak**: to a user the root does **not** grant, a collection is
    indistinguishable from a missing one (uniform not-found), mirroring AH8. *(CL10)*
11. **Viewer reads follow the root (S28)**: a **signed-in** user whom the root's
    `(visibility, sharedWith)` grants view (the same matrix semantics as artefacts; an
    archived root grants no one) may read the whole tree — nodes, breadcrumbs, contained
    artefacts. Anonymous users never read collections (no collection slugs; artefact links
    only). Recipients never receive the root's grantee list (`sharedWith` ships empty to
    them, as in every shared read). *(CL11)*
12. **Contributors (S29)**: the users on the **root's access list** who can also view the
    tree (so: `sharedWith` members under `selected`/`authenticated`/`public` roots — under a
    `private` root the list grants nothing), plus the owner. A contributor may **create or
    move artefacts they own into any node of the tree** (create-in = create top-level +
    move-in, so AH1–3 and the CL6 slug mint apply unchanged). Contribution is *placement
    only*: rename, structure, access, and lifecycle stay owner-only (CL9); the tiers keep
    pure view semantics — under `authenticated`/`public` roots the access list *is* the
    contributor list. *(CL12)*
13. **Containment is co-owned**: the artefact owner controls the artefact (AH9 — edit,
    visibility-while-top-level, archive, delete, move-out); the collection owner controls
    **membership of their container** and may **eject** any contained artefact to top level
    (regardless of the artefact's status). Ejection is the one cross-aggregate write and it
    only ever *reduces* exposure — the artefact falls back to its dormant own tier. *(CL13)*
14. **Cascades never lifecycle foreign artefacts (S29)**: the archive and delete cascades
    (CL7/CL8) first **evict** every contained artefact not owned by the collection owner —
    to top level, untouched — and then apply only to the owner's own artefacts. Restore
    (CL7) does not re-attach evicted artefacts (they were evicted, not archived). No one's
    artefact is ever archived, deleted, or held unservable by another user's collection
    lifecycle. *(CL14)*

## Invariants — bookmarks

1. **Per-user, set semantics**: a bookmark is a `(userId, target)` pair where target is one
   artefact or one collection; at most one per pair. Adding an existing bookmark and removing
   a missing one are no-ops. *(BM1)*
2. **Anything you can view**: a user may bookmark any artefact they can currently **view**
   (the effective access matrix, CL5/AH20 — their own, or one shared to them at any tier).
   Adding a bookmark to a non-viewable artefact is a uniform not-found (no leak, AH8);
   **removing** one's own bookmark row is always allowed (it is the user's own data — e.g.
   cleanup after access was revoked). Collections follow the same rule via CL11: any
   collection whose root grants the signed-in user view may be bookmarked. *(BM2)*
3. **No access semantics**: bookmarks never affect visibility, serving, or listings other
   than the user's own bookmark list. Targets that are archived **or no longer viewable**
   (access revoked, tier lowered) are **hidden at read time, not pruned** — the row survives,
   and the pin reappears if the target is restored or re-shared. *(BM3)*
4. **Lifecycle-bound**: permanently deleting an artefact or collection removes its bookmark
   rows (FK cascade backstop, explicit delete in the command). *(BM4)*

## Effective-access resolution (read path)

Resolved at read time — single source of truth, no denormalized copy of access onto rows:

```text
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
| -------- | ------ | --------- |
| `GET` | `/api/collections` | Owner's collections (active; `?archived=true` for the archive view) |
| `POST` | `/api/collections` | Create (`name`, optional `parentId`, optional `visibility` — roots only) |
| `PATCH` | `/api/collections/:id` | Rename; change access (`visibility`, roots only) |
| `GET/POST/DELETE` | `/api/collections/:id/access(/:userId)` | `selected`-tier access list, mirroring the artefact endpoints (roots only) |
| `POST` | `/api/collections/:id/archive` | Archive with cascade; returns cascade counts for the toast |
| `POST` | `/api/collections/:id/restore` | Restore the subtree |
| `DELETE` | `/api/collections/:id` | Permanent delete with cascade (archived-only); 204 |
| `PUT` | `/api/artefacts/:id/collection` | Move artefact (`{ collectionId \| null }`); owner-only; mints slug per CL6 |
| `GET` | `/api/bookmarks` | The caller's bookmarks (artefact ids + collection ids) |
| `PUT/DELETE` | `/api/artefacts/:id/bookmark` | Bookmark / unbookmark a viewable artefact (BM2; remove is ungated) |
| `PUT/DELETE` | `/api/collections/:id/bookmark` | Bookmark / unbookmark a viewable collection (BM2/CL11) |
| `GET` | `/api/shared/collections` | Trees shared *to* the caller (CL11): every node of every granting tree, each carrying `canContribute` (CL12) and the owner's display identity — never the grantee list |
| `DELETE` | `/api/collections/:id/artefacts/:artefactId` | Eject an artefact from the caller's collection to top level (CL13; collection-owner-only) |

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

- **Shared collections are viewer-facing for signed-in users (S28)**, listed **both ways**
  in "Shared with you" (browsable trees *and* the flat artefact list). No collection slugs —
  anonymous access stays artefact-link-only.
- **Contribution is gated on the root's access list (S29, CL12)** — not on the view tier —
  so `authenticated`/`public` roots don't invite drive-by additions; the owner names their
  contributors with the same picker used for `selected` viewing.
- **Evict-on-cascade (CL14)**: collection lifecycle never archives or deletes another
  owner's artefact — foreign artefacts are ejected to top level first, falling back to
  their dormant own tier.
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

*None at the context level. Slice-local details are in the FDD spec (S25–S27).*
