# Artefact Hosting

## Slices

### S2 — Create artefact

- **Status:** done
- **Depends on:** S1
- **Delivers:** hosting.artefact.owner-required, hosting.payload.size-bounds,
  hosting.artefact.title-required, hosting.kind.closed-set, hosting.payload.on-filesystem,
  hosting.create.title-kind-payload, hosting.create.owner-is-creator, hosting.create.active-private,
  hosting.artefact.identity-fixed, hosting.payload.ref-owned-by-one-artefact

r[hosting.create.from-upload+2]
`POST /api/artefacts` creates an artefact from a `multipart/form-data` upload of its title, kind and
HTML file, and answers `201` with its summary.

r[hosting.create.owner-from-session+2]
`POST /api/artefacts` takes the owner from the session; nothing in the request body sets it.

- Rejects empty payload, oversize payload, empty title (`hosting.payload.size-bounds`,
  `hosting.artefact.title-required`).

**Implementation notes (from building S2):**

- The pure-domain `createArtefact` factory (+ its invariant tests) already landed in S0;
  S2 is the vertical slice around it. **Drizzle adapter** for the `ArtefactRepository` port
  (`src/infra/db/artefact-repository.drizzle.ts`) — `save` is an upsert by id so it also
  serves later mutation slices; `findById`/`findBySlug` map row ↔ aggregate.
- **Application command** (`src/server/artefacts/create-artefact.command.ts`) wires the
  `PayloadStore` + repo around the factory: cheap pre-validation (kind, empty/oversize
  payload) avoids needless filesystem writes, the factory stays the invariant authority,
  and a stored payload is deleted again if the aggregate is rejected (no orphans).
- **BFF endpoint** `POST /api/artefacts` (`src/server/routes/artefacts.ts`): `requireAuth` → session
  user is the `ownerId` (`hosting.create.owner-from-session`); `multipart/form-data` with `title`,
  `kind`, and an HTML `payload` file (oversize rejected before buffering); `InvariantViolation →
  400`, success → `201` `ArtefactSummary`. Adapters constructed once in `routes/index.ts`.
- **Client** (`App.svelte` + `lib/components/UploadModal.svelte`): a signed-in **Upload dialog**
  — drag-drop or pick a single `.html` file, title + kind select from `ARTEFACT_KINDS` — posting
  the multipart body. (This same dialog is the manual-upload "Path B" of the S18 connector.)
- **Tests:** command unit test with in-memory repo + a recording fake payload store (asserts
  invariants and no orphan payload), plus an end-to-end `artefacts.test.ts` (sign-up → upload
  → 201/401/400 + Drizzle round-trip through the `owner_id` FK).

### S3 — Edit artefact

- **Status:** done
- **Depends on:** S2
- **Delivers:** hosting.payload.size-bounds, hosting.artefact.title-required,
  hosting.lifecycle.archived-frozen, hosting.authority.owner-only,
  hosting.edit.fields-and-timestamp, hosting.artefact.updated-at-bumped

*Shipped with S7.*

- Owner updates title / kind / payload; `updatedAt` bumps when a field changes
  (`hosting.edit.fields-and-timestamp`).
- Same payload/title invariants as create (`hosting.payload.size-bounds`,
  `hosting.artefact.title-required`).
- Rejected if artefact is archived (`hosting.lifecycle.archived-frozen`).
- Non-owner cannot edit (`hosting.authority.owner-only`).

**Implementation notes (from building S3):**

- **Domain** `editArtefact(a, { title?, kind?, payload? })` — only the provided fields
  change, re-applies the create invariants (`hosting.payload.size-bounds`,
  `hosting.artefact.title-required`), bumps `updatedAt` when a field changes (an edit that changes
  none returns the artefact itself, so nothing is saved), blocked while archived
  (`hosting.lifecycle.archived-frozen`).
- **Command** (`edit-artefact.command.ts`) loads the caller's own active artefact
  (`loadOwnActiveArtefact`; archived/non-owner → not-found), validates the kind, and
  on payload replacement stores the new bytes, then deletes the **previous** payload only
  after a successful save (new one cleaned up on rejection — no orphans).
- **BFF** `PATCH /api/artefacts/:id` (multipart, partial): `ArtefactNotFound → 404`,
  `InvariantViolation → 400`, returns the updated summary.
- **Client** (`App.svelte` + `UploadModal.svelte`): the same Upload dialog in **edit mode**
  (title / kind / optional replacement `.html`), opened per row → `PATCH` via `api.update`.

### S4 — Owner views own artefact

- **Status:** done
- **Depends on:** S2
- **Delivers:** hosting.lifecycle.archived-not-served

r[hosting.owner-view.any-visibility+2]
`GET /api/artefacts/:id` and its preview, `GET /api/artefacts/:id/raw`, give the owner their own
`active` artefact at any visibility.

- Archived gets 404 (reached only via "Your artefacts" restore;
  `hosting.lifecycle.archived-not-served`).

**Implementation notes (from building S4):**

- **`loadOwnActiveArtefact(repo, { id, ownerId })`** (`src/server/artefacts/get-own-artefact.ts`):
  owner-scoped load where missing / not-owned / archived all surface identically as
  `ArtefactNotFound`, so neither a private artefact's existence nor its archived state leaks
  (`hosting.lifecycle.archived-not-served`, `hosting.access.no-existence-leak`). Shared by both
  view endpoints (and reusable by S3 edit).
- BFF: **`GET /api/artefacts/:id`** (owner-only summary) and **`GET /api/artefacts/:id/raw`**
  (trusted HTML, served as-is, by id at any visibility) — both `requireAuth`, both `404` on
  not-found/archived. The by-id raw route is the in-app preview path: unlike `/a/:slug` (S6),
  it works for a never-shared private artefact that has no slug.
- **Client** (`App.svelte`): an `open` link per "Your artefacts" row → `/api/artefacts/:id/raw`.
- **Tests:** `loadOwnActiveArtefact` unit (own/active, non-owner, unknown, archived → not
  found) and end-to-end (owner detail + raw HTML for a private no-slug artefact, non-owner
  `404`, archived `404`, unauth `401`).

### S5 — Share / unshare

- **Status:** done
- **Depends on:** S2
- **Delivers:** hosting.slug.shared-has-slug, hosting.slug.minted-once-retained,
  hosting.slug.globally-unique, hosting.slug.random-token, hosting.lifecycle.archived-frozen,
  hosting.authority.owner-only, hosting.share.sets-tier, hosting.unshare.sets-private,
  hosting.artefact.updated-at-bumped

- Share raises visibility to `authenticated` or `public`; mints a unique slug on first share, reuses
  the retained slug thereafter; tier can be changed between the two (`hosting.share.sets-tier`,
  `hosting.slug.shared-has-slug`, `hosting.slug.minted-once-retained`).
- Unshare sets `private`, retains slug (`hosting.unshare.sets-private`,
  `hosting.slug.minted-once-retained`).

- Owner-only; blocked while archived (`hosting.authority.owner-only`,
  `hosting.lifecycle.archived-frozen`).

**Implementation notes (from building S5):**

- **Domain** (`artefact.ts`): pure `shareArtefact` (mint-once-via-supplied-slug / retain,
  set tier, block while archived) and `unshareArtefact` (→ `private`, retain slug). New
  `ArtefactNotFound` domain error covers both "missing" and "not yours" so a private
  artefact's existence can't be probed (`hosting.access.no-existence-leak`).
- **Slug** generation lives in the app layer (`src/server/artefacts/slug.ts`,
  `randomBytes(8).base64url`) — the domain stays node-free, mirroring how the id is supplied to the
  create factory. Uniqueness (`hosting.slug.globally-unique`) is enforced by the command, which
  collision-checks generated slugs against `repo.findBySlug` and regenerates.
- **Command** (`set-visibility.command.ts`): one operation for all three transitions — loads
  the artefact, treats a non-owner as not-found (`hosting.authority.owner-only`), mints a unique
  slug only on first share, and delegates the transition + archived guard to the domain.
- **BFF** `PUT /api/artefacts/:id/visibility` (`{ visibility }`): validates the tier,
  maps `ArtefactNotFound → 404`, `InvariantViolation → 400`, returns the updated summary.
- **Client** (`App.svelte`): a per-artefact visibility `<select>` in "Your artefacts" that PUTs
  the change and reloads; the share link appears once a slug exists.
- **Tests:** domain unit (mint/retain/tier/archived/timestamps), command unit (slug reuse
  across unshare→reshare, collision regen, non-owner/unknown → not-found), and end-to-end
  (share mints slug, unshare retains + reshare reuses, invalid tier 400, unauth 401,
  non-owner 404).

### S6 — Serve artefact by slug (access matrix)

- **Status:** done
- **Depends on:** S5
- **Delivers:** hosting.access.matrix, hosting.access.anonymous-sign-in-redirect,
  hosting.access.no-existence-leak, hosting.lifecycle.archived-not-served, hosting.serve.as-is,
  hosting.url.share-link

- Serving an `active` artefact by slug enforces the access matrix: `public` → anyone;
  `authenticated` → any signed-in user; `private` → owner only (`hosting.access.matrix`).
- Wrong-tier viewer, archived, and unknown slug → 404 for a signed-in viewer; an unauthenticated
  one is redirected to sign in, uniformly (`hosting.lifecycle.archived-not-served`,
  `hosting.access.no-existence-leak`, `hosting.access.anonymous-sign-in-redirect`).

**Implementation notes (from building S6):**

- **Domain** `access.ts`: pure `canViewArtefact(artefact, viewerId)` encoding the matrix,
  gated by archived-is-inert (`hosting.lifecycle.archived-not-served`). `viewerId = null` is the
  unauthenticated viewer. Reused
  later by "Shared with you" (S14) and data access (S11/S12).
- **Serving route** `GET /a/:slug` (`routes/serve.ts`) — its own `attachSession` (it lives outside
  `/api`), resolves the slug via `repo.findBySlug`, applies the matrix, and on allow streams the
  trusted HTML **as-is** via `c.html` (`text/html; charset=UTF-8`, no sanitization). On deny it
  splits by whether the viewer is authenticated: a **signed-in** viewer who is denied (unknown slug,
  archived, wrong-tier) gets a flat `404`; an **unauthenticated** viewer is redirected (`302` →
  `/?returnTo=<path>`) to sign in and then bounced back to the artefact (so a `Members` link works
  for an org member who has no account yet). The redirect is **uniform across every unauthenticated
  miss**, so existence is still never leaked (`hosting.access.no-existence-leak`). Mounted in
  `app.ts` **before** the static/SPA fallback.
- **Adapters** lifted to `src/server/adapters.ts` (one Drizzle repo + filesystem payload
  store) so the API routes and the serving route share a single composition root.
