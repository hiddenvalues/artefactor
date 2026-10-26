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
browse collections in the app; the one anonymous read is a **public root's tree by its root slug**
(S44, *Amendment — public collection links*), a read-only projection meant for a site built
without a login. Otherwise unauthenticated access remains by artefact link only (the v0.2
rule). **Contributors** — the people on the root's access list
(`collections.contributor.on-root-access-list`) — may additionally place artefacts *they own* into
the tree. Everything else about a collection (name, structure, access, lifecycle) remains the
owner's alone (`collections.authority.owner-only`).

## Aggregate: `Collection`

Aggregate root. The consistency boundary for one folder node. The rules on its fields are the
invariants below.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | CollectionId (uuid) | Identity, assigned at create. |
| `ownerId` | UserId | The BetterAuth user id of the Owner. |
| `tenantId` | TenantId | As on `Artefact` (`hosting.tenant.invisible-to-oss`); OSS: `DEFAULT_TENANT`. |
| `name` | string | Human label. Not unique. |
| `description` | string \| null | S74 — optional plain-text one-line blurb; `null` = none (`collections.collection.description`). |
| `parentId` | CollectionId \| null | Nesting. `null` = top-level (a **root**). |
| `rootId` | CollectionId | The tree root: own `id` for a root, else the parent's `rootId`. Denormalized so effective access resolves without recursion. |
| `visibility` | Visibility | Same enum as `Artefact`. |
| `sharedWith` | Set\<UserId\> | The `selected`-tier access list, as on `Artefact` (`hosting.access-list.retained`, `hosting.access-list.owner-managed-set`). |
| `status` | Status | `active` \| `archived`. |
| `publicSlug` | string \| null | S44 — a root's address; see *Amendment — public collection links*. |
| `linkGate` | LinkGate | The Artefact Hosting link gate (`{ passwordHash, expiresAt, version }`); see *Amendment — link gate on a public root*. |
| `createdAt` / `updatedAt` / `archivedAt` | timestamps | As on `Artefact`. |

`Artefact` (Artefact Hosting) gains **`collectionId: CollectionId | null`** — see the Artefact
Hosting amendment (`hosting.access.effective-from-tree-root`,
`hosting.slug.minted-on-move-into-shared-tree`, `hosting.slug.minted-on-root-share`). `null` =
top-level / not in a collection.

## Invariants — collections

r[collections.tree.single-owner]
**Ownership**: `ownerId` is present and immutable, and so is `tenantId`. A collection tree never
spans owners: a child's
`ownerId` and `tenantId` equal its parent's. Which artefacts a collection may hold is Artefact
Hosting's rule: an artefact is placed by its own owner only, into their own collection or — as a
**contributor** (`collections.contributor.on-root-access-list`) — into another owner's
(`hosting.collection.move-into-own-or-contributed`), and artefact and collection share a `tenantId`
(`hosting.collection.same-tenant`).

r[collections.collection.name-required]
**Name**: non-empty (trimmed).

r[collections.collection.description+2]
**Description**: a collection may carry an optional plain-text, one-line description: trimmed, with
every whitespace run (line breaks included) collapsed to one space, and at most 280 characters once
collapsed; blank is none (`null`). It is set by the owner at create or edit, like the name.

r[collections.tree.shape-fixed]
**Fixed shape**: `parentId` (and therefore `rootId`) is set at create and never changes — **no
re-parenting in v1**. This rules out cycles by construction and makes `rootId` a safe
denormalization. The parent must exist, be **active**, and satisfy `collections.tree.single-owner`
at create time. Artefacts move freely between collections; collections do not.

r[collections.access.root-governs-tree]
**Root governs the subtree**: the **effective access** of every collection and artefact in a tree is
the **root's** `(visibility, sharedWith)`. A non-root collection's own `visibility`/`sharedWith` are
carried but **never consulted** (mirrors how `sharedWith` is carried but unconsulted outside the
`selected` tier, `hosting.access-list.retained`). Changing a root's access changes the effective
access of everything inside, at once.

r[collections.access.set-on-root-only+2]
Changing access is only meaningful — and only allowed — **on a root**; the UI shows nested
collections and contained artefacts as "Inherited". A nested collection is created with **no tier
of its own**: a tier given together with a parent is refused, so the rule holds from creation on.

