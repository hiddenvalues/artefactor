# Bounded Context: Artefact Hosting (core)

The core domain: storing trusted HTML artefacts and serving them privately to owners or
publicly by slug.

## Aggregate: `Artefact`

Aggregate root. The consistency boundary for one hosted artefact. The rules on its fields are the
invariants below.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | ArtefactId (uuid) | Identity, assigned at create. |
| `ownerId` | UserId | The BetterAuth user id of the Owner. |
| `title` | string | Human label. |
| `kind` | ArtefactKind | `prototype` \| `slide-deck` \| `form` \| `interactive-doc` \| `other`. Metadata; drives browse grouping. |
| `htmlPayload` | HtmlPayload | Trusted HTML, stored on the **filesystem**. Row holds a reference + byte size + content hash. |
| `visibility` | Visibility | `private` \| `selected` \| `authenticated` \| `public`. |
| `sharedWith` | Set\<UserId\> | The specific users granted view access (consulted only while `visibility = selected`). |
| `publicSlug` | Slug \| null | The artefact's link token, once it has been shared. |
| `status` | Status | `active` \| `archived`. |
| `createdAt` | timestamp | When it was created. |
| `updatedAt` | timestamp | When it last changed. |
| `archivedAt` | timestamp \| null | When it was archived, while it is. |
| `revision` | integer | Concurrency token owned by the repository, not a content version (see *Amendment — save concurrency*). |

### Value objects

- **`ArtefactKind`** — the closed enum above. Pure metadata; used to group and distinguish
  artefacts when browsing.
- **`HtmlPayload`** — trusted HTML, bounded by `MAX_PAYLOAD_BYTES` (**100 MB**), served as-is and
  stored on the filesystem (see Persistence note), not inline in SQLite.
- **`Visibility`** — `private` | `selected` | `authenticated` | `public` (see access matrix below).
  `selected` shares the artefact with an explicit set of registered users (`sharedWith`) —
  a "shared" tier (it mints/retains a slug like the others), but gated by membership of the
  set rather than by login-state.
- **`AccessList`** (`sharedWith`) — the set of `UserId`s granted view access under the
  `selected` tier.
- **`Slug`** — the token in an artefact's share link.
- **`Status`** — `active` | `archived`.

## Invariants

r[hosting.artefact.owner-required]
**Ownership**: `ownerId` is always present and immutable; it references a valid Account.

r[hosting.payload.size-bounds]
**Payload**: `htmlPayload` is non-empty and ≤ `MAX_PAYLOAD_BYTES` (100 MB).

r[hosting.artefact.title-required]
**Title**: non-empty.

r[hosting.kind.closed-set]
**`ArtefactKind`** — closed enum (see above). Pure metadata; used to group/distinguish artefacts
when browsing.

r[hosting.artefact.updated-at-bumped+2]
**`updatedAt`**: every change to an artefact — edit, share, unshare, a change to its access list,
link gate or data visibility, archive, restore, and a move into or out of a collection (an eviction
included) — sets `updatedAt` to the time of that change. A request that changes nothing leaves it
unchanged, with no save: among them unsharing a private artefact, sharing at its current tier, an
edit that changes no field, clearing an unset link gate, granting an existing member, revoking a
non-member, setting the data visibility it already has, moving it to the collection it is already
in, and evicting an artefact that is not in one. Derived state (the thumbnail) never bumps it.

r[hosting.artefact.identity-fixed]
**Identity is fixed**: an artefact's `id` and `createdAt` are set at create, and no later change
alters them.

r[hosting.slug.shared-has-slug]
**Shared ⟹ slug**: if `visibility ∈ {selected, authenticated, public}` then `publicSlug` is
non-null. (A `private` artefact may also carry a slug if it was ever shared.)

r[hosting.slug.minted-once-retained]
**Slug permanence**: a slug is minted the first time visibility leaves `private`, and is
thereafter immutable and **retained** for the life of the artefact — including across
`unshare`/`share` cycles. Re-sharing reuses the same slug.

r[hosting.slug.globally-unique]
**Slug uniqueness**: slugs are globally unique.

r[hosting.slug.random-token]
**Slug shape**: a slug is a short random URL-safe token, never derived from the title or any other
field, so a link can't be guessed from what the artefact is called.

<!-- Archived is inert — split by the site that decides each part. -->

r[hosting.lifecycle.archived-not-served]
An `archived` artefact is **not served** (a signed-in view/slug request returns 404; an
unauthenticated one is redirected to sign-in like any other miss — still never served, see the
matrix).

r[hosting.lifecycle.archived-hidden-from-listings]
An `archived` artefact is hidden from default listings.

r[hosting.lifecycle.archived-frozen]
An `archived` artefact cannot be edited or have its visibility changed until restored.

r[hosting.lifecycle.archived-data-inert]
An `archived` artefact's data entries are likewise inert.

r[hosting.authority.owner-only]
**Owner authority**: only a request authenticated as `ownerId` may edit, change visibility,
archive, or restore an artefact — at any visibility tier.

r[hosting.ingestion.parity]
**Ingestion parity**: artefacts created by **API push** satisfy the exact same invariants as
**manual upload**; there is no privileged path that bypasses them.

<!-- Delete is archived-only — split by the site that decides each part. -->

r[hosting.delete.archived-only]
An artefact may be permanently deleted only while `archived`, only by its owner.

r[hosting.delete.removes-everything+2]
Deletion also removes its payload file, all its data entries, all its view entries (Artefact
Views, `views.lifecycle.removed-with-artefact`), all its comment threads
(`feedback.lifecycle.removed-with-artefact`), and its thumbnail files (*Amendment — Artefact
thumbnails*).

r[hosting.slug.selected-shared-tier]
**Selected ⟹ slug**: `selected` is a shared tier — it mints a slug on the first share and
retains it exactly like `authenticated`/`public` (subsumed by `hosting.slug.shared-has-slug` and
`hosting.slug.minted-once-retained`). The slug link is live only for the owner and members; a
signed-in non-member gets a flat 404, and an unauthenticated visitor is redirected to sign-in (see
the matrix).

r[hosting.access-list.retained]
**Access-list retention**: `sharedWith` is retained verbatim across every visibility transition
(including `unshare` to `private`) and across `archive`/`restore`. It is only *consulted* while
`visibility = selected`; an empty `sharedWith` under `selected` means owner-only (it behaves like
`private` until members are added).

r[hosting.access-list.owner-managed-set]
**Access-list authority & shape**: only the owner may grant/revoke members
(`hosting.authority.owner-only` applies). `sharedWith` is a set (granting an existing member is a
no-op; revoking a non-member is a no-op). The owner cannot be added (they always have access). The
list cannot be changed while `archived` (`hosting.lifecycle.archived-frozen`). Granting a member
does not change the visibility tier.

r[hosting.access-list.owner-never-member]
**The owner is never a member**: `sharedWith` never holds `ownerId`, whichever path changes it — a
single grant or a whole access list saved at once. A change that names the owner is refused, since
the owner always has access.

r[hosting.access-list.members-from-directory]
**Members come from the user directory**: the owner finds a member by searching registered users by
a substring of their **name or email**, and a search never returns the searcher.

## Access matrix (active artefacts)

The table spells out `hosting.access.matrix` per viewer; `→ sign-in` is
`hosting.access.anonymous-sign-in-redirect`.