- **Tests:** access-matrix unit test (the full grid incl. archived) + an end-to-end serving
  test (public→anyone, authenticated→signed-in only, private→owner only; signed-in deny →404
  incl. archived for the owner; unauthenticated deny →`302` sign-in redirect with `returnTo`,
  uniform for unknown slug / private / archived so existence isn't leaked).

### S7 — Archive / restore

- **Status:** done
- **Depends on:** S2
- **Delivers:** hosting.lifecycle.archived-not-served,
  hosting.lifecycle.archived-hidden-from-listings, hosting.lifecycle.archived-data-inert,
  hosting.authority.owner-only, hosting.lifecycle.archive-active-only,
  hosting.lifecycle.archive-stamps-archived-at, hosting.lifecycle.restore-archived-only,
  hosting.restore.prior-visibility, hosting.artefact.updated-at-bumped

*Shipped with S3.*

- Archive hides + un-serves the artefact and its data, sets `archivedAt`
  (`hosting.lifecycle.archived-not-served`, `hosting.lifecycle.archived-hidden-from-listings`,
  `hosting.lifecycle.archived-data-inert`, `hosting.lifecycle.archive-stamps-archived-at`).
- Restore returns it to `active` with prior visibility, clears `archivedAt`. Owner-only
  (`hosting.restore.prior-visibility`).

**Implementation notes (from building S7):**

- **Domain** `archiveArtefact` (active → archived, stamps `archivedAt`, **keeps visibility**
  so restore can return to the prior tier) and `restoreArtefact` (archived → active, clears
  `archivedAt`; rejects a non-archived artefact). Because archival only flips `status`, the
  prior visibility is retained for free (`hosting.restore.prior-visibility`).
- **Commands** (`lifecycle.command.ts`): archive loads the owner's **active** artefact
  (non-owner / unknown / already-archived → not-found); restore loads regardless of status
  via `loadOwnArtefact` and lets the domain reject a non-archived one (→ 400).
- **BFF** `POST /api/artefacts/:id/archive` + `/restore`; `GET /api/artefacts?archived=true`
  lists the owner's archived artefacts (the "Your artefacts" restore view). Archived artefacts
  are already un-served by the S4/S6 read paths and "Shared with you" (all gate on `status ===
  active`),
  so archive makes them inert everywhere; their data entries become inert too once S11 lands
  (the data paths will gate on artefact status).
- **Client** (`App.svelte`): an `archive` button per active row and an "Archived" section
  with `restore`.
- **Tests:** domain unit (archive/restore transitions + guards), command unit (archive/
  restore round-trip, non-owner → not-found, double-archive → not-found, restore-active →
  rejected), and an end-to-end test (archive un-serves the slug + owner view + active list,
  surfaces in `?archived=true`, restore re-serves at the prior tier).

### S10 — Your artefacts (owner's own list)

- **Status:** done
- **Depends on:** S2
- **Delivers:** hosting.lifecycle.archived-hidden-from-listings, hosting.listing.own-only

r[hosting.list.own-active+2]
`GET /api/artefacts` returns the owner's listing (`hosting.listing.own-only`) with each artefact's
visibility and slug.

**Implementation notes (from building S10):**

- New repository port method **`listByOwner(ownerId, { includeArchived })`** (default
  active-only, most-recently-updated first), implemented in both the in-memory and Drizzle
  (`and(owner, status='active')`, `orderBy desc(updatedAt)`) repos.
- BFF **`GET /api/artefacts`** (`requireAuth` → owner-scoped) returns
  `ArtefactListResponse` via the shared `toArtefactSummary` mapper; archived hidden by
  default (`hosting.lifecycle.archived-hidden-from-listings`). Grouping/filtering by kind is a
  client concern.
- **Client** (`App.svelte`): a "Your artefacts" list grouped by kind with a kind
  filter, the visibility tier (`authenticated` shown as the UI label "Other users"), and a
  share link when a slug is present; reloads after a successful upload.
- **Tests:** in-memory `listByOwner` unit tests (owner+active filter, newest-first, archived
  hidden / opt-in) and an end-to-end "Your artefacts" test (fresh user → exact-count list, newest
  first, excludes archived + other owners, 401 unauth).

### S14 — Shared with you

- **Status:** done
- **Depends on:** S5
- **Delivers:** hosting.access.matrix, hosting.listing.signed-in-only,
  hosting.shared.others-viewable

r[hosting.shared.others-shared+2]
`GET /api/shared` returns a signed-in user's "Shared with you" list
(`hosting.shared.others-viewable`) with each artefact's visibility and slug, each attributed to its
owner (`owner: { name, email }`).

**Implementation notes (from building S14):**

- Repository port method **`listShared(viewerId)`** — active artefacts with visibility
  `authenticated` or `public`, across owners but **excluding the viewer's own**,
  most-recently-updated first. Drizzle impl uses the `(status, visibility)` index (`inArray`)
  plus `ne(ownerId, viewerId)`; in-memory mirrors it. Private never matches
  (`hosting.access.matrix`). *("Shared
  with you" means **others'** artefacts — the viewer's own shared artefacts live in "Your
  artefacts", not here. This reverses the original S14 decision to include them.)*
- BFF **`GET /api/shared`** is `requireAuth` — "Shared with you" is signed-in users only
  (unauthenticated access is by slug link only). Returns `SharedListResponse`: each item is
  `toArtefactSummary` **enriched with the owner's display identity** (`owner: { name, email }`)
  so the gallery can attribute it ("Shared by …") and show avatar initials. Owner names/emails
  are composed BFF-side from the Identity context via the `UserDirectory.lookup` port — the
  same lookup that labels the S12 data-context switcher (Hosting stores only owner ids). Client
  groups/filters by kind.
- **Client** (`App.svelte` + `lib/components/Gallery*`): a "Shared with you" view (grid/list,
  kind chips, sort, search) where each item shows owner name + initials and opens at `/a/:slug`
  (the S6 serving route); reloads when the owner changes a visibility tier.
- **Tests:** in-memory `listShared` unit (active authenticated+public across owners; excludes
  private + archived; **excludes the viewer's own**) and an end-to-end "Shared with you" test (two
  owners → a signed-in viewer sees others' shared artefacts, never their own nor others' private;
  each enriched with the owner's identity; `401` unauthenticated).

### S15 — Permanent delete (archived only)

- **Status:** done
- **Depends on:** S7
- **Delivers:** hosting.delete.archived-only, hosting.delete.removes-everything,
  data.entry.lifecycle-bound

- The owner permanently deletes an **archived** artefact, confirmed via a modal dialog; an
  active artefact must be archived first. Deletion removes the row, its payload file, and all
  its data entries (`hosting.delete.archived-only`, `hosting.delete.removes-everything`).

**Implementation notes (from building S15):**

- **Domain** `assertDeletable(a)` (`artefact.ts`): pure guard — throws `InvariantViolation`
  unless `status === "archived"`. Deletion produces no new aggregate, so it's a guard, not a
  transition.
- **Ports**: `ArtefactRepository.delete(id)` and `DataRepository.deleteByArtefact(id)` (both
  in-memory + Drizzle). The `data_entry → artefact` FK is `ON DELETE CASCADE` (DB backstop);
  the command also deletes explicitly so it's adapter-agnostic + testable.
- **Command** `deleteArtefactCommand` (`lifecycle.command.ts`): loads the owned artefact
  (regardless of status → non-owner/unknown is 404), `assertDeletable`, then deletes the
  **payload file** (`PayloadStore.delete`), the **data entries**, and the **row** (in that
  order, so nothing is orphaned).
- **BFF** `DELETE /api/artefacts/:id` (`requireAuth`): 204 on success, 404 unknown/non-owner,
  400 if not archived.
- **Client**: a trash button in each archived row opens `ConfirmDialog.svelte` (destructive
  confirm); `api.delete(id)` → reload archived list + toast. Active artefacts are never
  deletable from the UI (delete is only offered in the Archived section).
- **Tests:** domain (`assertDeletable` archived-ok / active-throws); command (deletes
  archived + payload + all authors' data; refuses active → `InvariantViolation`; non-owner →
  `ArtefactNotFound`); end-to-end (`active → 400`, `archive → delete → 204` then gone
  everywhere + second delete 404, non-owner 404 / anonymous 401).

### S16 — Share with specific people (`selected` tier + access list)

- **Status:** done
- **Depends on:** S5
- **Delivers:** hosting.slug.selected-shared-tier, hosting.access.matrix,
  hosting.access-list.retained, hosting.access-list.owner-managed-set,
  hosting.access-list.owner-never-member, hosting.access-list.members-from-directory,
  hosting.shared.others-viewable, hosting.artefact.updated-at-bumped

- A 4th visibility tier `selected` shares the artefact with an explicit set of registered
  users. It is a *shared* tier: minting/retaining a slug exactly like `authenticated`/`public`
  (`hosting.slug.selected-shared-tier`), but the access matrix grants view only to the owner +
  members of `sharedWith` — a signed-in non-member gets a flat 404 and an unauthenticated
  visitor is redirected to sign in (`hosting.access.matrix`, `hosting.access-list.retained`,
  `hosting.access.anonymous-sign-in-redirect`).
- `sharedWith` is retained across tier changes and archive/restore; only consulted under
  `selected` (empty list ⇒ owner-only; `hosting.access-list.retained`).

r[hosting.access-list.directory-search+2]
`GET /api/users/search?q=` answers a signed-in caller with the directory users matching `q`
(`hosting.access-list.members-from-directory`), and an anonymous one with 401.

r[hosting.shared.selected-members+2]
A member's **"Shared with you"** (`GET /api/shared`, S14) shows a `selected` artefact they're a
member of (`hosting.shared.others-viewable`), attributed to its owner.

**Implementation notes (from building S16):**

- **Domain**: `visibility.ts` adds `selected` (so `ShareableTier` includes it and
  `shareArtefact` mints/retains its slug unchanged). `artefact.ts` gains `sharedWith: readonly
  string[]` (created empty; carried through every transition by spread). `access.ts` extends
  `ViewableArtefact` with `sharedWith` and adds the `selected` case (owner ∨ member). New pure
  `access-list.ts`: `grantAccess`/`revokeAccess` (set semantics, owner-rejected, archived-block).
- **Persistence**: new `artefact_access (artefact_id, user_id, granted_at)` join table
  (PK `(artefact_id, user_id)`, indexed on `user_id` for the "shared with me" lookup). The
  `visibility` text enum gains `selected` (no SQL change — text columns are unconstrained).
  `ArtefactRepository.save` syncs `sharedWith` to the join table (diff add/remove); reads
  populate `sharedWith` (`findById`/`findBySlug`/`listByOwner`); `listShared` unions
  `authenticated`/`public` with `selected` artefacts where the viewer is a member.
- **Command**: `manage-access.command.ts` — `grantAccessCommand`/`revokeAccessCommand` load the
  owned artefact (non-owner → not-found, `hosting.authority.owner-only`), apply the domain fn,
  save. `set-visibility`
  needs no change — `selected` flows through the existing share path.
- **BFF**: `GET /api/users/search?q=` (auth-gated; name/email substring, excludes self, capped)
  via a new `UserDirectory.search`. `GET /api/artefacts/:id/access` (owner-only; members
  enriched with name/email), `POST …/access {userId}` (grant; 404 unknown user),
  `DELETE …/access/:userId` (revoke). `PUT …/visibility` now accepts `selected`.
- **Client**: `ManageAccessModal.svelte` — debounced user search + member list with remove;
  opened from `VisibilityControl` when "Specific people" is chosen (and re-openable via a
  "Manage" affordance while `selected`). `format.ts` adds the tier (label "Specific people").
- **Tests:** domain (access matrix `selected` grid; grant/revoke set semantics + guards),
  command (grant/revoke owner-only, idempotency), end-to-end (selected mints slug; member can
  view + non-member 404 + the anonymous shell redirected to sign in, their cookie-less frame 404;
  member sees it in "Shared with you"; user search).

### S19b — Payload-retention seam

- **Status:** specced
- **Depends on:** S3, S15
- **Delivers:** hosting.retention.invisible-to-core, hosting.retention.default-discards-superseded,
  hosting.retention.purged-on-delete

*Enabler; behaviour-preserving.*

The other half of the history enabler (see **S19a — Data version pin**). (DDD amendment:
`ddd/artefact-hosting.md` `hosting.retention.invisible-to-core`.) The seam replaces a deletion in
the S3 edit command, and the S15 permanent delete must give the policy its chance to purge.

- **Hosting — retention seam.** Replace the unconditional delete of the superseded payload in
  `edit-artefact.command.ts` with a **`PayloadRetentionPolicy`** port. OSS wires the default
  `DiscardSupersededPayload` (deletes — **byte-identical behaviour**); the seam is the one place
  a superset swaps in a retaining policy. The artefact still has exactly one head payload.
  *(`hosting.retention.invisible-to-core`)*
- **Acceptance:**

r[hosting.retention.default-leaves-one-payload+2]
After an edit through the edit command under OSS wiring, the payload store holds exactly one file
for the artefact: no orphan, no retained file
(`hosting.retention.default-discards-superseded`).

r[hosting.retention.delete-lets-policy-purge+2]
After a permanent delete through the delete command, the payload file and data entries are gone and
a stub retention policy has received its purge call for the artefact
(`hosting.retention.purged-on-delete`).

- **Boundary:** **OSS** (the seam must live where the deletion does). The retaining policy, the
  version store, and rollback are the **EE** *Artefact History* context — see `ee/docs/specs/`.

### S32a — Link controls on public artefacts: password + expiry

- **Status:** done
- **Depends on:** S6, S11, S12, S21, S30
- **Linear:** ALI-371
- **Delivers:** hosting.link-gate.evaluation, hosting.link-gate.narrows-public-audience,
  hosting.link-gate.expiry-reads-as-private, hosting.link-gate.expiry-in-future,
  hosting.link-gate.no-existence-leak, hosting.link-gate.public-only,
  hosting.link-gate.cleared-leaving-public, hosting.link-gate.password-rules,
  hosting.link-gate.correct-password-yields-pass, hosting.link-gate.password-change-voids-pass,
  hosting.link-gate.pass-bounded-by-expiry, hosting.link-gate.unlock-attempts-limited,
  hosting.link-gate.owner-summary-only, hosting.link-gate.migrated-rows-ungated

It depends on every read path it gates: slug serving (S6), the data reads and writes (S11), the host
shell and frame (S12), the viewer list (S21) and the download (S30), which the thumbnail (S35)
reuses. (DDD amendment: `ddd/artefact-hosting.md` *link gate on public artefacts*.) An owner-set
**link gate** on a `public` artefact — the password and expiry every competing host offers — that
narrows only the public cell's extra audience, without a fifth tier. (Rationale: market analysis
gap #4.)

- **Domain** — `LinkGate` value object `{ passwordHash, expiresAt, version }` on `Artefact`
  (`NO_LINK_GATE` at create). Pure `evaluateLinkGate(gate, now, pass) → open | expired | challenge`
  (expired wins; a pass counts only at the current `version`). `setArtefactLinkGate(a, {
  requesterId, password?, expiresAt?, now }, hasher)` and `clearArtefactLinkGate(a, { requesterId,
  now })` enforce `hosting.link-gate.public-only`: owner-only (else not found), not archived,
  top-level, tier `public`, password 8–128, `expiresAt` in the future; `null` clears a half; a
  password set/change/clear bumps `version`, an expiry-only change does not; clearing a gate with
  neither half set returns the artefact itself, keeping `version` (no pass exists to void, and
  `hosting.artefact.updated-at-bumped` saves nothing). Hashing goes through a
  `LinkPasswordHasher` port (`hash`, `verify`). `shareArtefact` / `unshareArtefact` clear the gate
  and bump `version` when the tier leaves `public`. One `authorizeArtefactRead({ artefact,
  effective, viewerId, pass, now }, policy) → granted | not-found | sign-in | challenge` = the
  matrix under the policy **then** the gate, for the gated audience only
  (`hosting.link-gate.narrows-public-audience`).
- **Infra** — `ScryptLinkPasswordHasher` (`node:crypto` scrypt, per-hash salt,
  `timingSafeEqual`). SQLite migration: `link_password_hash` (text null), `link_expires_at`
  (timestamp null), `link_gate_version` (int not null default 0) on `artefact`; the repository
  maps them. Only the unlock route verifies a password against the hash; no response carries it
  (`hosting.link-gate.owner-summary-only`).
- **Enforcement** — every read that can admit a non-owner runs `authorizeArtefactRead`, slug and
  id alias alike: the `/a/:slug` shell, the frame-token mint and the frame redeem (a token carries
  the gate `version` its pass proved, so an anonymous viewer of a password-gated artefact gets a
  tokened frame and the token-less frame is refused), `resolveViewableArtefact` (data reads and
  writes, download, thumbnail), the viewer list, and the bookmark toggle's visibility check.
  `challenge` → the shell renders an unlock page, the API answers `403 { gate: "password" }`;
  `expired` → the private outcome.
- **Passes** — `POST /a/:slug/unlock` (form post) verifies the password (scrypt, constant-time) and
  sets an httpOnly, `Secure` (production), SameSite=Lax, path `/` cookie named per holder,
  HMAC-signed with `BETTER_AUTH_SECRET`, carrying `{ holderId, version, exp }`,
  `exp = min(now + 7 d, expiresAt)`, then redirects to `/a/:slug`. A wrong password renders the
  unlock page again with an error (401). Rate limit: 10 attempts per holder + client IP (the
  `identity.client-ip.trusted-walk` client address — S42) per 15 min → 429, in an in-process store.
- **BFF** — `PUT /api/artefacts/:id/visibility` accepts `linkGate?: { password?, expiresAt? }`
  when `visibility` is `public` (400 otherwise); leaving public clears the gate.
  `PUT /api/artefacts/:id/link-gate` `{ password?: string | null, expiresAt?: string | null }`
  (`null` clears that half) and `DELETE /api/artefacts/:id/link-gate` (both). Non-owner → 404;
  archived / not public / contained / bad password / past expiry → 400. Owner summaries carry
  `linkGate: { passwordProtected, expiresAt } | null`; non-owner summaries never carry it.
- **Client** — the visibility control: choosing **Public** reveals a "Link protection" section
  submitted with the tier change; while public it edits the gate. "Require a password" (or
  "Change password") pre-fills a generated 16-character password from an unambiguous alphabet
  (no `0 O 1 l I`, `crypto.getRandomValues`), shown in plain text, editable, with a copy button
  ("Copied"); once saved it shows "Password set" with Change / Clear. Expiry presets 1 d / 7 d /
  30 d / custom, or none. Owner cards and rows show lock / clock badges; the owner preview shows a
  "Link expired" banner. The shell's unlock page is server-rendered: password field, error and
  rate-limit states.
- **MCP** — no gate-setting tool. `set_visibility` away from `public` clears the gate (the domain
  rule) and its description says so and that link protection is set in the Artefactor UI. Owner
  summaries carry `linkGate` like the BFF.
- **Acceptance:** `evaluateLinkGate`'s truth table — no gate, future expiry, past expiry even with
  a pass, password without pass, current and stale pass (`hosting.link-gate.evaluation`); a gate on
  a non-public, archived or contained artefact, by a non-owner, with a 7-char password or a past
  expiry is rejected, and no gate change moves the tier (`hosting.link-gate.public-only`,
  `hosting.link-gate.password-rules`, `hosting.link-gate.expiry-in-future`);
  `public → authenticated` clears the gate and bumps `version`, `public → public` keeps it,
  `private → public` with a gate sets both at once (`hosting.link-gate.cleared-leaving-public`,
  `hosting.link-gate.public-only`); the owner is never challenged or expired; in OSS a signed-in
  non-owner opens a gated or expired public artefact normally, while under a policy refusing the
  `authenticated` tier that user is challenged (404 once expired)
  (`hosting.link-gate.narrows-public-audience`); past `expiresAt` anonymous → sign-in redirect and
  outsider → 404 with tier, `sharedWith` and slug unchanged, and extending the expiry restores the
  same URL (`hosting.link-gate.expiry-reads-as-private`); download, `…/viewers` and thumbnail honour
  the gate (`hosting.link-gate.narrows-public-audience`). And:

r[hosting.link-gate.unlock-issues-pass+2]
Anonymous on a password-gated slug gets the server-rendered unlock page. `POST /a/:slug/unlock`
with a wrong password answers 401 with the page and its error; with the right one it sets the pass
cookie (httpOnly, SameSite=Lax, path `/`) and redirects to `/a/:slug`, whose shell, frame token and
data reads then open (`hosting.link-gate.correct-password-yields-pass`).

r[hosting.link-gate.api-challenge]
The id alias is gated identically (`403 { gate: "password" }`).

r[hosting.link-gate.unlock-rate-limited+2]
`POST /a/:slug/unlock` answers the 11th attempt within 15 minutes with 429 and the unlock page's
rate-limit state (`hosting.link-gate.unlock-attempts-limited`).

r[hosting.link-gate.password-generator+2]
"Require a password" and, on a kept password, "Change" pre-fill a generated password: 16 characters
drawn with `crypto.getRandomValues`, each equally likely, from an alphabet without `0 O 1 l I`. The
field stays editable, and its copy button writes the field's current value to the clipboard and
reports "Copied".

- **Out of scope:** collection roots (S32b), gates on other tiers, gating the audience the
  `authenticated` tier admits, per-recipient passwords, view-count limits, password recovery, MCP
  tools to set a gate (a password typed into an agent transcript is the wrong habit), a
  regenerate button, a shared (multi-instance) rate-limit store.
- **Boundary:** **OSS** (the EE Postgres repository mirrors the columns).

### S32b — Link controls on public collections: password + expiry

- **Status:** done
- **Depends on:** S25, S32a
- **Linear:** ALI-372
- **Delivers:** collections.link-gate.root-governs-tree, collections.link-gate.public-root-only,
  collections.link-gate.cleared-leaving-public, collections.link-gate.owner-summary-only,
  export.collection.link-gate, hosting.link-gate.unlock-limit-per-holder

The S32a gate on a **public collection root**, which its contained artefacts follow exactly as they
follow the root's `(visibility, sharedWith)` (`hosting.access.effective-from-tree-root`,
`collections.access.root-governs-tree`); an expired root hides its tree from the gated audience.
(DDD amendment: `ddd/artefact-collections.md` *link gate on a public root*, under the hosting link
gate, `hosting.link-gate.narrows-public-audience`; `ddd/deployment-export.md` format 1.1.)

- **Domain** — `Collection.linkGate` (`NO_LINK_GATE` at create). `setCollectionLinkGate` /
  `clearCollectionLinkGate` (`domain/collection/link-gate.ts`) with S32a's semantics, behind one
  `assertCollectionGateEditable`: owner (else not found), active, a root, tier `public`.
  `setCollectionAccess` clears the gate and bumps `version` when the root leaves `public`.
  `effectiveLinkGate(artefact, root) → { holderId, gate }` — the root's gate (holder = the root)
  when contained, the artefact's own (holder = the artefact) at top level; `authorizeArtefactRead`
  takes it instead of reading the artefact's own gate.
- **Infra** — SQLite migration: `link_password_hash`, `link_expires_at`, `link_gate_version`
  (default 0) on `collection`; the repository maps them. The export bundle's `collections.jsonl`
  gains `linkGate` (format 1.1; optional to the reader).
- **Enforcement** — no new call sites: `authorizeRead` resolves the root once and looks the pass
  up under the gate's holder; the shell and frame-token mints, the frame redeem and
  `POST /a/:slug/unlock` use the holder too, so unlocking any artefact in a gated tree issues the
  root's pass and opens the whole tree; the unlock rate limit is keyed on the holder.
- **BFF** — `PATCH /api/collections/:id` accepts `linkGate?` with `visibility: public` (400
  otherwise); `PUT|DELETE /api/collections/:id/link-gate` (non-owner → 404; archived, nested, not
  public, bad password, past expiry → 400). The owner's collection summaries carry `linkGate`;
  shared-tree summaries never do.
- **Client** — the collection page's root access control reuses S32a's "Link protection" section;
  a contained artefact's inherited popover shows "Link protection inherited from “*root*”";
  the owner's collection page header shows a gated root's lock / clock badges.
- **Acceptance:** a gate on a nested, non-public or archived root, by a non-owner, with a 7-char
  password or a past expiry is rejected (`collections.link-gate.public-root-only`);
  `public → selected` clears the root's gate and bumps `version`, `public → public` keeps it
  (`collections.link-gate.cleared-leaving-public`); anonymous on a contained artefact of a
  password-gated root is challenged, and unlocking via it opens a sibling without a second prompt;
  the tree owner is never challenged; a contained artefact's own gate is dormant and applies again
  after eviction; past the root's expiry anonymous → sign-in and an outsider → 404 for every
  artefact in the tree, and extending it restores the same URLs; a contributor's artefact is gated
  by the root; changing the root's password voids every pass in the tree
  (`collections.link-gate.root-governs-tree`); only owner summaries carry `linkGate`
  (`collections.link-gate.owner-summary-only`); the export carries a root's gate
  (`export.collection.link-gate`). And:

r[hosting.link-gate.migrated-roots-ungated]
Migrated rows are ungated (SQLite and Postgres).

- **Out of scope:** gates on non-root collections, per-subtree passwords, and everything S32a
  excludes.
- **Boundary:** **OSS** (the EE Postgres repository and importer mirror the columns).

### S33a — Capabilities seam + magic-link sign-in affordance

- **Status:** done
- **Depends on:** S1, S38
- **Linear:** ALI-412
- **Delivers:** identity.capabilities.oss-default-off

*Enabler; behaviour-preserving.*

The core half of magic-link sign-in: the sign-in page learns from the server that a superset
offers it, and offers it. **OSS sends no mail** and registers no magic-link plugin, so it never
turns the capability on; the EE **Share invitations** context supplies the plugin and the mail.
No DDD invariant changes: the flag is a presentation signal like S38's method flags
(`ddd/identity-access.md`), the endpoint exists only where a superset registers it, and every
account it creates still passes the `user.create.before` gate (`identity.signup.gate`, S38).

- **Capabilities** — `src/shared/contracts.ts` exports `Capabilities { magicLinkSignIn: boolean }`,
  and public `GET /api/config` gains `capabilities: Capabilities`, returned unchanged from an
  injected value: `createApp` takes it as a new trailing dependency (the S22/S24 pattern),
  defaulting to `ossCapabilities` (`src/server/capabilities.ts`). **OSS default: `{ magicLinkSignIn:
  false }`.**
- **Client** — the client auth carries BetterAuth's `magicLinkClient()` plugin (no request until
  the form is used). When `magicLinkSignIn` is on, the sign-in screen offers **"Email me a sign-in
  link"** — an email field and a submit button, in sign-in and sign-up mode alike — calling
  `signIn.magicLink({ email, callbackURL, newUserCallbackURL, errorCallbackURL })` with the
  post-sign-in destination the other methods use (the captured `returnTo`, else `/`) and the
  sign-in screen as the error callback. A sent link replaces the form with "Check your inbox — we
  sent a sign-in link to `<email>`", which never says whether an account exists, and a "Use a
  different email" way back; a failed send (a 429 included) is an inline error with the form
  still usable. Landing back with `?error=…` from a failed verify shows "That sign-in link has
  expired or was already used — send a new one" for `EXPIRED_TOKEN` / `INVALID_TOKEN` and "We
  couldn't sign you in with that link" for any other code (S48 adds `signup_refused`'s own
  message). With the capability off the screen
  renders exactly as today, the Google `?auth_error` landing included.