r[collections.access.contained-own-tier-dormant]
**Effective artefact access**: an artefact with `collectionId = null` is governed by its own
`(visibility, sharedWith)` exactly as before (`hosting.access.matrix`). An artefact inside a
collection is governed by its tree root's — its **own `visibility`/`sharedWith` lie dormant**
(retained verbatim, resurfacing when moved back to top level; the dormant *tier* cannot be changed
while contained, `hosting.access.dormant-tier-frozen`, though the access list may still be curated
per `hosting.access-list.owner-managed-set` — it is simply not consulted). The access matrix itself
(`hosting.access.matrix`, `canViewArtefact`) is unchanged: effective access is **resolved at read
time** into the same viewer-facing slice the matrix already takes.

r[collections.slug.minted-on-effective-share]
**Effectively-shared ⟹ slug** (extends `hosting.slug.shared-has-slug`,
`hosting.slug.minted-once-retained`): when an artefact's *effective* visibility first leaves
`private` — by being **moved into** a tree whose root is shared, or by a root's access **changing**
to a shared tier — a slug is **minted eagerly at that transition** for any contained artefact that
has none (and retained per `hosting.slug.minted-once-retained`). Without this, an effectively shared
artefact would be unreachable ("Shared with you" opens artefacts by slug).

r[collections.lifecycle.archive-cascades]
**Archive cascades down**: archiving a collection archives **every descendant collection and every
active artefact in the subtree** (each via its own archive transition,
`hosting.lifecycle.archived-frozen`).

r[collections.lifecycle.restore-cascades]
Restoring a collection restores the whole subtree. An artefact archived individually *before* the
collection was archived is restored along with it — the cascade does not track provenance
(documented simplification).

r[collections.lifecycle.restore-under-active-parent+2]
Neither a collection nor an artefact under an archived collection is restored on its own: the
restore is refused, naming the topmost archived collection in its chain, whose restore brings it
back with it (`collections.lifecycle.restore-cascades`). Otherwise an active item would sit inside an
inert tree (`collections.lifecycle.archived-inert`). A collection's chain starts at its parent, an
artefact's at its own collection; the owner's tree decides, since a foreign artefact never sits in
an archived tree (`collections.lifecycle.cascades-evict-foreign`). The web app's refusal names the
item and that collection by name only; the connector's also gives their ids.

r[collections.lifecycle.archived-inert+3]
An **archived collection is inert**: no rename, no description change, no access change, no new
children, no artefacts moved in; an eject (`collections.containment.co-owned`) or a cascade eviction
(`collections.lifecycle.cascades-evict-foreign`) still takes an artefact out.

r[collections.lifecycle.delete-archived-only]
**Delete is archived-only**: a collection may be permanently deleted only while `archived`, only by
its owner.

r[collections.lifecycle.delete-cascades]
Deletion removes **every descendant collection and every artefact in the subtree** — each artefact
deleted fully per `hosting.delete.removes-everything` (row, payload file, data entries, view
entries) — plus all bookmarks of the deleted items. Sequential best-effort like
`hosting.delete.removes-everything`, with FK cascades as the DB-level backstop.

r[collections.authority.owner-only+3]
**Owner authority**: only a request authenticated as `ownerId` may create, rename, describe, change
access of, archive, restore, or delete a collection, or eject an artefact from it. Placing an
artefact in a collection is the artefact owner's move, into their own collection or one they
contribute to (`hosting.collection.move-into-own-or-contributed`, `collections.contributor.on-root-access-list`).

r[collections.access.no-existence-leak]
**No existence leak**: to a user the root does **not** grant, a collection is indistinguishable from
a missing one (uniform not-found), mirroring `hosting.access.no-existence-leak`.

r[collections.read.follows-root+2]
**Viewer reads follow the root (S28)**: a **signed-in** user whom the one read decision grants the
root may read the whole tree — nodes, breadcrumbs, contained artefacts. That decision is the one
artefact reads make, with the root standing in for the artefact: the matrix on the root's
`(visibility, sharedWith)` under the `AccessPolicy` (`hosting.access.policy-decided`; an archived
root grants no one), then the root's link gate with the request's pass for the root, for the
audience of `hosting.link-gate.narrows-public-audience`. Every refused outcome reads as missing
(`collections.access.no-existence-leak`): a collection read never answers with a challenge — the
unlock happens at an artefact link, and the root's pass then opens the whole tree. Anonymous users
read a tree only by its **root slug**, only while the root is `public`, active and ungated, and only
as the anonymous projection (`collections.public-link.anonymous-tree-read`, S44); otherwise
artefact links only.
Recipients never receive the root's grantee list (`sharedWith` ships empty to them, as in every
shared read).