| visibility | owner | member (in `sharedWith`) | other signed-in user | unauthenticated |
| ------------ | ------- | -------------------------- | ---------------------- | ----------------- |
| `private` | view + edit | — | 404 | → sign-in |
| `selected` | view + edit | view | 404 | → sign-in |
| `authenticated` | view + edit | view | view | → sign-in |
| `public` | view + edit | view | view | view |

Archived artefacts are never served (`hosting.lifecycle.archived-not-served`): a signed-in viewer
(the owner included) gets `404`, an unauthenticated one is redirected to sign-in like any other
miss. The owner reaches an archived artefact only via the "Your artefacts" archived filter to
restore it.

### Invariants — access

r[hosting.access.matrix]
**Access by visibility** *(active artefacts)*: `private` → owner only; `selected` → owner + any
user in `sharedWith`; `authenticated` → any signed-in user; `public` → anyone, no auth. The
table above spells it out per viewer.

r[hosting.access.no-existence-leak+3]
**No existence leak:** on the serving route (`/a/:slug`) the sign-in redirect is **uniform across
every unauthenticated miss**: unknown slug, `private`, `selected`, `authenticated` and archived all
redirect identically. An anonymous probe therefore cannot tell an existing artefact from a missing
one. A route open to anonymous callers that does not redirect (the download,
`mcp.download.not-found`) answers an anonymous miss with a flat `404`; routes behind sign-in answer
every anonymous call with a uniform `401`, before any lookup. Authenticated denials are a flat `404`
for the same reason.

## State / transitions

States are the product of `visibility × status`. Every transition is the owner's
(`hosting.authority.owner-only`); the rules that govern each are named beside it.

| Transition | From | To | Governed by |
| ------------ | ------ | ---- | ------- |
| **create** | — | `active` / `private` | `hosting.create.title-kind-payload`, `hosting.create.owner-is-creator`, `hosting.create.active-private`, `hosting.artefact.owner-required`, `hosting.artefact.title-required`, `hosting.kind.closed-set`, `hosting.payload.size-bounds` |
| **edit** | `active` | `active` (fields updated) | `hosting.edit.fields-and-timestamp`, `hosting.artefact.title-required`, `hosting.kind.closed-set`, `hosting.payload.size-bounds`, `hosting.lifecycle.archived-frozen` |
| **share** | `active` / `private` | `active` / `selected`, `authenticated` or `public` | `hosting.share.sets-tier`, `hosting.slug.shared-has-slug`, `hosting.slug.minted-once-retained`, `hosting.lifecycle.archived-frozen`, `hosting.access.dormant-tier-frozen` |
| **unshare** | `active` / `selected`\|`authenticated`\|`public` | `active` / `private` | `hosting.unshare.sets-private`, `hosting.slug.minted-once-retained`, `hosting.access-list.retained`, `hosting.lifecycle.archived-frozen`, `hosting.access.dormant-tier-frozen` |
| **change tier** | `active` / any shared tier ⇄ any shared tier | (same status) | `hosting.share.sets-tier`, `hosting.lifecycle.archived-frozen`, `hosting.access.dormant-tier-frozen` |
| **grant access** | `active` (any tier) | (same; `sharedWith` += user) | `hosting.access-list.owner-managed-set`, `hosting.access-list.owner-never-member`, `hosting.lifecycle.archived-frozen` |
| **revoke access** | `active` (any tier) | (same; `sharedWith` −= user) | `hosting.access-list.owner-managed-set`, `hosting.lifecycle.archived-frozen` |
| **set sharing** | `active` (any tier) | `active` (tier, `sharedWith`, link gate and `dataVisibility` updated) | composes share/unshare (refused while contained, `hosting.access.dormant-tier-frozen`), grant/revoke access, the link gate (`hosting.link-gate.public-only`) and data visibility (`hosting.data-visibility.owner-set`); *Amendment — set sharing* |
| **archive** | `active` | `archived` | `hosting.lifecycle.archive-active-only`, `hosting.lifecycle.archive-stamps-archived-at` |
| **restore** | `archived` | `active` | `hosting.lifecycle.restore-archived-only`, `hosting.restore.prior-visibility` |
| **delete** | `archived` | — (removed) | `hosting.delete.archived-only`, `hosting.delete.removes-everything` |

Permanent delete is irreversible, so the UI gates it behind an explicit confirmation; soft-delete
(archive) remains the default lifecycle. The data context is owned by the artefact — see
Relationship to Artefact Data.

### Invariants — transitions

r[hosting.create.title-kind-payload]
**Create**: an artefact is created by its owner from at least a title, a kind and an HTML payload,
on every ingestion path (`hosting.ingestion.parity`).

r[hosting.create.owner-is-creator]
**Creator is owner**: a new artefact's `ownerId` is the authenticated principal that creates it,
whichever path it comes through; no create request can name another owner.

r[hosting.create.active-private]
New artefact is `active` / `private`, `publicSlug = null`.

r[hosting.edit.fields-and-timestamp+2]
Owner updates title / kind / payload; `updatedAt` bumps when a field changes.

r[hosting.share.sets-tier]
**Share**: sharing sets `visibility` to the shared tier the owner picks — `selected`,
`authenticated` or `public` — from `private` or from another shared tier.

r[hosting.unshare.sets-private]
**Unshare**: unsharing sets `visibility` to `private`.

r[hosting.lifecycle.archive-active-only]
**Archive guard**: only an `active` artefact can be archived; archiving an archived one is refused.

r[hosting.lifecycle.archive-stamps-archived-at]
**Archive**: archiving sets `status = archived` and stamps `archivedAt` with the time of archiving.
It keeps `visibility`, so restore can return to it.

r[hosting.lifecycle.restore-archived-only]
**Restore guard**: only an `archived` artefact can be restored; restoring an active one is refused.

r[hosting.restore.prior-visibility]
Restore returns it to `active` with prior visibility, clears `archivedAt`. Owner-only.

## Serving model

- The slug route serves the raw HTML for an `active` artefact subject to the access matrix.
- The host shell embeds the payload in a **sandboxed** iframe, and that iframe **is the security
  boundary** (`hosting.frame.sandboxed`, S36): trusted means "served as-is", not "trusted with the
  viewer's session". The artefact runs in an opaque origin, so its JS can't read the session cookie,
  read any `/api` response, or make a state change the API accepts
  (`identity.origin.app-origin-only`). The host chrome follows the viewer's light/dark theme (S45);
  the frame never does (`platform.theme.frame-unthemed`), so an artefact renders exactly as
  authored.
- Forms still persist, with no code change: the served `localStorage` shim posts each change to
  the host shell, which writes it to the backend store under the viewer's session (see
  `artefact-data.md` `data.shim.posts-never-fetches`).
- **Export (S30).** Alongside the render there is a second read path: the **export**, which returns
  the **stored payload**. It is governed by the same matrix as the render
  (`hosting.lifecycle.archived-not-served`, `hosting.access.matrix`,
  `hosting.authority.owner-only`, on the *effective* tier per
  `hosting.access.effective-from-tree-root`): unknown handle, not-viewable, and archived all
  surface as a flat 404. Restore → export → re-archive is the escape hatch for an archived
  artefact. The download's addressing, headers and filename are criteria of S30 — Export artefact
  HTML (GUI download + MCP read-back tools), in `fdd/slices/mcp-connector.md`. The distinction from
  the render is the point: the render injects the localStorage bootstrap and wraps the artefact in
  the host shell, whereas the export
  round-trips through the same create/edit commands and yields the same artefact. A payload
  convention carried *inside* the HTML — such as the declared data schema in `artefact-data.md` —
  therefore travels with the export for free, with no extra plumbing.