- **Acceptance:** `createApp` with no capabilities → `/api/config` reports
  `capabilities: { magicLinkSignIn: false }` and its other fields unchanged; with
  `{ magicLinkSignIn: true }` it reports `true` (`identity.capabilities.oss-default-off`). And:

r[hosting.magic-link.no-oss-endpoint]
Under the OSS default `POST /api/auth/sign-in/magic-link` → 404.

r[hosting.magic-link.sign-in-control]
Capability off → the sign-in screen shows no magic-link control; capability on → "Email me a
sign-in link" shows, submitting `a@b.co` calls the magic-link endpoint with that email and the
post-sign-in callback, then shows the check-your-inbox state naming `a@b.co`.

r[hosting.magic-link.send-error]
A rejected send (429) → an inline error and the form still there.

r[hosting.magic-link.landing-error]
`?error=EXPIRED_TOKEN` or `?error=INVALID_TOKEN` → the expired/used message,
`?error=signup_refused` → S48's refused-sign-up message, any other `error` → the generic one.

- **Out of scope:** mail, the server `magicLink` plugin and the `Mailer` (the EE Share
  invitations context); counting magic link
  as a method for the "at least one method in production" rule
  (`identity.signin.production-needs-a-method`) (it is additive).
- **Boundary:** **OSS** (the capabilities value, the client affordance). The plugin and mail are
  **EE** (the Share invitations context).