r[collections.contributor.on-root-access-list+2]
**Contributors (S29)**: the users on the **root's access list** whom the read decision of
`collections.read.follows-root` also grants the tree (so:
`sharedWith` members under `selected`/`authenticated`/`public` roots — under a `private` root the
list grants nothing), plus the owner. A contributor may **create or move artefacts they own into any
node of the tree** (create-in = create top-level + move-in, so `hosting.artefact.owner-required`,
`hosting.payload.size-bounds`, `hosting.artefact.title-required` and the
`collections.slug.minted-on-effective-share` slug mint apply unchanged). Contribution is *placement
only*: rename, structure, access, and lifecycle stay owner-only (`collections.authority.owner-only`);
the tiers keep pure view semantics — under `authenticated`/`public` roots the access list *is* the
contributor list.

r[collections.containment.co-owned]
**Containment is co-owned**: the artefact owner controls the artefact (`hosting.authority.owner-only`
— edit, visibility-while-top-level, archive, delete, move-out); the collection owner controls
**membership of their container** and may **eject** any contained artefact to top level (regardless
of the artefact's status). Ejection is the one cross-aggregate write and it only ever *reduces*
exposure — the artefact falls back to its dormant own tier.

r[collections.lifecycle.cascades-evict-foreign]
**Cascades never lifecycle foreign artefacts (S29)**: the archive and delete cascades
(`collections.lifecycle.archive-cascades`, `collections.lifecycle.delete-cascades`) first **evict**
every contained artefact not owned by the collection owner — to top level, untouched — and then
apply only to the owner's own artefacts. Restore (`collections.lifecycle.restore-cascades`) does not
re-attach evicted artefacts (they were evicted, not archived). No one's artefact is ever archived,
deleted, or held unservable by another user's collection lifecycle.

## Invariants — bookmarks

r[collections.bookmark.set-semantics]
**Per-user, set semantics**: a bookmark is a `(userId, target)` pair where target is one artefact or
one collection; at most one per pair. Adding an existing bookmark and removing a missing one are
no-ops.

r[collections.bookmark.artefact-view-gated]
**Anything you can view**: a user may bookmark any artefact they can currently **view** (the
effective access matrix, `collections.access.contained-own-tier-dormant`,
`hosting.access.effective-from-tree-root` — their own, or one shared to them at any tier). Adding a
bookmark to a non-viewable artefact is a uniform not-found (no leak,
`hosting.access.no-existence-leak`); **removing** one's own bookmark row is always allowed (it is
the user's own data — e.g. cleanup after access was revoked).

r[collections.bookmark.collection-view-gated+2]
Collections follow the same rule via `collections.read.follows-root`: a collection may be
bookmarked when that read decision grants the signed-in user its root, with the request's passes.

r[collections.bookmark.hidden-not-pruned]
**No access semantics**: bookmarks never affect visibility, serving, or listings other than the
user's own bookmark list. Targets that are archived **or no longer viewable** (access revoked, tier
lowered) are **hidden at read time, not pruned** — the row survives, and the pin reappears if the
target is restored or re-shared.

r[collections.bookmark.removed-with-target]
**Lifecycle-bound**: permanently deleting an artefact or collection removes its bookmark rows (FK
cascade backstop, explicit delete in the command).

## Effective-access resolution (read path)

Resolved at read time — single source of truth, no denormalized copy of access onto rows:

```text
effectiveViewable(artefact, root: Collection | null): ViewableArtefact
  root = null (top-level)  → { status, ownerId, visibility, sharedWith } of the artefact
  root ≠ null              → { status: artefact.status, ownerId: artefact.ownerId,
                               visibility: root.visibility, sharedWith: root.sharedWith }
```

The result feeds the existing `canViewArtefact` unchanged. The root is found in two lookups
(`collectionId → collection.rootId → root`) thanks to the denormalized `rootId`; the serve path
scopes the lookups by the artefact's own `tenantId`. The archive cascade
(`collections.lifecycle.archive-cascades`) keeps an artefact's own `status` consistent with its
tree.

"Shared with you" (S14) becomes **effectively-shared** (`hosting.shared.lists-effectively-shared`):
others' top-level artefacts whose own visibility grants the viewer, **plus** others' artefacts
inside trees whose **root** grants the viewer. Artefacts inside collections are excluded from the
own-visibility query (their own tier is dormant, `collections.access.contained-own-tier-dormant`).
Enforced server-side; the UI merely reflects it.