### Invariants — serving and export

r[hosting.serve.as-is]
Payloads are **trusted**: served as-is, no sanitization or script stripping (interactive
prototypes keep their JS).

r[hosting.export.byte-identical]
**Download is the stored payload**: the artefact download (S30) returns the artefact's stored
payload byte for byte — exactly what was uploaded or last edited.

r[hosting.export.no-injected-render]
**Download is never the render**: the artefact download (S30) never carries what the render adds —
the localStorage bootstrap, the host shell or anything else injected on serve.

r[hosting.export.archived-not-exported]
**No archived download**: the artefact download (S30) never returns an archived artefact, its owner
included — there is no owner carve-out (`hosting.lifecycle.archived-not-served` keeps archived
inert). The deployment's export bundle is a different path and carries archived artefacts
(`export.format.archived-included`).

## Published language

What a consumer outside the codebase depends on: an artefact's share link and the sign-in redirect
an anonymous visitor gets from it, and the frame routes and response headers of isolated serving
(*Amendment — Isolated artefact serving*).

### Invariants — published language

r[hosting.url.share-link]
**Share link**: an artefact with a slug is addressed by its share link, `/a/<slug>` on the app
origin — the path that serves it, subject to the access matrix. The link stays the same for the
life of the slug (`hosting.slug.minted-once-retained`).

r[hosting.access.anonymous-sign-in-redirect]
**`→ sign-in`** = the unauthenticated visitor is redirected (`302` to `/?returnTo=<artefact
path>`), not shown the artefact. After they authenticate they are re-evaluated against the access
matrix and bounced back to the artefact — so e.g. an org member who has not yet created their
account can open a `Members` (`authenticated`) link instead of hitting a dead 404. A
**signed-in** viewer who is denied still gets a flat `404`.

r[hosting.frame.sandbox-header+2]
**The header travels with every frame response.** `GET /a/:slug/frame`,
`GET /api/artefacts/:id/raw/frame` and the page they answer for an expired frame token all carry
`Content-Security-Policy: sandbox <the flags of hosting.frame.sandboxed>` and
`Referrer-Policy: no-referrer`, so a frame URL opened top-level, or in a popup that escaped the
sandbox, is still opaque. One constant is the single source of the iframe's `sandbox` attribute and
the header. There are no other CSP directives, so CDN libraries and external APIs keep working.

r[hosting.frame.content-host-split+2]
With a content origin set (`hosting.frame.content-origin-separate`), the content host answers only
the two frame routes and `/health`, and the app host answers no frame route. Unset, frames are
served on the app host, isolated by the sandbox alone.

## Relationship to Artefact Data

The `Artefact` aggregate is the access-control authority for its data entries: read access
to an artefact's data follows this context's access matrix, and archiving makes data inert.
The data entries themselves are modelled in `artefact-data.md`.

## Persistence note

**A save is a compare-and-set on `revision`**, not an upsert (*Amendment — save concurrency*).

### Invariants — persistence

r[hosting.payload.on-filesystem]
**Payloads live on the filesystem.** The SQLite row stores metadata plus a **reference** to the
file (path/key), the **byte size**, and a **content hash**. SQLite never holds the 100 MB payload
inline. Filesystem layout and the on-disk root are an S0/S2 concern.

r[hosting.payload.ref-owned-by-one-artefact]
**A payload ref belongs to exactly one artefact.** `PayloadStore.put` stores every call under a
fresh ref, byte-identical content included, and whatever sets an artefact's `payloadRef` uses a
ref it put for that artefact alone. So the edit and permanent-delete commands dispose of an
artefact's old ref without checking whether another artefact holds it, and dedupe by content hash
never spans artefacts.

r[hosting.payload.ref-unique-in-database]
**The database holds at most one artefact row per `payloadRef`.** A unique index on the ref
refuses a write that would make a second row carry it, so a writer that copies another artefact's
ref fails when it saves, not later when an edit or permanent delete removes the shared file. A
migration onto a database that already holds a shared ref fails rather than repairing it: a repair
means copying a payload file, which SQL can't do.

## Listings

An owner browses their own artefacts in "Your artefacts" and others' shared ones in "Shared with
you".

### Invariants — listings

r[hosting.listing.own-only]
**The owner's listing**: an owner's listing holds only that owner's own artefacts, most recently
updated first — active ones by default, archived ones only when asked for
(`hosting.lifecycle.archived-hidden-from-listings`).

r[hosting.shared.others-viewable]
**"Shared with you"** lists other owners' active **top-level** artefacts the viewer may view by
their own tier: `authenticated` and `public` ones, and `selected` ones the viewer is a member of.
The viewer's own artefacts never appear — they are in the owner's listing — and nor does a
`private` one. An artefact inside a collection is listed by its tree root's tier instead, per
`hosting.shared.lists-effectively-shared`; its own tier is dormant
(`hosting.access.effective-from-tree-root`).

r[hosting.listing.signed-in-only+2]
**Unauthenticated access is by direct slug link only** — there is no public browse view beyond a
public collection link's own tree (`collections.public-link.anonymous-projection`). "Shared
with you" (`hosting.shared.others-viewable`, `hosting.shared.lists-effectively-shared`) is for
signed-in users only.

r[hosting.listing.collection-named-only-if-visible]
**A listing names only a collection its viewer can see**: an artefact's card or row names its
collection only when that collection is among the nodes the viewer can open — their own active and
archived trees and the trees shared with them. Otherwise it names no collection.

## Decided

- **Slug = short random URL-safe token, collision-checked** at mint time (regenerate on the
  rare collision); `hosting.slug.random-token`, `hosting.slug.globally-unique`.

## Open questions

*None at the context level. Slice-local details are in the FDD spec.*

## Amendment (post-v0.2) — payload retention is a seam

> **Status:** DDD amendment (FDD slice **S19b — Payload-retention seam**). Introduces an
> extensibility **seam without
> changing OSS behaviour**. A superset can swap the policy to retain prior payloads and offer
> rollback; OSS keeps a single mutable payload.

**Problem.** `edit` replaces `htmlPayload` wholesale (a full replacement, not a patch). Today
the **superseded** payload file is **deleted immediately** after a successful save, so no
history can exist. That one deletion is all that stands between "single mutable payload" and
"rollback".