### S33b — Share-invitation seam

- **Status:** specced
- **Depends on:** S1, S16, S25, S33a
- **Linear:** ALI-300

*Enabler; behaviour-preserving.*

The core hook a superset uses to let an owner share with an **email that has no Account yet**
(market analysis gap #1). **OSS does not invite anyone:** it has no transactional email, and its
sign-up allowlist (`identity.signup.domain-allowlist`) stays the only way in. The invitation
aggregate, mail delivery and cross-org grants are the EE **Share invitations** context
(`ee/docs/specs/ddd/share-invitations.md`) — in cloud, where sign-up is open
(`identity.signup.allow-all`), an invited person becomes an ordinary Account, signing in through
S33a's magic link. No DDD invariant changes: an accepted invitation is an ordinary
`hosting.access-list.owner-managed-set` grant.

- **Capabilities** — adds `shareInvitations: boolean` to S33a's `Capabilities`, reported on
  `GET /api/config`. **OSS default: `false`.**
- **Endpoint contract (not mounted in OSS)** — the client targets, and a superset mounts:
  `POST|GET /api/artefacts/:id/invitations`, `POST|GET /api/collections/:id/invitations` (owner;
  body `{ email }` → `{ status: "granted" | "pending", invitation? }`; `GET` lists pending
  `{ id, email, createdAt, expiresAt }`), and `DELETE /api/invitations/:id`. `granted` means the
  email already had an Account and was added to `sharedWith` directly.
- **Client** — when `shareInvitations` is on, `ManageAccessModal`'s people picker offers "Invite
  `<email>`" for a well-formed email with no directory match and shows pending invitations as chips
  (resend = re-POST, revoke = DELETE) beside the access list; a `private` target prompts to share
  as `selected` first. With it off, the UI renders exactly as today.
- **Acceptance:**

r[hosting.invitations.oss-default-off]
Under the OSS default `/api/config` reports `shareInvitations: false`, the modal renders unchanged,
and no invitation route exists (404).

r[hosting.invitations.invite-affordance]
With the stub capability on and stub endpoints, typing an unknown email shows "Invite", inviting
renders a pending chip, `granted` refreshes the access list instead, and revoke removes the chip.

- **Boundary:** **OSS** (the capabilities flag, client affordances and endpoint contract). The
  invitation domain, persistence and mail are **EE** (the Share invitations context).

### S35 — Artefact thumbnails

- **Status:** done
- **Depends on:** S2, S3, S10, S14, S15, S30
- **Optional:** S32a
- **Linear:** ALI-271
- **Delivers:** hosting.thumbnail.stale-while-hash-differs, hosting.thumbnail.host-chrome-only,
  hosting.thumbnail.placeholder-when-missing, hosting.thumbnail.never-blocks-command,
  hosting.thumbnail.pristine, hosting.thumbnail.recorded-by-compare-and-set,
  hosting.thumbnail.previous-kept-until-replaced, hosting.thumbnail.title-edit-keeps,
  hosting.thumbnail.read-follows-export-matrix, hosting.thumbnail.sweep-is-system-read,
  hosting.thumbnail.file-layout, hosting.thumbnail.stored-beside-payloads,
  hosting.delete.removes-everything

A WebP preview on every dashboard, collection and "Shared with you" card, rendered server-side
from the stored payload alone, so an artefact published through the MCP connector (which has no
browser) gets one too. It builds on create (S2) and edit (S3), which enqueue renders, on the
lists whose cards show it (S10, S14), on permanent delete (S15), which removes the files, and on
the S30 download resolver, which the thumbnail read reuses. S32a is optional: the link gate is
inherited through that resolver when it lands. (DDD amendment: `ddd/artefact-hosting.md`
*Artefact thumbnails*, the `hosting.thumbnail.*` requirements, with
`hosting.delete.removes-everything` and `hosting.link-gate.narrows-public-audience`.)

- **Domain** — `Artefact.thumbnailHash: string | null` (`null` at create, untouched by
  `editArtefact`); pure `isThumbnailStale(a)`. Ports `ThumbnailStore { put, get, deleteAllExcept,
  deleteAll }` and `ThumbnailRenderer { render(html) }`. `ArtefactRepository` gains
  `recordThumbnail(id, renderedHash)` — a compare-and-set against `payloadHash` that never bumps
  `updatedAt` — and the system read `listNeedingThumbnail(limit)` (active rows whose `thumbnailHash`
  is null or stale). `save()` never writes `thumbnailHash`.
  *(`hosting.thumbnail.recorded-by-compare-and-set`, `hosting.thumbnail.sweep-is-system-read`)*
- **Infra** — nullable `thumbnail_hash` column + migration; `FilesystemThumbnailStore` at
  `<root>/<artefactId>/<payloadHash>.webp` (a sibling of `payloads/`);
  `PlaywrightThumbnailRenderer` (`playwright-core` + `chromium-headless-shell`): lazy launch,
  idle close, a fresh context per render (1280×800, service workers blocked, no credentials),
  the payload fulfilled at the synthetic origin `https://artefact.invalid/` (Chromium's Local
  Network Access then blocks loopback), WebSockets closed, `load` + a short settle (never
  `networkidle`), a CDP WebP capture at scale 0.4 (512×320), and a 15 s hard cap. A launch
  failure reports the renderer unavailable.
- **Server** — `ARTEFACTOR_THUMBNAILS` (`on` | `off`, default **`off`**) and
  `ARTEFACTOR_THUMBNAIL_DIR` (default `./data/thumbnails`). Rendering is **opt-in** until
  renderer isolation (sandbox on, a separate renderer container without secrets or the data
  volume, egress limits) lands; that follow-up flips the default to `on`. *Amended by S37:
  `ARTEFACTOR_THUMBNAILS` is replaced by `ARTEFACTOR_RENDERER_URL`; Chromium runs only in the
  isolated renderer role.* An in-process `ThumbnailService`:
  a synchronous, never-throwing `enqueue(job)` deduped by artefact id (latest wins); one worker
  that skips fresh jobs, drops a job whose payload is gone, renders, stores, records by
  compare-and-set (deleting its file when the record loses) and then deletes the superseded
  files; failed hashes are remembered per process and never retried; `start()` sweeps
  backfill + crash recovery. Create and payload-replacing edit enqueue after the save (UI and
  MCP alike). Permanent delete (and the `collections.lifecycle.delete-cascades` cascade) removes the
  files.
  `GET /api/artefacts/:ref/thumbnail` behind `requireAuth`, resolved like the S30 download,
  `image/webp` + `Cache-Control: private, max-age=31536000, immutable` + `nosniff`.
  `ArtefactSummary.thumbnailUrl` = `/api/artefacts/<id>/thumbnail?v=<thumbnailHash>` for an
  active artefact with a thumbnail, else `null`. *(`hosting.thumbnail.read-follows-export-matrix`,
  `hosting.delete.removes-everything`)*
- **Client** — `CardThumbnail` in `ArtefactCard`: a 16:10 preview area showing the image
  (`loading="lazy"`, top-aligned, `object-fit: cover`) or, when there is none or it fails to load,
  the striped kind placeholder; the chips stay overlaid. After an upload or HTML replace the SPA
  polls that artefact every 2 s for up to ~30 s until its `thumbnailUrl` appears.
- **Packaging** — the runtime image installs `chromium-headless-shell` under
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` with `ARTEFACTOR_THUMBNAIL_DIR=/data/thumbnails`
  but does not set `ARTEFACTOR_THUMBNAILS=on`; CI installs it before `pnpm test` so the renderer
  isolation tests run.

**Acceptance:**

r[hosting.thumbnail.create-enqueues-once]
**Create** (UI upload or MCP `create_artefact`) returns the same status and body as before, plus
`thumbnailUrl: null`, without awaiting any render; a job with the saved `payloadHash` is enqueued
exactly once; a throwing or absent queue doesn't fail the command.

r[hosting.thumbnail.edit-enqueues-new-hash]
**Edit** replacing the HTML (UI or MCP `update_artefact`) enqueues once with the new hash; a
title/kind-only edit enqueues nothing.

r[hosting.thumbnail.summary-url]
**Summary URL** — `thumbnailUrl` is `null` before a render completes, and after it
`thumbnailHash === payloadHash` and `thumbnailUrl` is
`/api/artefacts/<id>/thumbnail?v=<thumbnailHash>`; an archived artefact's is `null`.

r[hosting.thumbnail.lost-render-removed]
**Stale render** — a render finishing after the payload changed again is not recorded, its file is
removed, and the newer render's result wins.

r[hosting.thumbnail.failed-hash-not-retried]
**Failure** — a renderer failure leaves `thumbnailHash` unchanged and that hash isn't retried in
the same process.

r[hosting.thumbnail.startup-sweep]
**Startup sweep** — `start()` enqueues active artefacts that are null or stale, never archived
ones.

r[hosting.thumbnail.page-isolation]
**Renderer integration** (runs in CI; skips locally only without Chromium) — a fixture with CDN
CSS, a web font and a canvas yields a valid 512×320 WebP; a loopback canary receives zero requests
from `fetch`, `<img>`, `sendBeacon` and WebSocket; a public WebSocket is blocked; a `while(true){}`
page is aborted within the 15 s cap.

The rest restate the DDD requirements the slice delivers:

- **Repository CAS** — `recordThumbnail` applies only on a hash match and leaves `updatedAt`
  unchanged (in-memory and Drizzle); a `save()` after a record doesn't revert `thumbnailHash`
  (`hosting.thumbnail.recorded-by-compare-and-set`); `listNeedingThumbnail` returns only active
  rows that are null or stale (`hosting.thumbnail.sweep-is-system-read`).
- **Superseded file** — `hosting.thumbnail.previous-kept-until-replaced`.
- **Route access** — `hosting.thumbnail.read-follows-export-matrix`, answered 200 `image/webp`
  with the three headers above.
- **Permanent delete** of an archived artefact removes its thumbnail files
  (`hosting.delete.removes-everything`).
- **Disabled by default** — with `ARTEFACTOR_THUMBNAILS` unset (or `off`, or no Chromium) the
  server starts, logs once that thumbnails are disabled, never renders, every card shows the
  placeholder, and all other behaviour is identical; `on` builds the renderer. *Amended by S37 —
  the sentence above is S35's behaviour, kept as that slice's record. Both of its conditions are
  gone: the switch is ignored, and "no Chromium" no longer applies to this server, which never
  launches a browser. Thumbnails are now off exactly when `ARTEFACTOR_RENDERER_URL` is unset
  (`hosting.thumbnail.off-without-renderer`, `hosting.thumbnail.renderer-url-config`).*
- **Card** — `pnpm check` passes; a manual run shows upload → placeholder → thumbnail without a
  reload, the thumbnail in "Shared with you", and the placeholder for an archived artefact and a
  broken image (`hosting.thumbnail.placeholder-when-missing`).

- **Out of scope:** the Chromium OS sandbox (off in the container; isolation relies on the
  synthetic origin, WebSocket/service-worker blocking, the timeout, no credentials and the
  container), anonymous thumbnail reads, OG/social images, thumbnails in MCP responses, list
  rows and collection tiles, owner-chosen crops, per-kind viewports, dark-mode variants, an
  object-storage store, a durable queue and per-tenant render quotas.
- **Boundary:** **OSS** (the EE Postgres repository mirrors the column and the two repository
  methods).

### S36 — Isolated artefact serving: sandboxed frame, frame token, optional content origin

- **Status:** done
- **Depends on:** S6, S12, S13, S31
- **Optional:** S32a
- **Linear:** ALI-321
- **Delivers:** identity.origin.app-origin-only, identity.origin.exemptions, hosting.frame.sandboxed,
  hosting.frame.sandbox-header, hosting.frame.no-cookies, hosting.frame.content-origin-separate,
  hosting.frame.content-host-split, data.shim.posts-never-fetches,
  data.shell.saves-only-own-frame, data.shell.channel-binds-document, data.frame-token.signed-claims,
  data.frame-token.minted-for-context, data.frame-token.redeem-rechecks-access,
  data.frame-token.absent-invalid-expired

A served artefact stops running with the viewer's session. The frame becomes a sandboxed,
opaque-origin iframe authenticated by a short-lived frame token instead of cookies, the served
`localStorage` shim hands its writes to the host shell, the API refuses cross-origin
cookie-authenticated state changes, and a deployment may serve frames from a separate content
domain. It builds on slug serving (S6), the host shell and its data-context switcher (S12), the
runtime shim (S13) and its pinned write discipline (S31). S32a is optional: when it lands, its link
gate applies at frame-token redeem (`hosting.link-gate.narrows-public-audience` already names "the
host shell and frame"). (DDD amendments: `ddd/artefact-hosting.md` *Isolated artefact serving*,
`ddd/artefact-data.md` *persistence through the host shell*, `ddd/identity-access.md`
`identity.origin.app-origin-only`.)

- **Sandbox** *(`hosting.frame.sandboxed`, `hosting.frame.sandbox-header`)* — one exported constant
  holds the flags; the shell's iframe carries them as `sandbox` (plus `allow="clipboard-write;
  fullscreen"`), and every frame response carries them as `Content-Security-Policy: sandbox …` with
  `Referrer-Policy: no-referrer`.
- **Frame token** *(`data.frame-token.signed-claims`)* — stateless HMAC-SHA256 over `artefactId`,
  `route`, `viewerId`, `authorId`, `exp` (+ `tenantId` on a `raw` token), 5-minute TTL, plus a
  derived **channel** binding the frame's messages to the document that token loaded. The shell
  render embeds a tokened frame URL; `POST /api/artefacts/:ref/frame-token` mints another. Frame
  routes read only `?t=` (never cookies), re-run the route's access check at every redeem, and
  answer an expired token with a sandboxed page that asks the shell to re-mint.
- **Persistence through the shell** *(`data.shim.posts-never-fetches`, S31)* — the shim posts
  `artefactor:data-changed` to the parent and never fetches; the shell accepts it only from its
  frame's window, carrying that frame URL's channel, while in the viewer's own context, and owns
  the pin, the no-overlap rule, the 412 → conflict banner and the `pagehide` keepalive.
- **CSRF backstop** *(`identity.origin.app-origin-only`)* — `/api/*` state changes (not
  `/api/auth/*`) with an untrusted `Origin` or a non-`same-origin` `Sec-Fetch-Site` → 403.
- **Content origin** *(`hosting.frame.content-origin-separate`,
  `hosting.frame.content-host-split`)* — optional `ARTEFACTOR_CONTENT_ORIGIN`, validated at startup
  against the app host (equal, subdomain or parent refused; a sibling sharing one registrable
  domain is not detected — no public-suffix list); that host answers only the frame routes and
  `/health`, the app host answers no frame route.
- **Authoring guide** — `skills/artefactor/SKILL.md` and the MCP `instructions` warn that
  `sessionStorage`, IndexedDB and cookies are never saved and throw in the sandbox, name the
  libraries that silently use IndexedDB, and say top-targeted links don't navigate.

**Acceptance:**

r[hosting.frame.token-signed]
**Token.** Sign → verify round-trips; a tampered payload or signature, or another secret, is
invalid; a past `exp` is expired.

r[hosting.frame.redeem-seeds-by-token]
**Redeem.** A valid session cookie and no token → 404 on an `authenticated` artefact, the
anonymous read-only seed (`{}`, not writable) on a `public` one. An own-context token seeds the
viewer's blob writable; an author token seeds that author's blob read-only. A token for another
artefact, or a `raw` token on a slug frame → 404. Revoking access (visibility → private) makes a
still-unexpired token 404. An expired token → the expired page, seeding nothing.

r[hosting.frame.mint]
**Mint.** `POST /api/artefacts/:ref/frame-token` → 401 anonymous, 404 for a viewer the matrix
denies, 200 `{ frameUrl, channel, seedUpdatedAt }` for a viewer by slug and for the owner by id,
with `author` honoured; the channel is the one inlined in the frame that URL loads. The shell
render embeds a tokened frame URL for a signed-in viewer and a token-less one for an anonymous
viewer.

r[hosting.frame.shim-posts-to-shell+2]
**Shim.** A `setItem` posts one `data-changed` with the whole blob, its channel and the
`updatedAt` it was seeded with to the app origin once the task that made it ends (one post however
many changes the task made) and never fetches; idle posts nothing; read-only throws
`QuotaExceededError` and posts nothing; over-cap still throws.

r[hosting.frame.shell-saves-for-frame+2]
**Shell.** A message from another source, from the frame in an author context, or without the
channel of the frame URL the shell loaded → no request. From the frame in own context → one `PUT`
600 ms after the last change, or at once on `beforeunload` / `pagehide` / hidden, to the fixed
endpoint with `If-None-Match: *` (unseeded) or `If-Match: "<seedUpdatedAt>"` — the seed the frame
document reports when it differs from the last one adopted, else the rendered one — and the next
pins the returned `updatedAt`. A change during an in-flight save goes after it, with the new
pin, carrying only the latest blob. 412 → banner and no further `PUT`s; Reload re-mints and
re-seeds. `frame-token-expired` from the frame → one mint and the frame's `src` set to the result;
from another source → ignored.

r[hosting.frame.urls-on-content-origin]
**Content origin URLs.** When a content origin is set, the shell's iframe `src` and the mint's
`frameUrl` are absolute on the content origin, and the shim's `targetOrigin` is the app origin.

r[hosting.frame.guide-warns-storage]
**Guide.** The storage sentence is in both `PERSISTENCE_CONTRACT_SUMMARY` and
`skills/artefactor/SKILL.md`.

The rest restate requirements the slice delivers:

- **Sandbox** — `hosting.frame.sandboxed` and `hosting.frame.sandbox-header`: the `/a/:slug` and
  owner-preview shells' iframe carries exactly the flag list and no `allow-same-origin`; tokened
  slug and raw frames, the anonymous public frame and the expired-token page answer 200 with the
  sandbox CSP and `Referrer-Policy: no-referrer`, both from one constant.
- **App-origin state changes** (`identity.origin.app-origin-only`, `identity.origin.exemptions`).
  `PUT /api/artefacts/:id/visibility` with a session and `Origin: null`, `Origin:
  https://evil.example`, `Sec-Fetch-Site: cross-site`, or the content origin → 403 and nothing
  changed; with the app origin, an `AUTH_TRUSTED_ORIGINS` entry, or neither header → 200. `GET`
  with `Origin: null`, `POST /mcp` with a bearer and `Origin: null`, and `/api/auth/*` are not
  blocked by it.
- **Content origin** — `hosting.frame.content-origin-separate`: a value equal to, a subdomain of,
  or a parent of the `BETTER_AUTH_URL` host, or carrying a path, fails startup validation; a
  sibling sharing the app's registrable domain passes; unset is fine.
  `hosting.frame.content-host-split`: the content host answers `/a/:slug/frame?t=…` 200 and
  `/health` 200, and 404 for `/a/:slug`, `/api/me`, `/`, `/mcp` and
  `/.well-known/oauth-authorization-server`; the app host answers `/a/:slug/frame` 404.
- **Browser (Chromium).** A fixture artefact in the real shell can't read `document.cookie`, can't
  read `/api/me` (and the request carries no session cookie), and can't archive itself with a form
  POST (`hosting.frame.sandboxed`, `hosting.frame.no-cookies`). Its `localStorage.setItem` persists
  across a shell reload, and an in-frame `location.reload()` after the token expired comes back
  seeded (`hosting.frame.shim-posts-to-shell`, `hosting.frame.shell-saves-for-frame`).

### S37 — Isolated thumbnail renderer

- **Status:** done
- **Depends on:** S35
- **Linear:** ALI-319
- **Delivers:** hosting.thumbnail.off-without-renderer, hosting.thumbnail.sweep-is-system-read,
  hosting.renderer.only-isolated-renders, hosting.renderer.holds-no-secrets,
  hosting.renderer.sandbox-on, hosting.renderer.no-app-connection,
  hosting.renderer.no-private-network, hosting.renderer.stateless,
  hosting.renderer.input-cap

S35 screenshots uploaded HTML with Chromium inside the app's process and container, with the OS
sandbox off, next to every payload and the app's secrets — so it shipped off. This slice moves
rendering into a disposable, secret-free renderer role from the same image, with Chromium's
sandbox on and no route to the app or private networks, and turns thumbnails on wherever that
renderer is configured. (DDD amendment: `ddd/artefact-hosting.md` *Artefact thumbnails*, the
`hosting.renderer.*` requirements with the isolation evidence;
`hosting.thumbnail.off-without-renderer` restated; `hosting.thumbnail.sweep-is-system-read`'s
projection gains `payloadSize`.)

- **Domain** — `MAX_RENDER_INPUT_BYTES` = 10 MB beside `isThumbnailStale`; `ThumbnailJob` gains
  `payloadSize`, filled by `thumbnailJobOf` and `listNeedingThumbnail` (in-memory, Drizzle and
  the EE Postgres mirror). *(`hosting.renderer.input-cap`,
  `hosting.thumbnail.sweep-is-system-read`)*
- **Renderer role** (`src/renderer/`, bundled to `dist/renderer/index.js`) — its own env schema
  (`PORT` 3001, `ARTEFACTOR_RENDERER_EXIT_AFTER_JOB` default `true`,
  `ARTEFACTOR_RENDERER_MIN_UPTIME_MS` default 10000) and, in production, a startup self-check
  that refuses to start with `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_SECRET` / `DATABASE_URL` set,
  with the `DATABASE_PATH` or `ARTEFACTOR_PAYLOAD_DIR` directory present, or as uid 0. It never
  imports the server env, DB, storage or auth. `PlaywrightThumbnailRenderer` moves here with the
  same page isolation, but launches with `chromiumSandbox: true` (a failed launch makes the
  renderer unavailable — never a retry unsandboxed) and closes the browser after every job. Hono,
  concurrency 1: `GET /health` → `200 {"status":"ready"}` after a sandboxed probe launch, else
  `503 {"status":"unavailable","reason"}`; `POST /render` (HTML body, `Content-Length` required,
  else 411) → `200 image/webp` 512×320, `413` above the cap, `422` on a failed or timed-out
  render, `503` + `Retry-After` when unavailable, busy or draining. With exit-after-job, any
  answered render but a 413 drains the process: further work gets 503 and it exits `0` once its
  uptime reaches the minimum, for the restart policy to bring back a clean container.
  `pnpm dev:renderer` runs it without exiting.
- **Server** — `ARTEFACTOR_RENDERER_URL` (optional absolute `http(s)` URL; an empty value is
  unset) replaces `ARTEFACTOR_THUMBNAILS`. `thumbnailRendererFor(url)` builds an
  `HttpThumbnailRenderer` only when it is set; `ThumbnailService.start()` logs once that
  thumbnails are off and names the variable. `HttpThumbnailRenderer` POSTs the payload bytes to
  `${url}/render` with a 30 s timeout: `200` → the image; `413`, `422`, any other status or a
  timeout → a render failure (the hash is remembered as failed); connection refused / reset or
  `503` → retry after a short delay (honouring `Retry-After`) for up to 60 s, then
  `ThumbnailRendererUnavailable`. Nothing under `src/server/` imports `playwright-core`.
  `ThumbnailService` skips a job whose `payloadSize` exceeds the cap before reading the payload,
  and on `ThumbnailRendererUnavailable` **pauses** instead of disabling for the process: it clears
  pending, logs once, drops enqueues and re-runs the sweep after `resumeAfterMs` (5 min, an
  `unref`'d timer).
- **Packaging** — `docker-entrypoint.sh` with `ARTEFACTOR_ROLE=renderer` execs the renderer with
  no chown, migration or `gosu`, and refuses to run as root; the default role is unchanged. The
  `Dockerfile` drops `VOLUME ["/data"]` (an explicit named volume was already required).
  `deploy/docker-compose.example.yml` runs `app` + a hardened `renderer` from one image
  (`user: node`, `read_only`, tmpfs, `cap_drop: ALL`, `no-new-privileges`,
  `deploy/chromium-seccomp.json`, 1 GB / 1 CPU / 256 pids, no volume, no published port, no
  secrets, `restart: always`) on an internal link network plus an egress network;
  `deploy/renderer-egress.sh` adds the host firewall rules. `docs/renderer-isolation.md` holds the
  threat model, the layers, host prerequisites and the verification; `docs/deployment.md` the
  runbook. CI lifts Ubuntu's unprivileged-userns AppArmor restriction so the sandboxed browser
  tests run.

**Acceptance:**

r[hosting.renderer.env-parses-without-secrets]
**Renderer env** — parses with no secrets set; with `NODE_ENV=production` the self-check fails for
each of `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_SECRET` / `DATABASE_URL`, an existing
`DATABASE_PATH` or `ARTEFACTOR_PAYLOAD_DIR` directory, and uid 0; with `development` it passes.

r[hosting.renderer.http-input-cap]
**Input cap** — `POST /render` over `MAX_RENDER_INPUT_BYTES` → 413 with no launch.

r[hosting.renderer.busy-retry-after]
**Busy** — `POST /render` while a job is in flight → 503 with `Retry-After`.

r[hosting.renderer.unavailable-without-sandbox+2]
**Startup probe** — when the startup probe's sandboxed launch rejects, `GET /health` → 503 with a
reason and `POST /render` → 503.

r[hosting.renderer.failed-render-422+2]
**Failed render** — `POST /render` answers 422 when the render fails or times out, and 503 with
`Retry-After` when Chromium can't be launched for it.

r[hosting.renderer.one-job-per-process]
**Disposable** (fake clock, injected exit) — after a 200 at uptime 2 s the next request → 503 and
`exit(0)` runs at uptime 10 s, not before; a 413 doesn't drain; with exit-after-job off nothing
exits and the next render launches a new browser.

r[hosting.thumbnail.renderer-url-config]
**App env** — `ARTEFACTOR_RENDERER_URL` unset → no renderer, `start()` logs exactly one line naming
the variable, nothing renders; set → an `HttpThumbnailRenderer`; a non-URL → a startup validation
error.

r[hosting.renderer.http-client-retries]
**HTTP adapter** (stub server) — 200 → bytes; 422 and 413 → a render failure, not
`ThumbnailRendererUnavailable`; 503 twice then 200 → bytes with `Retry-After` honoured; connection
refused past the 60 s budget (fake clock) → `ThumbnailRendererUnavailable`; no response within the
timeout → a render failure.

r[hosting.renderer.entrypoint-roles]
**Image** — the entrypoint, with stubbed `node` / `gosu` / `id`: `ARTEFACTOR_ROLE=renderer` as uid
1000 execs `dist/renderer/index.js` with no chown or migration; as uid 0 exits non-zero; unset
keeps today's app path.

r[hosting.renderer.image-declares-no-volume]
**Volume** — the `Dockerfile` has no `VOLUME`.

The rest cite the requirements above or the DDD requirements the slice delivers, or are checked by
hand:

- **Import graph** — a test fails if anything reachable from `src/renderer/` imports
  `src/server/env`, `src/infra/db`, `src/infra/storage` or `src/server/auth`
  (`hosting.renderer.holds-no-secrets`), or if anything under `src/server/` reaches
  `playwright-core` or the Playwright renderer (`hosting.renderer.only-isolated-renders`).
- **Sandboxed launch** — `hosting.renderer.sandbox-on`: Chromium is launched with
  `chromiumSandbox: true`, and when that launch rejects the launch spy saw exactly one launch and
  none with the sandbox off.
- **Browser** (runs in CI, sandbox on) — `POST /render` of a fixture returns a 512×320 WebP, each
  render in a new browser (`hosting.renderer.stateless`); a busy-looping fixture is
  `hosting.renderer.failed-render-422`; S35's loopback-canary and WebSocket isolation still hold
  (`hosting.renderer.no-private-network`, `hosting.thumbnail.page-isolation`).
- **Network** — `hosting.renderer.no-private-network` and `hosting.renderer.no-app-connection`:
  `deploy/renderer-egress.sh` drops every private, loopback and link-local range from the egress
  bridge and the host, and the example Compose file's app link is internal with icc off, admitting
  only new connections to the renderer's port.
- **Service** — `hosting.renderer.input-cap`: `payloadSize` = cap + 1 → the payload is never read,
  the renderer never called, `thumbnailHash` stays null; exactly the cap → rendered.
  `hosting.thumbnail.off-without-renderer`: `ThumbnailRendererUnavailable` → one log line and
  pending cleared, and after `resumeAfterMs` the sweep renders what is still stale.
- **Projection** — `listNeedingThumbnail` (in-memory + Drizzle) and `thumbnailJobOf` include
  `payloadSize` (`hosting.thumbnail.sweep-is-system-read`).
- **Manual isolation check** (recorded in the PR) — on the compose example the renderer's env has
  no secrets, `/data` is absent, the root filesystem is read-only, connections to the app, a
  private IP and `169.254.169.254` fail while a public CDN succeeds, and one render makes the
  container exit and return with an empty tmpfs.

- **Out of scope:** gVisor or a microVM; deploying the renderer on Artefactor Cloud; humlytech's
  own Coolify change; Chromium patch cadence; per-tenant render quotas; renderer replicas or
  concurrency above 1; a durable queue; retrying failed hashes; object-storage thumbnails;
  isolating served artefacts in the browser; scanning or sanitising HTML.
- **Boundary:** **OSS** (the EE Postgres repository mirrors the `payloadSize` projection).

### S47 — Home: one landing screen for own and shared artefacts

- **Status:** done
- **Depends on:** S10, S14, S21, S28, S35, S46
- **Delivers:** views.record.on-owner-preview, views.mine.own-visible-only
- **Linear:** ALI-416

The designer's Home hand-back (`docs/design/templates/home.md`): one landing screen for what you
own and what is shared with you, headed by a **Recent** row. It supersedes the S14 — Shared with
you screen (its artefacts join Home behind the switch; its collection tiles move to the Sidebar)
and S46's interim "Shared with you" Sidebar entry. Host UI over data the shell already loads
(`hosting.access.matrix`, `collections.read.follows-root`), plus one read of the caller's own
views. (DDD amendment: `ddd/artefact-views.md` — the owner preview records a view,
`views.record.on-owner-preview`; own views, `views.mine.own-visible-only`.)

r[hosting.home.own-views]
**Own views.** `ViewRepository.listByViewer(viewerId)` → `{ artefactId, viewedAt }[]`, newest
first (in-memory, Drizzle and the EE Postgres mirror; no migration). The owner's
`GET /api/artefacts/:id/raw` records a view after the ownership check, best-effort as on
`/a/:slug`; `/:id/raw/frame` and the frame-token route record nothing
(`views.record.on-owner-preview`).
`listMyViews(viewerId, scope, deps)` keeps only entries for the caller's own active artefacts and
the artefacts effectively shared with them; `GET /api/views/mine` (signed-in) returns
`MyViewsResponse { views: { artefactId, viewedAt }[] }` (`views.mine.own-visible-only`).

r[hosting.home.model+2]
**Model.** `src/client/lib/home.ts` (pure): `HomeScope` (`all` / `mine` / `shared`),
`scopeList`, `scopeCounts` (library totals, whatever the filters), `recentList` (ranked by the
latest of my view and, for an own artefact, its `updatedAt`; a shared artefact I never opened is
left out; capped at 12), the Sort menu's order (`hosting.browse.one-sort`) and
`paginate(list, page, 24)` with the page clamped.

r[hosting.home.screen]
**Screen.** `Home` replaces `Dashboard` and `SharedGallery` (`View` loses `gallery`). Top to
bottom: Recent (one row of `ArtefactCard`s, as many as fit, ignoring the switch and filters;
hidden when empty); the filter and sort bar (the All / My artefacts / Shared with me switch with
counts, a Type dropdown by kind standing in for the design's Label, Access; Sort and the
card/list toggle on the right), wrapping by container width; All artefacts, paginated with the
stock shadcn `pagination` (hidden on one page). The switch, Type, Access, Sort and density
persist; the page doesn't, and changing any filter or the sort returns to page 1. Loading shows
stock shadcn `skeleton` cards and rows; the empty states are Upload (All or Mine), "Nothing has
been shared with you yet." and Clear filters (resets Type and Access).

r[hosting.home.shared-cards+2]
**Cards.** Home and collection pages show every artefact as an `ArtefactCard` / `ArtefactRow`.
Another user's is their viewer variant: a read-only access badge instead of the visibility
control, "Shared by …" (hidden when public), and a menu of only what a viewer may use — Open,
Bookmark and Download HTML — plus Remove from collection for the collection's owner on their own
collection page. Opening any card stamps its view locally; views reload on window focus.

r[hosting.home.sidebar-shared]
**Sidebar.** The interim "Shared with you" item goes; a **Shared with me** group under
Collections lists the root trees shared with you, expandable, with the owner's name, opening the
collection page.

- **Out of scope:** owner-set labels (ALI-418); collection pages' sorts; server-side pagination or
  search; recording views on MCP reads or downloads; the "Viewed by" widget.
- **Boundary:** **OSS** (the EE Postgres view repository mirrors `listByViewer`).

### S54 — Artefact card: one access row, collection row and share-link footer

- **Status:** done
- **Depends on:** S25, S27, S28, S30, S32a, S35, S47
- **Linear:** ALI-469
- **Delivers:** hosting.url.share-link, hosting.listing.collection-named-only-if-visible

The designer's Artefact card hand-back
([`docs/design/components/artefact-card.md`](../../../design/components/artefact-card.md)) reworks
the grid card for both of S47's modes, owner and viewer. Host UI over data the client already loads:
no endpoint, contract or invariant changes. Every access decision on the card reads
`effectiveVisibility` (`hosting.access.effective-from-tree-root`); the lock and clock come from
`linkGate`, which only an owner's summary carries (`hosting.link-gate.owner-summary-only`); a
viewer's collection resolves only through the nodes the client already holds
(`collections.read.follows-root`, S28); and a viewer's Download HTML adds no authority, since the
route already admits every viewer (S30). It supersedes S47's viewer menu (Open, Copy share link, Bookmark).

- **Model.** `src/client/lib/artefact-card.ts` (pure): `shareLinkOf`, `cardMeta`,
  `collectionRowOf` and `menuItemsOf`, deciding the four rules below. `ArtefactCard` and
  `MoreMenu` render from it.
- **Anatomy.** S62 — Artefact card: one card for every artefact, kind by the title, access on the
  bottom edge supersedes this slice's anatomy: no kind badge, no metadata size and no share-link
  footer, and the access row moves to the bottom edge. Kept from here: the thumbnail's top-right
  saved-data icon and, when bookmarked, a "Remove bookmark" button whose Undo toast re-adds it — a
  sibling of the thumbnail's open button, never inside it; the **access row** (owner: the access
  badge — lock and clock inside it for a protected link — and a right-aligned **Share** button;
  viewer: the badge and "Shared by …"); the **collection row** ("In \<name>", opening the
  collection).
- **Share, interim.** On a top-level artefact, Share opens the Manage access dialog (S55). On an
  artefact inside a collection it opens the "Access inherited" popover (S64).
- **Menu.** Owner: Open · Bookmark · Add/Move to collection… · Edit · Download HTML · Archive.
  Viewer: Open · Bookmark · Download HTML. `ArtefactRow` shares the menu.
- **Labels.** `authenticated` reads "Org members" ("Anyone in the organisation"); `selected`
  keeps "Specific people" with "Only org members you invite".

r[hosting.card.share-link-unless-private+6]
A viewer's card or list row shows a Share button that copies the share link
(`hosting.url.share-link`), and the "Access inherited" popover behind an owner's Share shows the
link at its top, exactly when the artefact's effective tier isn't private and it has a slug.
Neither the card nor the list row shows a share link of its own.

r[hosting.card.public-hides-activity+2]
When the effective tier is public, the card and the list row hide the last-activity text, and on a
viewer's item the "Shared by" attribution.

r[hosting.card.collection-only-if-visible+3]
The card and the list row show a collection row naming the artefact's collection only when that
collection is in the signed-in user's loaded collection lookup — their own active and archived nodes
and the shared trees — and otherwise none (`hosting.listing.collection-named-only-if-visible`).

r[hosting.card.viewer-menu-downloads+2]
A viewer's card or row menu offers Download HTML, and no card or row menu offers Copy share link.

- **Out of scope:** several collections per artefact ("In X and N more"); the generating-preview
  thumbnail state; "Shared … ago" activity; the Manage access dialog (ALI-470); the Artefact row's
  layout (S56 — Artefact row: the card's content and actions on one row).
- **Boundary:** **OSS**.

### S55 — Manage access dialog: one draft, saved atomically

- **Status:** done
- **Depends on:** S16, S32a, S41, S54
- **Linear:** ALI-470
- **Delivers:** hosting.sharing.atomic-save, hosting.sharing.members-replace,
  hosting.sharing.applies-in-order

The designer's Manage access dialog hand-back
([`docs/design/components/manage-access-dialog.md`](../../../design/components/manage-access-dialog.md))
puts every sharing setting of a top-level artefact in one dialog, kept as a draft and saved
together on **Done**. The save is the *set sharing* command
([`ddd/artefact-hosting.md`](../../ddd/artefact-hosting.md), *Amendment — set sharing*), so a
failed Done changes nothing.

- **Endpoint.** `PUT /api/artefacts/:id/sharing` takes a `SetSharingRequest` — `visibility`
  (always), and optionally `members` (the full `sharedWith`), `linkGate` (only with `public`, a
  `SetLinkGateRequest`) and `dataVisibility` — and answers the updated `ArtefactSummary`. Owner
  only: a non-owner or unknown id is 404; a bad body, an unknown added member (`unknown user`) or a
  refused part is 400, and nothing is saved. The domain function is `applySharing`
  (`src/domain/artefact/sharing.ts`), the command `setSharingCommand`
  (`src/server/artefacts/set-sharing.command.ts`). The per-setting endpoints and the MCP tools stay.
- **Model.** `src/client/lib/access-dialog.ts` (pure): `draftOf` turns the saved state into a
  draft; `chooseLevel`, `withLoadedMembers`, `sectionsOf`, `sharingRequestOf`, `saveToastOf` and
  `protectionError` decide the rules below. Specific people starts from the artefact's remembered
  access list — retained across tiers (`hosting.access-list.retained`) — so a brief switch to
  Private doesn't cost the owner their invitations.
- **Dialog.** `ArtefactAccessDialog` (`src/client/lib/components/`), on the stock `Dialog`, top to
  bottom: the header ("Manage access" · "Who can open “\<title>”"); **General settings**, a
  full-width trigger opening the four levels as a listbox (the stock `Select`); **Link**, the
  copyable `/a/<slug>`, or "The link is created when you click Done." before the first share;
  **Viewers**, the directory search, a `Command` combobox whose results open in a `Popover` over
  the sections below, and the draft's people; **Link protection**, `LinkProtection`
  bound to the draft; **Saved data**, a two-option `ChoiceList` radio group; and Cancel · Done.
  Done with a change sends one `api.setSharing`, closes, refreshes the library and shows one toast
  ("“T” is now …", "N people can now open “T”", "Public link settings saved", or the saved-data
  choice) with Undo; a failure keeps the dialog open and shows "Couldn't make “T” public. Try
  again." (or "Couldn't save access for “T”. Try again."). Done is disabled while link protection
  has an error.
- **Entry points.** A top-level artefact's card Share opens the dialog. An artefact inside a
  collection keeps the "Access inherited" popover; collections keep `ManageAccessDialog` and
  today's popover. The list row's Share opens the same dialog since S56 — Artefact row: the card's
  content and actions on one row.

r[hosting.access-dialog.sections-by-level]
The dialog shows Link exactly when the draft level isn't private, Viewers exactly under Specific
people, Link protection exactly under Public, and Saved data exactly when the artefact saves data
and the draft level isn't private.

r[hosting.access-dialog.level-change-start]
Choosing Specific people starts from the artefact's remembered access list whatever the saved
level, and choosing Public when the saved level is another starts with protection off. Returning
to saved Public restores its saved protection.

r[hosting.access-dialog.load-keeps-list]
An edit made while the artefact's access list is still loading never drops it: when the list
arrives, the draft's people are the loaded list plus anyone added meanwhile, whatever else the
owner changed. Done is disabled until the list has loaded.

r[hosting.access-dialog.search-popover]
Under Specific people, typing in the search field opens the results in a popover anchored under
the field and drawn over the sections below, so the dialog keeps its height as results come and
go. Clearing the field closes it, and Esc or a click outside closes it without closing the dialog.

r[hosting.access-dialog.search-keyboard+2]
In the search field, ↑ and ↓ move the highlight through the results, and Enter adds the
highlighted person as a click does. Adding clears the field, closes the popover and leaves focus
in the field. Home and End move the caret; results of an older query are never shown. Closed by
Esc or a click outside while the field holds a query, the popover reopens on ↓, ↑ or a click in
the field.

r[hosting.access-dialog.draft-until-done]
No access change is sent before Done. Done with no change sends nothing, and Cancel, Esc or
clicking outside discards the draft.

r[hosting.access-dialog.undo-unless-password]
The saved toast offers Undo, restoring the saved state, unless the save set, changed or cleared a
password, or moved away from Public while a password was set.

- **Out of scope:** collections' access UI; an MCP tool for the
  atomic save (agents keep `set_visibility` / `set_data_visibility`); removing the per-setting
  endpoints; Undo after a password change; email invitations (EE EI2).
- **Boundary:** **OSS**.

### S56 — Artefact row: the card's content and actions on one row

- **Status:** done
- **Depends on:** S54, S55
- **Linear:** ALI-475
- **Delivers:** hosting.card.share-link-unless-private, hosting.card.public-hides-activity,
  hosting.card.collection-only-if-visible, hosting.card.viewer-menu-downloads

The designer's Artefact row hand-back
([`docs/design/components/artefact-row.md`](../../../design/components/artefact-row.md)) gives the
list-view row the content and actions of S54's card, laid out on one row. Host UI over data the
client already loads, like S54: no endpoint, contract or invariant changes, and every access
decision reads `effectiveVisibility` (`hosting.access.effective-from-tree-root`).

- **Model.** `rowMetaOf` (`src/client/lib/artefact-card.ts`, pure) gives the meta line's parts in
  order by composing the card's deciding functions; S65 sets which parts it names
  (`hosting.row.meta-line`).
- **Anatomy**, left to right (`ArtefactRow`, `src/client/lib/components/ArtefactRow.tsx`): the
  40px **kind tile** ("Open \<title>"); the **title block** — the one-line title with its full text
  as a tooltip, a "Remove bookmark" button after it when bookmarked (a sibling of the title, never
  inside it; its Undo toast re-adds the bookmark), and the meta line, owner and viewer alike, whose
  "·" separators end the part before them so a wrapped line never starts with one; the **right
  group** — S54's access badge (lock and clock inside it for a protected link), the inherited mark
  and **Share** S65 sets by role, and the shared "More actions" menu. On a
  narrow row (a container query) the right group drops below the title block, right-aligned. Hover
  tints the border and adds a soft shadow, with no lift.
- **The card's rules are the row's.** The four `hosting.card.*` requirements now cover the row;
  each is still decided by its one function in `artefact-card.ts`, which the row calls.
- **Share.** A top-level artefact's Share opens S55's Manage access dialog; inside a collection it
  opens the "Access inherited" popover, the same trigger the card uses.
- **Retired.** The row no longer renders the access pill, and nothing opens the people-only
  `ManageAccessDialog` for an artefact: `OwnedItemProps` drops `onManage`, `onVisibility` and
  `onLinkGate`. The pill and `ManageAccessDialog` stay for the collection header.
- **Out of scope:** several collections per artefact ("In X and N more" and its dialog); rewording
  the failure toasts to "Couldn't … Try again." (shared with the card, a follow-up); the collection
  header's pill and people-only dialog; the Manage access dialog itself (S55); "Shared … ago"
  activity and the generating-preview state; removing `VisibilityControl`'s `pill`
  variant.
- **Boundary:** **OSS**.

### S60 — Save concurrency: a save never overwrites a newer artefact

- **Status:** done
- **Depends on:** S3, S16, S18, S41
- **Linear:** ALI-370
- **Delivers:** hosting.save.no-lost-update, hosting.save.reapply-on-conflict

Every Artefact command loads the aggregate, applies a pure domain function and saves the whole
row, so two overlapping commands on one artefact could each write their stale copy of every other
field — an edit uploading a large payload reverting a concurrent unshare or data-visibility flip.
The save becomes a compare-and-set on `revision` and every command re-applies its intent on
conflict ([`ddd/artefact-hosting.md`](../../ddd/artefact-hosting.md), *Amendment — save
concurrency*: `hosting.save.no-lost-update`, `hosting.save.reapply-on-conflict`).

- **Repository.** `ArtefactRepository.save(artefact): Promise<Artefact>` returns the persisted
  aggregate at its new revision; `ArtefactConflict` (a `DomainError`) when it lost. The SQLite
  `artefact.revision` column defaults to 1 for existing rows; the Postgres mirror matches it.
- **`mutateArtefact`** (`src/server/artefacts/mutate-artefact.ts`) loads, applies and saves —
  skipping the save when `apply` returns the same object — and on `ArtefactConflict` starts again
  from `load`, at most 3 attempts. Errors from `load` and `apply` propagate at once. Every Artefact
  save but create's goes through it: edit, set visibility, set sharing, set data visibility, grant,
  revoke, set and clear the link gate, archive, restore, move, eject, and the collection cascades
  and slug back-fill. Edit stores its payload once, before the loop, and deletes the payload ref of
  the aggregate it finally saved over.
- **Surfaces.** A conflict that survives the retries is a BFF **409** and an MCP error result.

r[hosting.save.conflict-http]
An `ArtefactConflict` that survives a command's retries answers **409** `{ "error": "conflict" }`
on any BFF route; every other uncaught error keeps Hono's default 500.

- **Out of scope:** a client-side `If-Match`/ETag (`revision` stays out of the contracts); the
  `Collection` aggregate's save; Artefact Data entries; thumbnails' own compare-and-set.
- **Boundary:** **OSS** core, with the Postgres mirror in `ee/`.

### S62 — Artefact card: one card for every artefact, kind by the title, access on the bottom edge

- **Status:** done
- **Depends on:** S29, S54, S55, S56
- **Linear:** ALI-524

The designer's reworked Artefact card hand-back
([`docs/design/components/artefact-card.md`](../../../design/components/artefact-card.md)): one card
with an owner and a viewer variant, used on Home and on collection pages alike. Host UI over data
the client already loads: no endpoint, contract or invariant changes. Every access decision still
reads `effectiveVisibility` (`hosting.access.effective-from-tree-root`); the viewer's Share button
copies the same link, under the same condition, that S54's footer did; and the viewer's Download
HTML on a collection page adds no authority, since the route already admits every viewer (S30).

- **Anatomy**, top to bottom: the **thumbnail** (no kind badge; the saved-data icon and bookmark
  button top-right); the **title row** (the kind icon, `role="img"` named after the kind, in the
  `--kind` colour · the title, up to two lines, then truncated · "More actions"); the **collection
  row** ("In \<name>"); the **activity** ("Updated …", hidden when public — no size); the
  **access row**, pinned to the bottom edge (owner: the access badge · an inherited icon named
  "Access inherited from “\<root>”" after the tree root, S65 · a right-aligned **Share**; viewer:
  the badge · "Shared by …" · a right-aligned **Share**, labelled "Copy link", that copies the
  share link and opens no dialog). No share-link footer. Every card fills its grid cell, so a grid
  row's access rows line up along the bottom. Tab order: thumbnail → bookmark → title → "More
  actions" → collection → Share.
- **One card.** Collection pages render other users' artefacts as the viewer's `ArtefactCard` /
  `ArtefactRow`, with no collection row, exactly as Home's "Shared with you" does. On their own
  collection page, the collection's owner gets **Remove from collection** in a foreign artefact's
  "…" menu, after a separator, over the existing eject command (S29, `collections.containment.co-owned`).
- **Copy.** One handler serves the card's and the row's copy: it toasts "Link copied ·
  \<host>/a/\<slug>" once the clipboard write resolves.

r[hosting.card.long-title]
On the grid card a long title wraps to at most two lines, then truncates with "…"; the full title
is the title's tooltip.

r[hosting.card.copy-failure-says-so]
Copying an artefact's share link from a card or list row toasts "Link copied" only when the
clipboard write succeeds; when there is no clipboard or the write fails, it toasts "Couldn't copy
the link".

- **Out of scope:** the rest of ALI-482's feedback (Share floating on the thumbnail, an
  always-visible bookmark toggle, an artefact details page, a more distinct owned vs. shared look);
  the Artefact row's layout (S56 — Artefact row: the card's content and actions on one row, and
  S65); the generating-preview state (ALI-477); the wording of
  the other failure toasts (ALI-481); the kind icon in the top bar's search and in Archive; several
  collections per artefact and "Shared … ago" activity; the Manage access dialog, the "Access
  inherited" popover and the eject command.