### Invariants — effective access

r[collections.access.archived-root-serves-nothing]
Belt-and-braces, an **archived root renders the slice archived**: an archived tree serves nothing
even if an artefact inside was restored out of step, e.g. via the artefact-level restore endpoint.

r[collections.access.unresolvable-chain-fails-closed]
An **unresolvable chain fails closed**: an artefact whose collection or tree root cannot be resolved
is treated as `private`.

## Amendment (post-v0.2) — link gate on a public root (S32b)

> **Status:** amends `collections.access.root-governs-tree` (FDD slice **S32b — Link controls on
> public collections: password + expiry**). Carries the Artefact Hosting link gate
> (`hosting.link-gate.narrows-public-audience`, `hosting.link-gate.public-only`) to a collection
> root, so a tree published by its root's `public` tier can be password-protected and expire
> exactly like a top-level public artefact. Never widens access and never changes the tier.

### Invariants — link gate

r[collections.link-gate.root-governs-tree]
A contained artefact's link gate is its tree **root's**: for the audience the gate applies to
(`hosting.link-gate.narrows-public-audience` — viewers admitted solely by the `public` cell), every
artefact in the tree is challenged, expired or open by the root's gate, and the pass that opens it
is the one held for the root, so one unlock opens the whole tree. A contained artefact's own gate is
dormant, retained and applied again once it is moved back to top level; a top-level artefact's own
gate holds for itself.

r[collections.link-gate.public-root-only]
A collection's link gate is set or cleared only by its owner (anyone else is refused as not found,
`collections.access.no-existence-leak`), only on a root, only while that root's tier is `public`
and only while it is active — with the `hosting.link-gate.password-rules` and
`hosting.link-gate.expiry-in-future` rules for the gate itself: a password of 8–128 characters, an
expiry in the future, a password set, change or clear bumping `version` and an expiry-only change
leaving it.

r[collections.link-gate.cleared-leaving-public]
Changing a root's tier away from `public` clears its link gate and bumps `version`, voiding every
pass for the tree; `public → public` is a no-op that keeps it.