**Seam.** Disposal of a superseded payload is delegated to a **`PayloadRetentionPolicy`** port,
consulted whenever a newly-stored payload displaces the previous one (on **edit**, and on a
superset's **rollback**):

- `onPayloadSuperseded({ artefactId, superseded, replacement, by, at })` — given the displaced
  payload descriptor (ref + content hash + bytes), decides its fate.
- **OSS default = `DiscardSupersededPayload`.** OSS keeps one payload per artefact, so **this
  amendment does not introduce versioning into OSS** (the v0.2 "Versioning: none" decision
  stands). The seam is the single disposal point, so no other core code changes.
- A **retaining** implementation (closed superset) keeps the displaced payload and records it
  as a historical version (see the EE *Artefact History* context).

**Content addressing.** `HtmlPayload` already carries a `sha256` content hash. That hash is the
natural, stable **version identity** a retaining policy uses, and it lets an identical payload
(e.g. a rollback re-applying an earlier version) **dedupe** to the same stored blob.

### Invariants — retention

r[hosting.retention.invisible-to-core+2]
**Retention is invisible to the core.** Under any policy the `Artefact` aggregate is
unchanged: it has exactly one *current* `htmlPayload` (ref + hash + bytes) as its **head**. Retained
prior payloads, if any, live **outside** this aggregate and are never consulted by the access
matrix, serving, or listing.

r[hosting.retention.default-discards-superseded]
The OSS default policy, `DiscardSupersededPayload`, deletes a superseded payload's file as soon as
the payload that displaced it is saved, so OSS keeps exactly one payload file per artefact.

r[hosting.retention.purged-on-delete]
Permanent delete (`hosting.delete.removes-everything`) erases everything under any policy: it gives
the retention policy the chance to purge every payload it retained for the artefact.

## Amendment (post-v0.2) — `usesStorage` flag

> **Status:** DDD amendment (FDD slice **S20**). Adds a derived metadata flag that drives **host
> chrome only** — never access or persistence behaviour.

**Problem.** The host data-context switcher (S12) renders a "Data context" picker in the chrome
around every served artefact. For an artefact that never persists anything (a static deck, a
prototype with no `localStorage`) the picker is meaningless.

**Field.** `Artefact` gains a derived boolean:

| Field | Type | Notes |
| --- | --- | --- |
| `usesStorage` | boolean | Whether the payload appears to use the persistence API. |

**Use (S12 chrome).** The switcher is shown only when the artefact **could** have multiple data
contexts to choose between: `usesStorage` is true **and** at least one *other* author has a data
entry. `usesStorage = false` lets the shell omit the picker (and skip the authors fetch) up
front; the "≥1 other author" rule additionally hides the useless single-context case and covers
legacy rows (so `usesStorage` may default to `true` with no backfill).

### Invariants — `usesStorage`

r[hosting.uses-storage.chrome-only]
**`usesStorage` is a heuristic for chrome only.** It is detected by a pure scan of the HTML
for the `localStorage` API (a word-boundary match — so `sessionStorage`, which Artefactor does
**not** persist, does not count). It may have rare false negatives (e.g. dynamically constructed
`window['local'+'Storage']`); this is acceptable because it **only decides whether host UI is
shown** — it never gates access (`hosting.access.matrix`), serving, or the data API. The served
artefact's behaviour is identical regardless.

r[hosting.uses-storage.computed-at-create]
Creating an artefact sets `usesStorage` from its uploaded payload.

r[hosting.uses-storage.recomputed-with-payload]
An edit that replaces the payload recomputes `usesStorage` from the new payload; a title- or
kind-only edit leaves it unchanged.

## Amendment (post-v0.2) — tenant scope + access-policy seam

> **Status:** DDD amendment (FDD slice **S22**; EE context `ee/docs/specs/ddd/tenancy.md`). Two thin
> seams that make the deployment **multi-tenant** in a superset, **behaviour-preserving in OSS**
> (one implicit tenant).

**Problem.** OSS is single-tenant *by being one deployment*: `authenticated` means **every**
signed-in user, and list/find queries are global. A multi-tenant superset needs artefacts scoped to
an **organization** and the `authenticated` tier reinterpreted as "within my org" — without forking
the access matrix or the repository.

**Seam (a) — tenant scope.**

- `Artefact` gains **`tenantId`**. OSS default = a single well-known tenant (`DEFAULT_TENANT`), so
  every row shares one tenant and behaviour is byte-identical. Migration adds `tenant_id`
  defaulting to `DEFAULT_TENANT`.
- `ArtefactRepository` list/find operations become **scope-aware**: they take a **`TenantScope`**.
  `findBySlug` stays tenant-global because a slug is the cross-tenant address for public/link
  serving and the mint-time uniqueness check; the per-tier tenant decision for a slug-served
  artefact is the `AccessPolicy`'s (seam b), not the scope's. OSS passes the singleton scope (no
  behavioural change); a superset passes the caller's **active org** (a single tenant per request,
  not an org-set — it maps 1:1 onto the Postgres RLS `SET LOCAL app.tenant_id` backstop). The
  scope is resolved per request by an injected `TenantScopeResolver` (OSS default = the
  singleton), so a superset overrides *which* tenant a request sees without editing core route
  handlers.

**Seam (b) — access policy.**

- The access-matrix decision (who may view an artefact) is delegated to an **`AccessPolicy`** port.
  OSS default = the matrix above. A superset overrides the `authenticated` tier to mean
  "co-member of the artefact's tenant."
- The port asks one question, `grantsAuthenticatedTier(viewerId, tenantId)`. The link gate asks it
  too, about a signed-in non-owner of a `public` artefact
  (`hosting.link-gate.narrows-public-audience`); that answer decides only whether the gate applies,
  never whether the `public` tier admits the viewer.
- The policy is consulted where the **slug capability crosses tenants** (serving and the
  slug-resolved data/viewers reads). Id-addressed reads and collection reads need no policy: they
  resolve through the tenant-scoped repository (seam a), and within a scope the viewer is a
  co-member by construction — collection reads are additionally signed-in only, except the S44
  anonymous projection of a `public` root by its slug, which no `authenticated` cell decides.

### Invariants — tenant scope and access policy

r[hosting.tenant.id-fixed]
An artefact's `tenantId` is set at create, and no later change alters it.

r[hosting.tenant.scope-excludes-other-tenants+2]
`findById`, `listByOwner` and `listShared` take a `TenantScope` and never return a row of another
tenant, except one that a capability reaches across tenants; subordinate data, view and version
reads inherit the scope. A slug is such a capability (`hosting.slug.globally-unique`), so
`findBySlug` is tenant-global. An explicit `sharedWith` grant is one too, so `listShared` may return
another tenant's artefact whose `sharedWith` names the viewer. The thumbnail sweep
(`hosting.thumbnail.sweep-is-system-read`) is a system read outside any scope.

r[hosting.access.policy-asked-last]
The access matrix asks the `AccessPolicy` only about a **signed-in non-owner** requesting the
`authenticated` tier. The anonymous denial, the owner's view of their own artefact, the
`public`/`selected`/`private` semantics, and archived-is-inert
(`hosting.lifecycle.archived-not-served`) are decided by the fixed matrix before the policy is
asked, so no policy can alter them; `hosting.access.no-existence-leak` and
`hosting.authority.owner-only` hold under any policy.

r[hosting.tenant.invisible-to-oss]
**Tenant scope is invisible to OSS.** Under the default singleton tenant + scope, the
aggregate and all behaviour are identical to today; `tenantId` is carried but never discriminates.
Permanent delete (`hosting.delete.removes-everything`) and every per-artefact subordinate (data
entries, view entries, retained versions) are tenant-scoped in a superset.

r[hosting.access.policy-decided]
**Access is policy-decided.** The matrix in this spec is the **OSS default policy**. Only the
`authenticated` tier's meaning is overridable (login-wide ↔ org-wide); `private`/`selected`/`public`
semantics and the `hosting.access.no-existence-leak` uniformity are not.

## Amendment (post-v0.2) — collection membership + effective access

> **Status:** DDD amendment (FDD slices **S25–S27**; context `ddd/artefact-collections.md`).
> Adds folder organization whose access the contained artefacts inherit.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `collectionId` | CollectionId \| null | The collection the artefact lives in; `null` = top-level. Changed by a move, an eject or a cascade's eviction (`collections.containment.co-owned`, `collections.lifecycle.cascades-evict-foreign`). |