- **Boundary:** **OSS**.

### S64 — Access inherited popover: the share link at the top

- **Status:** done
- **Depends on:** S25, S32b, S41, S62
- **Linear:** ALI-525
- **Delivers:** hosting.card.share-link-unless-private

The designer's "Access inherited" popover hand-back
([`docs/design/components/access-inherited-popover.md`](../../../design/components/access-inherited-popover.md)),
landed as its own component. Host UI over data the client already loads: no endpoint, contract or
invariant changes. The access level stays read-only, since the tree root governs
(`hosting.access.effective-from-tree-root`).

- **Component.** `AccessInheritedPopover` owns its popover, wraps a trigger, and is labelled by its
  "Access inherited" title. Top to bottom: the **Link** section (when given) · the inherited
  explanation · the read-only link protection (S32b) · Open "\<collection>" · Saved data (S41), a
  `radiogroup` named "Saved data".
- **The tree root.** The explanation ("This artefact is in “\<root>” and follows its access. Change
  it on the collection.") and Open "\<root>" name and open the **tree root** the artefact's access
  follows (`accessRootOf`), the one collection where that access can be changed. For an artefact
  directly in a root that is its own collection; in a nested collection it is that tree's root,
  not the nested collection, whose own header pill is read-only too. The card's and row's "In
  \<collection>" link still names and opens the artefact's own collection.
- **Two triggers.** An owner's **Share** on a card or row inside a collection opens it 288px wide,
  with the Link section; a nested collection header's **access pill** opens it 256px wide, never
  with the Link section, since a collection has no `/a/<slug>` link.
- **Link.** A "Link" label, then `/a/<slug>` as a mono link button named "Copy link /a/\<slug>",
  titled "Copy \<origin>/a/\<slug>". Clicking it runs the card's and row's copy handler (S62)
  and leaves the popover open. It shows under `hosting.card.share-link-unless-private`, so an
  expired inherited gate still shows it: the gate governs who opens the link, not whether it
  exists.
- **Out of scope:** a trigger on the card's access badge; the popover's wording on a nested
  collection header; changing access from the popover; the Manage access dialog, the card's and
  row's layout (S62, S56) and the copy handler's wording (S62); several collections per artefact.
- **Boundary:** **OSS**.

### S65 — Artefact row: a leaner meta line, the card's inherited icon and the viewer's Share

- **Status:** done
- **Depends on:** S56, S62, S64
- **Linear:** ALI-527

The designer's reworked Artefact row hand-back
([`docs/design/components/artefact-row.md`](../../../design/components/artefact-row.md)) brings
S56's row in line with S62's card. Host UI over data the client already loads: no endpoint,
contract or invariant changes. Every access decision still reads `effectiveVisibility`
(`hosting.access.effective-from-tree-root`) through the card's deciding functions, and the
viewer's Share copies the same link, under the same condition, as the viewer card's Share.

- **Meta line.** `rowMetaOf` (`src/client/lib/artefact-card.ts`) gives "Shared by …" · "In
  \<collection>" · saved data · "Updated …", each only when it applies, composing `cardMeta` and
  `collectionRowOf`. The kind tile is the only place the kind shows. With no part, `ArtefactRow`
  leaves the line out and the title centres on the kind tile.

r[hosting.row.meta-line]
A list row's meta line names, in this order and each only when it applies: who shared it, its
collection, that it saves data, and its last activity. It names no kind, size or share link. When
no part applies, the row has no meta line.

- **Right group, by role.** Owner: the access badge · the card's inherited icon ("Access inherited
  from “\<root>”", inside a collection) · **Share** · "More actions". Viewer: the access badge ·
  the card's **Share** that copies the link (`hosting.card.share-link-unless-private`), hidden when
  there is none · "More actions". `ArtefactRow` reuses `InheritedIcon` and `ViewerShare` from
  `ArtefactCard.tsx`; on a narrow row the inherited icon drops with the right group.
- **Inherited from the tree root.** The inherited icon, on the card and the row alike, names the
  tree root whose access the artefact follows (`hosting.access.effective-from-tree-root`), the
  same collection the "Access inherited" popover names (`inheritedFrom`, `ArtefactCard.tsx`). In a
  nested collection that is the root, not the artefact's own collection.
- **Tooltips.** The owner's Share is titled after what it opens: "Manage access" on a top-level
  artefact (the Manage access dialog), "Access inherited" inside a collection (the popover). The
  viewer's Share is titled "Copy link". The buttons are the card's, so the card gets the tooltips
  too.
- **No Size sort.** No card or row shows a payload size, so there is no Size sort. A remembered
  `size` sort falls back to the default (`hosting.browse.one-sort-pref`).
- **Out of scope:** several collections per artefact; rewording the failure toasts (ALI-481); the
  generating-preview state (ALI-477); the card's layout beyond the two tooltips and the inherited
  icon's name (S62); the "Access
  inherited" popover's content (S64), the Manage access dialog (S55) and the collection header's
  pill; a tooltip naming the kind on the kind tile.
- **Boundary:** **OSS**.

### S66 — Artefact opens without flicker: the shell holds until the frame has loaded

- **Status:** done
- **Depends on:** S21, S36, S45
- **Linear:** ALI-515

The frame controller points the `<iframe id="ae-frame">` at its tokened URL on boot (S36), and the
iframe stays transparent until the artefact's first paint, so the shell's background shows through
the frame area for as long as the frame request takes; in dark mode, a light artefact painting
there a frame or two after the chrome would arrive as a dark → light switch. So the shell holds:
from first paint only its body background shows, and the chrome and the artefact appear together
once the frame has loaded — on the iframe's `load`, which waits for the artefact's subresources,
or at a 3 s cap, after which a slow artefact finishes painting into a visible chrome. Measured on
a light artefact under a dark stored theme, the open paints two states (blank or the dark canvas,
then the finished page). This is host presentation only: nothing is set on or injected into the
frame (`platform.theme.frame-unthemed`), and the iframe keeps its sandbox, its `allow` list and its
frame-controller-assigned URL (S36). The shell learns the frame has loaded from the iframe
element's own `load` event, which needs no access to the opaque-origin document.

- **Hold.** `renderHostShell` renders `<html class="ae-hold">` and the shell stylesheet's
  `html.ae-hold body > * { visibility: hidden; }`; the body background is outside the rule, so the
  canvas paints the chrome's theme while the toolbar, the banners and the iframe are invisible and
  out of the accessibility tree. The iframe is rendered `aria-busy="true"`.
- **Release.** `shellFrameJs` wires a `load` listener on the iframe and a `FRAME_HOLD_MAX_MS`
  (3000 ms) timer before it assigns the frame URL and before its anonymous early return; whichever
  fires first removes `ae-hold` and the iframe's `aria-busy`.
- **Viewers count.** `#ae-viewers-count` reserves its slot invisibly (`visibility: hidden`) from
  first paint, so no empty pill shows while the viewers fetch is out; the fetch reveals it by
  inheritance (an explicit `visible` would show it through the hold), and zero viewers or a failed
  fetch collapse it with the `hidden` attribute, which a
  `.ae-viewers-count[hidden] { display: none }` rule lets win over its `display`.

**Acceptance:**

r[hosting.shell.hold-until-frame]
From first paint the shell shows only its body background: `<html class="ae-hold">` hides every
child of `body` until the iframe's `load` event or `FRAME_HOLD_MAX_MS` (3 s), whichever first. The
release is a single, idempotent style change with no transition, is wired before the frame URL is
assigned, applies to anonymous viewers too, and is never raised again by a later frame navigation.
Nothing is set on or injected into the frame.

r[hosting.shell.viewers-count-reserved]
The Viewers count never shows as an empty pill: it reserves its slot invisibly from first paint,
the viewers fetch fills and reveals it, and zero viewers or a failed fetch collapse it.

- **Out of scope:** a cover element or a fade over the frame; the frame URL in the markup (a
  browser can restore a stale one from session history); re-raising the hold on a later frame
  navigation; the data-context picker's late reveal.
- **Boundary:** **OSS**.

### S72 — Host shell chrome loads nothing from another origin

- **Status:** done
- **Depends on:** S66
- **Linear:** ALI-546

The shell's chrome is set in the app's system sans stack and loads no web font. A web-font
stylesheet in its `<head>` would need a fresh connection on every cold open and hold the shell's
first paint for it (measured at ~550–830 ms for Google Fonts; the frame request waits behind it),
then swap the toolbar text when the font file lands; the SPA opens every artefact in a new tab, so
such a font is never warm. It would also send every viewer's IP to a third party. With S66's hold,
the chrome and the frame reveal together, so the earlier first paint can't bring back a dark →
light switch. This is host
presentation only: the frame keeps its sandbox, its `allow` list and its tokened URL
(`platform.theme.frame-unthemed`), and an artefact may still load any font it likes.

- **Markup.** `renderHostShell` writes no `preconnect` and no external stylesheet. The body's
  `font` is `14px/1.4` over Tailwind's default `--font-sans` stack, the one the SPA uses
  (`docs/design/foundations/typography.md`); a test reads it from Tailwind's `theme.css`, or from
  `src/client/app.css` when the app sets its own, so a Tailwind bump or an app font change fails
  until the shell follows.

**Acceptance:**

r[hosting.shell.no-third-party-chrome]
The host shell's chrome loads nothing from another origin: its markup references no stylesheet,
font, script or image outside the app's origin, and the frame URL (on the content origin, when
set) is its only cross-origin reference. Its text is set in the app's system sans stack, so it
paints with no web-font request and no swap.