r[collections.link-gate.owner-summary-only]
Only the owner's own collection summaries carry the gate, as `{ passwordProtected, expiresAt } |
null`; a summary of a tree shared with the caller never does, and no response carries the
password hash.

## Amendment (post-v0.2) — public collection links (S44)

> **Status:** amends `collections.read.follows-root` (FDD slice **S44 — Public collection links and
> anonymous thumbnails**). Gives a collection root a slug, as an artefact has one
> (`hosting.slug.shared-has-slug`, `hosting.slug.minted-once-retained`,
> `collections.slug.minted-on-effective-share`), so a site built without a login can list a public
> tree. Never widens what a signed-in read sees and never changes a tier.

### Invariants — public collection links

r[collections.public-link.root-slug-minted]
A **root** collection mints a short random slug, collision-checked against the other collection
slugs, on its first transition to any shared tier (`selected`, `authenticated` or `public`) — at
create, for a root created shared, or on a tier change — and keeps it across every later tier
change, `private` included, as an artefact keeps its slug (`hosting.slug.minted-once-retained`). A
non-root never gets one: it is reached through its root. The slug alone grants nothing; every read
still runs the access check.

r[collections.public-link.anonymous-tree-read]
Anyone, an anonymous caller included, may read a tree by its root slug only while the root is
`public`, active and carries no link gate — neither a password nor an expiry
(`collections.link-gate.root-governs-tree`). An unknown slug and a root that is not public, is
archived or is gated all answer the same not-found. Public collections are never listed or
enumerated. Signed-in reads (`collections.read.follows-root`, S28) are unchanged.

r[collections.public-link.anonymous-projection+2]
The anonymous tree read returns node names and descriptions (or `null`) and the tree's structure,
and per artefact its title,
kind, slug, `updatedAt` and thumbnail URL (`/api/artefacts/<slug>/thumbnail?v=<hash>`, or `null`
while none is rendered). Only active nodes and active artefacts that have a slug are listed, a
contributor's as well as the owner's; a contained artefact's own link gate is dormant and the
root's is excluded by the read, so the listing never names a link the gate would challenge. It
never carries an id, the owner (not even a name), an email, an access list, link-gate state, data
or an archived item.

r[collections.public-link.owner-summary-slug]
The owner's own collection summaries carry `publicSlug` — the slug or `null` on a root, `null` on
a non-root; a summary of a tree shared with the caller never does.

## Published language

What a consumer outside the codebase depends on: the anonymous read of a public tree by its root
slug, which a site built without a login lists (S44).

### Invariants — published language

r[collections.url.public-tree-read+2]
`GET /api/public/collections/:slug` answers **without a session**: a public, active, ungated root's
tree as the anonymous projection (`collections.public-link.anonymous-tree-read`,
`collections.public-link.anonymous-projection`), with `Cache-Control: public, max-age=300`; every
failure is the same JSON 404, a path under `/api/public/collections` that names no single slug (a
trailing slash, the bare prefix, an extra segment) included.

## Realized in the client (owner UI)

A hamburger-toggled left **sidebar** (closed by default): Home, the user's **Bookmarks**
(collections before artefacts, one-click remove), the **Collections** tree (chevron
expand/collapse, auto-expand ancestors of the active collection, `+` to create), and an
**Archive** entry with a count. A dedicated **collection page** (breadcrumb, access control
with inheritance note, bookmark toggle, `⋯` menu — edit details & access / new sub-collection /
archive; sub-collection cards; the artefact list reusing the dashboard's sort / kind-filter /
density controls scoped to the collection). The artefact `⋯` menu gains **Bookmark** and
**Add/Move to collection…** (nested tree picker with inline create + "Top level"). The
dashboard's inline archived section is replaced by a full **Archive view** (restore /
delete-permanently, cascade named in the confirm dialog). Artefacts in a collection show
their access control read-only, labelled "Inherited", linking to the collection.

## Relationship to Artefact Hosting

The `Artefact` aggregate stays the access authority for itself; a collection **substitutes the
inputs** to that decision for artefacts inside it (`collections.access.contained-own-tier-dormant`)
— the matrix,
`hosting.access.no-existence-leak`'s no-leak uniformity, and `hosting.authority.owner-only` owner
authority are untouched. `Artefact.collectionId` is specified as an amendment there
(`hosting.access.effective-from-tree-root`, `hosting.slug.minted-on-move-into-shared-tree`,
`hosting.slug.minted-on-root-share`). Data entries and view entries follow the artefact's
*effective* access automatically, because their gates already call the same matrix.

## Decided

- **Shared collections are viewer-facing for signed-in users (S28)**, listed **both ways**
  in "Shared with you" (browsable trees *and* the flat artefact list). Anonymous access is
  artefact links plus, since S44, one read-only projection of a public root's tree by its root
  slug — no in-app collection page for anonymous visitors.
- **Contribution is gated on the root's access list** (S29,
  `collections.contributor.on-root-access-list`) — not on the view tier — so
  `authenticated`/`public` roots don't invite drive-by additions; the owner names their
  contributors with the same picker used for `selected` viewing.
- **Evict-on-cascade** (`collections.lifecycle.cascades-evict-foreign`): collection lifecycle never
  archives or deletes another owner's artefact — foreign artefacts are ejected to top level first,
  falling back to their dormant own tier.
- **Root-governs-subtree inheritance** — one access decision per tree, made at the root
  (`collections.access.root-governs-tree`); nested collections and artefacts are uniformly
  "Inherited". (The design prototype rendered per-collection access with no nesting semantics; the
  brief's "sub-collections inherit their parent's access" wins, in its simplest coherent form.)
- **No re-parenting of collections in v1** (`collections.tree.shape-fixed`) — move artefacts, not
  folders.
- **Bookmarks cover anything you can view** (`collections.bookmark.artefact-view-gated`,
  `collections.bookmark.collection-view-gated`): any viewable artefact — including ones in "Shared
  with you" — plus any collection whose root grants you view. View-gated on add, ungated on remove;
  hidden-not-pruned when access lapses (`collections.bookmark.hidden-not-pruned`).
- **`status` + `archivedAt`**, not a boolean — matches the Hosting lifecycle convention
  (the prototype's `archived: bool` is a demo shorthand).
- **No stored color** — the prototype's folder tint has no picker; the client derives a
  stable hue from the collection id.
- **No MCP surface in v1** — like manage-access and permanent delete, collections are
  UI-only; MCP-created artefacts start top-level. (MCP artefact reads report the effective
  visibility so agents aren't misled.)
- **New artefacts always start top-level** (upload and MCP): `collectionId = null`,
  `private` — unchanged create invariants (`hosting.artefact.owner-required`,
  `hosting.payload.size-bounds`, `hosting.artefact.title-required`).

## Open questions

*None at the context level. Slice-local details are in the FDD spec (S25–S27).*