**Effective access.** An artefact inside a collection follows its tree root's access, and its own
tier lies dormant. Read paths resolve the effective `(visibility, sharedWith)` first
(`effectiveViewable`, see `artefact-collections.md`) and feed it to the unchanged access matrix.

**Slug on effective share** (extends `hosting.slug.shared-has-slug`,
`hosting.slug.minted-once-retained`). Minting by the artefact's own share is
`hosting.slug.shared-has-slug`. Minting stays eager (at the transition, collision-checked, then
retained per `hosting.slug.minted-once-retained`), so every effectively-shared artefact is
addressable by link.

Archive/restore cascades and permanent-delete cascades from a collection apply this context's own
transitions per artefact (`hosting.lifecycle.archived-frozen`, `hosting.delete.archived-only`) — see
`collections.lifecycle.archive-cascades` and `collections.lifecycle.delete-cascades`.

### Invariants — collection membership

r[hosting.collection.move-into-own-or-contributed]
Only an artefact's owner moves it (`hosting.authority.owner-only`), never while it is archived
(`hosting.lifecycle.archived-frozen`), and only into their own collection or into a tree whose root
lists them as a contributor (`collections.tree.single-owner`,
`collections.contributor.on-root-access-list`). Any other target is refused as not found
(`hosting.access.no-existence-leak`). A collection owner's eject and a cascade's eviction are not
moves: they only take an artefact out to top level, whatever its owner or status
(`collections.containment.co-owned`, `collections.lifecycle.cascades-evict-foreign`).

r[hosting.collection.same-tenant]
An artefact moves only into a collection of its own tenant.

r[hosting.access.effective-from-tree-root]
An artefact with `collectionId = null` behaves exactly as specified above. An artefact inside a
collection is governed by its collection **tree root's** `(visibility, sharedWith)`
(`collections.access.root-governs-tree`, `collections.access.contained-own-tier-dormant`): its
own `visibility`/`sharedWith` lie **dormant** — retained verbatim, consulted again once moved back
to top level. The access matrix (`hosting.access.matrix`) is unchanged; read paths resolve the
effective `(visibility, sharedWith)` first (`effectiveViewable`, see `artefact-collections.md`) and
feed it to the same matrix. `hosting.access.no-existence-leak`'s no-leak uniformity and
`hosting.authority.owner-only`'s owner authority hold under either source.

r[hosting.access.dormant-tier-frozen]
The dormant *tier* cannot be changed while contained (`set visibility` rejects); the access list
may still be curated at any tier per `hosting.access-list.owner-managed-set`, it is simply not
consulted.

r[hosting.shared.lists-effectively-shared]
"Shared with you" (S14) lists **effectively** shared artefacts.

r[hosting.slug.minted-on-move-into-shared-tree]
A slug is minted the first time an artefact's **effective** visibility leaves `private` by being
moved into a shared tree.

r[hosting.slug.minted-on-root-share]
A slug is minted the first time an artefact's **effective** visibility leaves `private` by its tree
root's access changing to a shared tier (`collections.slug.minted-on-effective-share`).

## Amendment (post-v0.2) — payload-size policy seam

> **Status:** DDD amendment (FDD slice **S23**; EE context `ee/docs/specs/ddd/usage-quota.md`).
> Behaviour-preserving in OSS.

**Problem.** The per-artefact cap `MAX_PAYLOAD_BYTES` (**100 MB**, `hosting.payload.size-bounds`) is
a hardcoded constant. The EE *Large Artefacts* add-on needs a tighter default (**10 MB**) liftable
to 100 MB per entitlement — without OSS losing its flat 100 MB.

**Seam.** Extract the cap into a **payload-size policy** consulted by
`createArtefact`/`editArtefact` when validating `HtmlPayload`. **OSS default keeps 100 MB**
(`hosting.payload.size-bounds` unchanged). A superset drives the cap from plan entitlements (10 MB
default, 100 MB with *Large Artefacts*).

### Invariants — payload size

r[hosting.payload.cap-policy-decided]
**Size cap is policy-decided, 100 MB in OSS.** The HtmlPayload invariant
(`hosting.payload.size-bounds`: non-empty, ≤ cap) holds; only the *cap value* is supplied by the
policy. The OSS policy returns the constant 100 MB, so OSS is byte-identical.

## Amendment (post-v0.2) — link gate on public artefacts: password + expiry

> **Status:** DDD amendment (FDD slices **S32a — Link controls on public artefacts: password +
> expiry** and **S32b — Link controls on public collections: password + expiry**). Adds an
> owner-set **link gate** that narrows the `public` tier's extra audience *after* the access
> matrix grants it. Never widens access and never changes the tier.

**Problem.** A `public` artefact is reachable by anyone with its slug (or id alias) for as long as
it stays public. Owners need the two controls every competing host offers on a public link: a
**password** and an **expiry** after which the link stops working — without inventing a fifth
tier, and without gating the teammates the `authenticated` tier already admits.

**Value object.** `Artefact` gains a `linkGate` (and, with S32b, a collection root):

| Field | Type | Notes |
| ------- | ------ | ------- |
| `linkGate.passwordHash` | string \| null | scrypt hash of the owner-set password. `null` = no password. |
| `linkGate.expiresAt` | timestamp \| null | After this instant the gated audience is denied. `null` = never expires. |
| `linkGate.version` | integer | `0` at create. Counts the password changes and departures from `public` that void outstanding passes. |

**Expiry is read-time and never mutates**, and **the gate lives only on `public`**.

**Passes.** A pass is an HMAC-signed (`BETTER_AUTH_SECRET`), httpOnly, SameSite=Lax cookie named for
the gate's holder, carrying `{ holderId, version, exp }`. Unlock attempts are also limited per
client address (`identity.client-ip.unlock-limit`).

### Invariants — link gate

r[hosting.link-gate.evaluation]
A pure `evaluateLinkGate(gate, now, pass)` returns `open` | `expired` | `challenge`: `expired`
once `now ≥ expiresAt` (even with a valid pass), else `challenge` when a password is set and the
pass is absent or carries another `version`, else `open`.

r[hosting.link-gate.narrows-public-audience]
**The gate narrows the public cell's extra audience only.** It is consulted only after the matrix
(`hosting.access.matrix`, on the effective tier of `hosting.access.effective-from-tree-root`, under
the `AccessPolicy` of `hosting.access.policy-decided`) has granted view, only when the **effective
tier is `public`**, and only for a viewer admitted **solely** by the public cell: not the owner, and
not a signed-in viewer the `authenticated` tier would admit under the `AccessPolicy`. In OSS that is
exactly the anonymous visitor; in a multi-tenant superset also a signed-in user of another
organization. It applies to every such read whichever ref form is used (slug or id alias): the host
shell and its frame (a frame token is minted only after the gate, and its redeem re-runs the gate),
the data reads (`data.read.follows-artefact-access`) and writes, the HTML download (S30), the viewer
list (`views.viewers.follows-artefact-access`) and the thumbnail (S35). A contained artefact's
own gate is dormant, like its own tier (`hosting.access.effective-from-tree-root`): its tree root's
gate applies instead (`collections.link-gate.root-governs-tree`).

r[hosting.link-gate.expiry-reads-as-private]
Past `expiresAt` the gated audience sees the artefact **exactly as `private`** (unauthenticated →
sign-in redirect, signed-in → 404; indistinguishable from an unknown or archived slug). Nothing is
unshared: the tier, `sharedWith` and the slug (`hosting.slug.minted-once-retained`) are retained,
so extending or clearing `expiresAt` restores access at the **same URL**.