- **Out of scope:** the artefact's own requests (artefacts are trusted HTML and may load web fonts
  or anything else); a `Content-Security-Policy` on the shell that enforces the rule; the frame
  URL in the markup (S66); the SPA's typography and the EE legal pages, which already use system
  stacks; self-hosting Geist or any other web font.
- **Boundary:** **OSS**.

### S79 — Database refuses a payload ref shared by two artefacts

- **Status:** done
- **Depends on:** S2
- **Linear:** ALI-651
- **Delivers:** hosting.payload.ref-unique-in-database

`hosting.payload.ref-owned-by-one-artefact` lets the edit and permanent-delete commands dispose of
an artefact's old ref unchecked, and `PayloadStore.put` minting a fresh ref per call holds it only
for the writers that use it. This slice backs it in storage: a unique index on
`artefact.payload_ref`, in SQLite and in the EE Postgres schema, so a writer that copies another
artefact's ref fails at its save.

- **Errors.** A violation surfaces as the driver's unique-constraint error from `save`, an
  unexpected error like any other: a 500 on the BFF, a tool error over MCP. It marks a programmer
  error in a writer, not user input, so no domain error or 4xx is added.
- **Out of scope:** the in-memory `ArtefactRepository` (the rule is a storage backstop, decided by
  the schema); a pre-flight duplicate count against production; extending the EE parity script to
  compare indexes; uniqueness of `payload_hash` (identical content under separate refs stays
  allowed); EE artefact-history version rows, which key payloads in their own table.
- **Boundary:** **OSS** (the Postgres index rides along under `ee/`).

### S82 — One sort menu for Home and collection pages

- **Status:** done
- **Depends on:** S47, S65
- **Linear:** ALI-532

Home and collection pages sort from one menu, over one option set, under one remembered choice.
Sorting stays a client-side presentation of lists the caller already sees: Home's list comes from
`hosting.home.model`, a collection page's from `collections.read.follows-root`, and "Last viewed"
reads only the caller's own views (`views.mine.own-visible-only`), which the shell loads once and
stamps locally on every open.

r[hosting.browse.one-sort]
Home and every collection page offer one Sort menu with the same options, in this order and under
these labels: "Last updated" (by last edit or upload, newest first; the default), "Last viewed"
(the caller's own views, newest first, then never-viewed by last update) and "Title A–Z".

r[hosting.browse.one-sort-pref]
The Sort choice is one remembered preference shared by Home and collection pages. A remembered
value outside the menu's options falls back to "Last updated".

- **Model.** `src/client/lib/browse.ts`: `SORTS` (`updated`, `viewed`, `title`), `SORT_LABELS`,
  and `sortList(list, sort, views)`; `applyFilters` passes the views through. `home.ts` keeps no
  sort set of its own: `applyHomeFilters` sorts with `sortList`.
- **Menu.** A module-private `SortMenu` in `src/client/lib/components/Browse.tsx` (the outline
  `Button` trigger, named "Sort:" and the current label, over a `DropdownMenuRadioGroup`),
  rendered by both `ViewControls` and `HomeControls`.
- **Choice.** One `usePref("sort", …)` in `src/client/AppShell.tsx` feeds Home and the collection
  page; changing it on Home returns to page 1. A stored `artefactor:home-sort` is neither read,
  moved over nor cleared.
- **Out of scope:** server changes (`GET /api/views/mine` and `listMyViews` are unchanged; an
  artefact with no view in that response sorts as never-viewed); moving the old
  `artefactor:home-sort` value over; a sort direction toggle or any further sort; the stock
  `dropdown-menu.preview.tsx` example items; the Archive screen's ordering.
- **Boundary:** **OSS**.