r[hosting.link-gate.expiry-in-future]
A newly set `expiresAt` lies in the future.

r[hosting.link-gate.no-existence-leak]
**`hosting.access.no-existence-leak` holds under the gate.** Because the gate is evaluated only
after a grant (`hosting.link-gate.narrows-public-audience`), a password challenge is shown only to a
viewer the matrix already admits — for an unauthenticated visitor that means only a `public`
artefact. No probe the matrix denies can tell a gated artefact from a missing one.

r[hosting.link-gate.public-only]
A gate can be set only while the artefact's own tier is `public` — atomically with the change to
`public`, or later while public. Only the owner sets or clears it (`hosting.authority.owner-only`;
a non-owner is refused as not found, `hosting.access.no-existence-leak`), never while archived
(`hosting.lifecycle.archived-frozen`), and only on a top-level artefact (a contained artefact's own
tier and gate are dormant, `hosting.access.effective-from-tree-root`). Setting or clearing a gate
never changes the tier.

r[hosting.link-gate.cleared-leaving-public]
Any change of the tier **away** from `public` clears it and bumps `version`; `public → public` is
a no-op that keeps it.

r[hosting.link-gate.password-rules]
A password is 8–128 characters. Changing only the expiry leaves `version` as it is.

r[hosting.link-gate.correct-password-yields-pass]
Only a correct password yields a pass. A pass is for the gate's holder alone, carries the gate's
current `version` and lasts at most 7 days; it opens the artefacts that holder's gate governs and no
other gated artefact.

r[hosting.link-gate.password-change-voids-pass]
Changing or clearing the password voids a pass, changing only the expiry does not.

r[hosting.link-gate.pass-bounded-by-expiry]
A pass never outlives `expiresAt`.

r[hosting.link-gate.unlock-attempts-limited+2]
Within one running process, at most 10 unlock attempts per holder and client address are allowed in
any 15 minutes; a later attempt in that window is refused. A restart, or eviction once the store
holds 50,000 keys, starts fresh windows.

r[hosting.link-gate.unlock-limit-per-holder]
The unlock limit counts per holder.

r[hosting.link-gate.owner-summary-only]
No response carries `passwordHash` and only owner summaries carry `linkGate`.

r[hosting.link-gate.migrated-rows-ungated]
Migrated rows get null / null / 0 and behave as before.

## Amendment (post-v0.2) — Artefact thumbnails

> **Status:** DDD amendment (FDD slice **S35 — Artefact thumbnails**; renderer isolation, **S37 —
> Isolated thumbnail renderer**). Adds a **derived** preview image per artefact that drives **host
> chrome only** (the dashboard and gallery cards) — never access, serving, listing or the data API.

**Problem.** Cards show only a kind placeholder, so many prototypes or decks look alike until
each is opened. The MCP connector (Path A) has no browser, so a preview must be rendered
server-side from what is stored.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `thumbnailHash` | string \| null | The `payloadHash` the recorded thumbnail was rendered from (`hosting.thumbnail.stale-while-hash-differs`). |

**Isolation, not sanitisation.** To draw an artefact, Chromium runs the uploader's JavaScript, so
a render is treated as hostile code and runs only in an isolated renderer
(`hosting.renderer.only-isolated-renders`). The locked decision "artefacts are trusted HTML, served
as-is" is untouched, and scanning uploaded HTML was rejected (exploits are ordinary,
runtime-assembled JS that no signature matches, while legitimate artefacts do exactly what a
scanner would flag). `docs/renderer-isolation.md` is the operator's view of the same layers.

**Other requirements.** Permanent delete — of the artefact, or of it through a collection's
`collections.lifecycle.delete-cascades` cascade — removes the thumbnail files with everything else (`hosting.delete.removes-everything`).
The link gate's gated reads include the thumbnail (`hosting.link-gate.narrows-public-audience`):
the thumbnail route reuses the download's resolver, so the gate is inherited with S32a, and a card
whose image fails to load falls back to the placeholder. A thumbnail a non-owner reads of a gated
artefact is served `no-store`, so a browser never keeps showing it after the pass expires or is
voided (`hosting.thumbnail.cache-by-audience`).

### Invariants (S35, S37)

r[hosting.thumbnail.stale-while-hash-differs]
`thumbnailHash` is `null` at create and untouched by edit. The artefact's thumbnail is **stale**
while `thumbnailHash ≠ payloadHash`.

r[hosting.thumbnail.host-chrome-only]
The thumbnail is derived host chrome. It never gates access (`hosting.access.matrix`), serving,
listing or the data API.

r[hosting.thumbnail.placeholder-when-missing]
A missing thumbnail always renders the kind placeholder.

r[hosting.thumbnail.never-blocks-command]
Rendering runs **after** the create or edit is persisted and **never blocks or fails** the command:
a disabled, missing, failing or timed-out renderer leaves `thumbnailHash` untouched.

r[hosting.thumbnail.off-without-renderer]
The disabled path is **no renderer configured or reachable**: no isolated renderer URL is set, or
the renderer stays unreachable past its retry budget.

r[hosting.thumbnail.pristine]
A thumbnail is rendered from the **stored payload alone** — no S13 localStorage bootstrap, no S12
shell, no `DataEntry` — so it is a function of `payloadHash` and can never leak anyone's saved
data.

r[hosting.thumbnail.recorded-by-compare-and-set]
A render is recorded **only** by a compare-and-set against the artefact's current `payloadHash`: a
render that finishes after a newer edit is discarded. Recording does not change `updatedAt`.
`thumbnailHash` is written **only** by that compare-and-set, never by an aggregate save, so a
concurrent edit cannot revert a just-recorded thumbnail.

r[hosting.thumbnail.previous-kept-until-replaced]
The previous thumbnail stays served until a newer one is recorded; the superseded file is deleted
after that.

r[hosting.thumbnail.title-edit-keeps]
A title/kind-only edit does not re-render.

r[hosting.thumbnail.read-follows-export-matrix]
`GET /api/artefacts/:ref/thumbnail` resolves exactly like the S30 download
(`resolveViewableArtefact`: effective tier per `hosting.access.effective-from-tree-root`,
`AccessPolicy` per `hosting.access.policy-decided`, link gate per
`hosting.link-gate.narrows-public-audience`): a signed-in caller by slug or id, an anonymous caller
**by slug only** (S44, *Amendment — anonymous thumbnails*). Unknown, not viewable, archived (owner
too, `hosting.lifecycle.archived-not-served`) and no thumbnail yet all return the same flat 404.
The route adds no access logic of its own — the matrix stays single-sourced
(`hosting.access.policy-decided`).

r[hosting.thumbnail.sweep-is-system-read]
The render sweep that finds artefacts needing a thumbnail is a **system** read: tenant-agnostic,
internal, never exposed through any API, and returning only what the renderer needs (`id`,
`payloadRef`, `payloadHash`, `thumbnailHash`, and — for the render input cap,
`hosting.renderer.input-cap` — `payloadSize`).

r[hosting.thumbnail.file-layout]
Thumbnails are WebP files at `<thumbnailRoot>/<artefactId>/<payloadHash>.webp`.

r[hosting.thumbnail.stored-beside-payloads+2]
The default thumbnail root is a sibling of the default payload root, never inside it (a
payload-retention policy, the S19b seam, must never have to tell them apart).

r[hosting.renderer.only-isolated-renders]
Untrusted payload HTML is rendered only by an isolated renderer, which runs **outside the app
process and container**.

r[hosting.renderer.holds-no-secrets]
The renderer holds **no secrets, no payload/thumbnail storage and no database access** — the app
sends it the stored payload bytes (`hosting.thumbnail.pristine`) and stores what comes back.

r[hosting.renderer.sandbox-on]
The renderer runs Chromium with its **OS sandbox on**, never falling back to unsandboxed.

r[hosting.renderer.no-app-connection]
The renderer **can't open connections** to the app.

r[hosting.renderer.no-private-network+2]
The renderer **can't open connections** to private or link-local networks.

r[hosting.renderer.stateless]
The renderer keeps **no state from one render to the next**.

r[hosting.renderer.input-cap+2]
Inputs above `MAX_RENDER_INPUT_BYTES` (10 MB) are never sent: the artefact keeps its placeholder, or
its previous thumbnail while one is recorded.

### Isolation evidence (S37 spike, not an invariant)

> Measured with `playwright-core` 1.63 / `chromium-headless-shell` in `node:26-bookworm-slim`, as
> uid `node`, `read_only`, tmpfs `/tmp` and `$HOME`, `cap_drop: ALL`, `no-new-privileges`, no
> `SYS_ADMIN`, no `--privileged` (Docker Desktop 29.4, linuxkit 6.12, cgroup v2):
>
> - **Seccomp.** Docker's default profile refuses the sandboxed launch ("No usable sandbox"): it
>   allows `clone` with `CLONE_NEW*` flags, `unshare` and `chroot` only to a container holding
>   `CAP_SYS_ADMIN` / `CAP_SYS_CHROOT`. `deploy/chromium-seccomp.json` — Docker's default plus
>   one rule allowing exactly `clone`, `unshare` and `chroot` — launches it. The renderer
>   processes then run in their own user and pid namespaces under seccomp-bpf (`Seccomp: 2`). No
>   capability is added and nothing runs unconfined.
> - **AppArmor.** Docker Desktop has no AppArmor, and no stock Ubuntu 24.04 Docker host was
>   available, so `kernel.apparmor_restrict_unprivileged_userns` inside a container is
>   **unverified**; the renderer's `/health` answers `503` naming the launch failure if the host
>   blocks it, and `docs/renderer-isolation.md` gives the check and the fixes. On a bare GitHub
>   `ubuntu-latest` runner (24.04, restriction on) CI lifts the sysctl for the browser tests.
> - **`/dev/shm`.** Nothing needed: Playwright launches Chromium with
>   `--disable-dev-shm-usage`, so Docker's 64 MB default suffices.
> - **Restart backoff.** A container exiting `0` after ≥ 10 s of uptime restarts in ~90 ms
>   every time; one exiting after 2 s backs off 0.1 → 0.2 → 0.4 → … → 12.8 s. Hence the 10 s
>   minimum uptime before a disposable renderer exits.
> - **Cycle.** Container start → ready → one render → exit → restart measured on the compose
>   example: see *Cycle time* in `docs/renderer-isolation.md`.
> - **Coolify.** An *application*'s custom Docker options omit `--read-only`, `--tmpfs`,
>   `--pids-limit` and `--user`, so the renderer runs as a Docker Compose resource. Verified
>   under Coolify 4.3.23 (Ubuntu 24.04, Docker 29): `docker inspect` shows every hardening key
>   coming through. The **network does not isolate on the app's host**: Coolify force-attaches
>   each Compose service to a per-resource network, the only path to a separate app application
>   is its shared `coolify` bridge beside the app and the proxy, and without `br_netfilter` (not
>   loaded on that host) nothing filters traffic inside one bridge. So the renderer runs on a VM
>   of its own behind a firewall outside it, joining a host-created network through
>   `network_mode` (`deploy/docker-compose.renderer-vm.yml`), and the renderer-isolation
>   checklist passes there. On that host `apparmor_restrict_unprivileged_userns=1`, and the
>   sandbox still launches under `docker-default`.

## Amendment (post-v0.2) — anonymous thumbnails (S44)

> **Status:** amends `hosting.thumbnail.read-follows-export-matrix` (FDD slice **S44 — Public
> collection links and anonymous thumbnails**). Lets a site built without a login show a public
> artefact's card preview. A render is pristine (`hosting.thumbnail.pristine`), so a public
> artefact's thumbnail discloses less than its own link.

### Invariants — anonymous thumbnails

r[hosting.thumbnail.anonymous-by-slug]
An anonymous caller may read a thumbnail **by slug only**, through the same
`resolveViewableArtefact` path with no viewer and no id fallback, so the effective tier
(`hosting.access.effective-from-tree-root`), the `AccessPolicy` (`hosting.access.policy-decided`)
and the link gate (`hosting.link-gate.narrows-public-audience`) decide it as they decide every other
read: a gated artefact answers with the standard link-gate challenge. Every other anonymous miss —
an id ref, an unknown, private or archived artefact's slug, an artefact with no thumbnail yet — is
the same flat 404 a signed-in caller gets, so one answer says nothing about any row.

r[hosting.thumbnail.cache-by-audience]
A thumbnail's `Cache-Control` follows its audience: an anonymous read of an ungated artefact is
`public, max-age=300`, so it stops being served soon after the artefact leaves `public`; any read
by someone other than the owner of an artefact whose effective link gate has a password or an
expiry is `private, no-store`; every other signed-in read is `private, max-age=31536000,
immutable`.

## Amendment (post-v0.2) — Isolated artefact serving

> **Status:** DDD amendment (FDD slice **S36 — Isolated artefact serving: sandboxed frame, frame
> token, optional content origin**). A serving change, not sanitization: payloads stay trusted and
> byte-identical in storage and export (S30). With the Artefact Data *persistence through the host
> shell* and Identity & Access `identity.origin.app-origin-only` amendments.

**Problem.** The frame used to load same-origin with no `sandbox`, so any artefact a signed-in
viewer opened could call every `/api` endpoint as them: list and download private artefacts,
change visibility and access lists, archive and delete, write data.

Served artefact HTML never runs in the app origin. The frame routes and their headers are published
language (`hosting.frame.sandbox-header`, `hosting.frame.content-host-split`).

### Invariants (S36)

r[hosting.frame.sandboxed]
**Sandboxed frame.** The host shell's iframe carries `sandbox="allow-scripts allow-forms
allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"` and
`allow="clipboard-write; fullscreen"`. It never carries `allow-same-origin` or any
`allow-top-navigation*`. The artefact therefore runs in an **opaque origin** (`"null"`).

r[hosting.frame.no-cookies]
**Frames never read cookies.** A frame is authenticated **only** by its frame token
(`data.frame-token.signed-claims`), and the access matrix (`hosting.access.matrix`, on the effective
tier of `hosting.access.effective-from-tree-root`, under the policy of
`hosting.access.policy-decided`) is re-evaluated at every token redeem, so a revocation takes effect
at once.

r[hosting.frame.content-origin-separate]
**Optional content origin.** When `ARTEFACTOR_CONTENT_ORIGIN` is set, frames are served only on
that origin, which must be a **separate registrable domain** from the app. Startup refuses the app
host itself, a subdomain of it, and a parent domain of it; it compares **hosts, not registrable
domains** (no public-suffix list), so a sibling under one registrable domain —
`content.example.com` beside `app.example.com` — is *accepted*, and keeping them apart stays the
operator's responsibility.

### Isolation evidence (S36 spike, not an invariant)

A fixture in a sandboxed iframe (attribute
and header), against a canary server holding a `SameSite=Lax` cookie (BetterAuth's default), a
`SameSite=None; Secure` one and a script-readable one:

| Probe | Chromium 153 (headless shell) |
| --- | --- |
| `self.origin` | `"null"` |
| `document.cookie`, `sessionStorage`, `indexedDB.open` | throw `SecurityError` |
| `Object.defineProperty(window, "localStorage", …)` before any native access | succeeds; the shim round-trips |
| `parent.postMessage(msg, appOrigin)` | delivered, `event.source === frame.contentWindow`, `event.origin === "null"` |
| `fetch` / XHR `/api/me` with credentials | response unreadable (CORS); `Lax` cookie never sent |
| no-cors `POST`, form `POST`, `<img>`, `sendBeacon` | `Lax` cookie never sent; the `None` cookie is, always with `Origin: null` (none on `<img>`) and `Sec-Fetch-Site: cross-site`, so the origin guard (`identity.origin.app-origin-only`) refuses any state change |
| `top.location = …`, `target="_top"` link | blocked; the shell stays put |
| `window.open` of the frame URL, frame URL top-level | still `"null"` (the header), cookies and storage throw |
| `target="_blank"` link | opens an unsandboxed popup (expected) |
| `alert`, blob download, clipboard on a click, a CDN script | work |

Firefox and WebKit were **not run**: their Playwright builds could not be downloaded in the spike
environment and Safari's WebDriver was not enabled. Re-run the matrix on them before relying on it
beyond Chromium.

## Amendment (post-v0.2) — owner-set data visibility

> **Status:** DDD amendment (FDD slice **S41 — Owner-set data visibility: shared or own-only**; with
> Artefact Data `data.visibility.narrows-reads`). Adds an owner-set field that decides *whose data*
> a viewer sees — never *who may view*.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `dataVisibility` | `shared` \| `own` | Whether a viewer may load other authors' saved data (`data.visibility.narrows-reads`). `own` on create; `shared` for rows that predate the field. |

**`dataVisibility` is an owner-set field of `Artefact`.** This context holds who sets it and where
it lives; the read rule it drives is Artefact Data's
(`data.visibility.narrows-reads`).

### Invariants — data visibility

r[hosting.data-visibility.owner-set]
Only the owner changes it (`hosting.authority.owner-only`); a non-owner is refused as not found
(`hosting.access.no-existence-leak`). It cannot change while the artefact is archived
(`hosting.lifecycle.archived-frozen`). A change bumps `updatedAt`; setting the current value is a
no-op. It is **per artefact** and never inherited from a collection:
`hosting.access.effective-from-tree-root` governs *who may view*, while
`data.visibility.narrows-reads` governs *whose data a viewer sees*, and that stays on the artefact
itself. It is settable while the artefact is contained.

r[hosting.data-visibility.new-default-own]
New artefacts get `own`, so data is private per viewer by default.

r[hosting.data-visibility.legacy-rows-shared]
Rows that predate the field migrate to `shared`, so no live behaviour changes.

r[hosting.data-visibility.never-gates-viewing]
`dataVisibility` never gates viewing: the access matrix decides who may view an
artefact without reading it. It only narrows which **other** authors' entries a non-owner may load
(`data.visibility.narrows-reads`).

## Amendment (post-v0.2) — set sharing

> **Status:** DDD amendment (FDD slice **S55 — Manage access dialog: one draft, saved
> atomically**). A composite command over the existing sharing transitions, so the owner's whole
> sharing set is saved in one write. It adds no rule about any field: it cites
> `hosting.slug.shared-has-slug`, `hosting.slug.minted-once-retained`,
> `hosting.lifecycle.archived-frozen`, `hosting.access.no-existence-leak`,
> `hosting.authority.owner-only`, `hosting.access-list.retained`,
> `hosting.access-list.owner-managed-set`, `hosting.access.dormant-tier-frozen`,
> `hosting.data-visibility.owner-set` and `hosting.link-gate.public-only` without changing them.

**Command.** The *State / transitions* table gains a **set sharing** row.

The command takes a target tier (always given), and optionally the full access list, a link-gate
change (only with `public`) and a data visibility. A non-owner or an unknown id is refused as not
found (`hosting.access.no-existence-leak`, `hosting.authority.owner-only`); an archived artefact is
refused (`hosting.lifecycle.archived-frozen`). The access list's members are checked against the
user directory as `grant access` checks one.

### Invariants — set sharing

r[hosting.sharing.applies-in-order]
Set sharing applies its parts to one loaded artefact in a fixed order — tier, then link gate, then
access list, then data visibility — each through the transition that decides it alone, and
persists the result with **one** `save`. A link gate given with the change to `public` therefore
meets the new tier.

r[hosting.sharing.atomic-save]
The owner's set-sharing command applies a tier, an access list, a link-gate change and a data
visibility to one artefact together: every part applies, or, when any part is refused, none does.

r[hosting.sharing.members-replace]
A set-sharing command that gives an access list replaces `sharedWith` with exactly that set, under
`hosting.access-list.owner-managed-set` (registered users, never the owner). One that omits it
leaves `sharedWith` as it is.

## Amendment (post-v0.2) — save concurrency

> **Status:** DDD amendment (FDD slice **S60 — Save concurrency: a save never overwrites a newer
> artefact**). Every command still decides its outcome through the same domain function; this
> amendment makes the save that persists it safe against an overlapping command on the same
> artefact.

**Field.** The aggregate gains **`revision`** (non-negative integer): a **concurrency token owned
by the repository**, not a content version. It counts every successful save — a visibility flip
as much as a payload edit — and no domain function changes it. A new aggregate carries 0; every
read returns the stored value. It is not exposed in the BFF or MCP contracts, and it does not
drive ordering (`updatedAt` does).

**Thumbnails.** `recordThumbnail` keeps its own payload-hash compare-and-set
(`hosting.thumbnail.*`) and does not touch `revision`, so a background render never conflicts with
the owner's commands.

**Persistence.** `save` is a **compare-and-set**, not an upsert: an insert that refuses an existing
id at revision 0, an update guarded by `revision = n` otherwise. The access-list sync runs only
after the compare-and-set applied, on the same executor. Where the adapter is given a transaction
runner — the Postgres deployment — the two are one atomic unit: a sync failure rolls the row back,
and a concurrent save waits on the row until both have committed, so it never pairs a new revision
with an older access list. The SQLite default runs them one after the other, since its driver
refuses an asynchronous transaction. Either way a losing save writes neither, and both adapters
keep identical code; only the wiring differs.

### Invariants (S60)

r[hosting.save.no-lost-update]
A save never overwrites a newer aggregate. A save applies only while the stored revision equals
the one the aggregate was loaded at, and stores it incremented by one; otherwise it changes
nothing, neither the row nor the access list, and fails with `ArtefactConflict`. An aggregate that
was never saved has revision 0, and its save inserts the row at revision 1. A revision-0 save whose
id already exists is a conflict, as is a save whose row is gone.

r[hosting.save.reapply-on-conflict]
A command re-applies its intent, never a snapshot. On `ArtefactConflict` a command reloads the
aggregate and re-runs its own domain function on the fresh copy, up to 3 attempts in all, before
surfacing the conflict. Each re-run re-checks every invariant of the fresh aggregate (ownership,
`active` status, tier rules), so a racing archive or revoke wins and is never undone.
