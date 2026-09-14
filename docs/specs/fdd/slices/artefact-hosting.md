# Artefact Hosting

## Slices

### S2 — Create artefact

- **Status:** done
- **Depends on:** S1

- Authenticated owner creates an artefact from title + kind + HTML upload.
- New artefact is `active` / `private`, `publicSlug = null`. *(AH create)*
- Rejects empty payload, oversize payload, empty title. *(AH 2, 3)*
- `ownerId` = current session user. *(AH 1)*

**Implementation notes (from building S2):**

- The pure-domain `createArtefact` factory (+ its invariant tests) already landed in S0;
  S2 is the vertical slice around it. **Drizzle adapter** for the `ArtefactRepository` port
  (`src/infra/db/artefact-repository.drizzle.ts`) — `save` is an upsert by id so it also
  serves later mutation slices; `findById`/`findBySlug` map row ↔ aggregate.
- **Application command** (`src/server/artefacts/create-artefact.command.ts`) wires the
  `PayloadStore` + repo around the factory: cheap pre-validation (kind, empty/oversize
  payload) avoids needless filesystem writes, the factory stays the AH-invariant authority,
  and a stored payload is deleted again if the aggregate is rejected (no orphans).
- **BFF endpoint** `POST /api/artefacts` (`src/server/routes/artefacts.ts`): `requireAuth`
  → session user is the `ownerId` (AH1); `multipart/form-data` with `title`, `kind`, and an
  HTML `payload` file (oversize rejected before buffering); `InvariantViolation → 400`,
  success → `201` `ArtefactSummary`. Adapters constructed once in `routes/index.ts`.
- **Client** (`App.svelte` + `lib/components/UploadModal.svelte`): a signed-in **Upload dialog**
  — drag-drop or pick a single `.html` file, title + kind select from `ARTEFACT_KINDS` — posting
  the multipart body. (This same dialog is the manual-upload "Path B" of the S18 connector.)
- **Tests:** command unit test with in-memory repo + a recording fake payload store (asserts
  invariants and no orphan payload), plus an end-to-end `artefacts.test.ts` (sign-up → upload
  → 201/401/400 + Drizzle round-trip through the `owner_id` FK).

### S3 — Edit artefact

- **Status:** done
- **Depends on:** S2

*Shipped with S7.*

- Owner updates title / kind / payload; `updatedAt` bumps.
- Same payload/title invariants as create. *(AH 2, 3)*
- Rejected if artefact is archived. *(AH 7)*
- Non-owner cannot edit. *(AH 8)*

**Implementation notes (from building S3):**

- **Domain** `editArtefact(a, { title?, kind?, payload? })` — only the provided fields
  change, re-applies the create invariants (AH2/3), bumps `updatedAt`, blocked while
  archived (AH7).
- **Command** (`edit-artefact.command.ts`) loads the caller's own active artefact
  (`loadOwnActiveArtefact`; archived/non-owner → not-found, AH7/8), validates the kind, and
  on payload replacement stores the new bytes, then deletes the **previous** payload only
  after a successful save (new one cleaned up on rejection — no orphans).
- **BFF** `PATCH /api/artefacts/:id` (multipart, partial): `ArtefactNotFound → 404`,
  `InvariantViolation → 400`, returns the updated summary.
- **Client** (`App.svelte` + `UploadModal.svelte`): the same Upload dialog in **edit mode**
  (title / kind / optional replacement `.html`), opened per row → `PATCH` via `api.update`.

### S4 — Owner views own artefact

- **Status:** done
- **Depends on:** S2

- Owner can view their own `active` artefact at any visibility.
- Archived gets 404 (reached only via "Your artefacts" restore). *(AH 7)*

**Implementation notes (from building S4):**

- **`loadOwnActiveArtefact(repo, { id, ownerId })`** (`src/server/artefacts/get-own-artefact.ts`):
  owner-scoped load where missing / not-owned / archived all surface identically as
  `ArtefactNotFound`, so neither a private artefact's existence nor its archived state leaks
  (AH7/AH8). Shared by both view endpoints (and reusable by S3 edit).
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

- Share raises visibility to `authenticated` or `public`; mints a unique slug on first
  share, reuses the retained slug thereafter; tier can be changed between the two. *(AH 4, 5, 6)*
- Unshare sets `private`, retains slug. *(AH 5)*
- Owner-only; blocked while archived. *(AH 7, 9)*

**Implementation notes (from building S5):**

- **Domain** (`artefact.ts`): pure `shareArtefact` (mint-once-via-supplied-slug / retain,
  set tier, block while archived) and `unshareArtefact` (→ `private`, retain slug). New
  `ArtefactNotFound` domain error covers both "missing" and "not yours" so a private
  artefact's existence can't be probed (AH8).
- **Slug** generation lives in the app layer (`src/server/artefacts/slug.ts`,
  `randomBytes(8).base64url`) — the domain stays node-free, mirroring how the id is supplied
  to the create factory. Uniqueness (AH6) is enforced by the command, which collision-checks
  generated slugs against `repo.findBySlug` and regenerates.
- **Command** (`set-visibility.command.ts`): one operation for all three transitions — loads
  the artefact, treats a non-owner as not-found (AH9), mints a unique slug only on first
  share, and delegates the transition + archived guard to the domain.
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

- Serving an `active` artefact by slug enforces the access matrix: `public` → anyone;
  `authenticated` → any signed-in user; `private` → owner only. *(AH 8)*
- Wrong-tier viewer, archived, and unknown slug → 404. *(AH 7, 8)*

**Implementation notes (from building S6):**

- **Domain** `access.ts`: pure `canViewArtefact(artefact, viewerId)` encoding the matrix,
  gated by archived-is-inert (AH7). `viewerId = null` is the unauthenticated viewer. Reused
  later by "Shared with you" (S14) and data access (S11/S12).
- **Serving route** `GET /a/:slug` (`routes/serve.ts`) — its own `attachSession` (it lives
  outside `/api`), resolves the slug via `repo.findBySlug`, applies the matrix, and on allow
  streams the trusted HTML **as-is** via `c.html` (`text/html; charset=UTF-8`, no
  sanitization). On deny it splits by whether the viewer is authenticated: a **signed-in**
  viewer who is denied (unknown slug, archived, wrong-tier) gets a flat `404`; an
  **unauthenticated** viewer is redirected (`302` → `/?returnTo=<path>`) to sign in and then
  bounced back to the artefact (so a `Members` link works for an org member who has no account
  yet). The redirect is **uniform across every unauthenticated miss**, so existence is still
  never leaked (AH8). Mounted in `app.ts` **before** the static/SPA fallback.
- **Adapters** lifted to `src/server/adapters.ts` (one Drizzle repo + filesystem payload
  store) so the API routes and the serving route share a single composition root.
- **Tests:** access-matrix unit test (the full grid incl. archived) + an end-to-end serving
  test (public→anyone, authenticated→signed-in only, private→owner only; signed-in deny →404
  incl. archived for the owner; unauthenticated deny →`302` sign-in redirect with `returnTo`,
  uniform for unknown slug / private / archived so existence isn't leaked).

### S7 — Archive / restore

- **Status:** done
- **Depends on:** S2

*Shipped with S3.*

- Archive hides + un-serves the artefact and its data, sets `archivedAt`. *(AH 7)*
- Restore returns it to `active` with prior visibility, clears `archivedAt`. Owner-only. *(AH 9)*

**Implementation notes (from building S7):**

- **Domain** `archiveArtefact` (active → archived, stamps `archivedAt`, **keeps visibility**
  so restore can return to the prior tier) and `restoreArtefact` (archived → active, clears
  `archivedAt`; rejects a non-archived artefact). Because archival only flips `status`, the
  prior visibility is retained for free (AH9).
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

- Owner lists their own `active` artefacts (archived hidden by default); shows visibility +
  shareable link when shared, grouped/filterable by kind.

**Implementation notes (from building S10):**

- New repository port method **`listByOwner(ownerId, { includeArchived })`** (default
  active-only, most-recently-updated first), implemented in both the in-memory and Drizzle
  (`and(owner, status='active')`, `orderBy desc(updatedAt)`) repos.
- BFF **`GET /api/artefacts`** (`requireAuth` → owner-scoped) returns
  `ArtefactListResponse` via the shared `toArtefactSummary` mapper; archived hidden by
  default (AH7). Grouping/filtering by kind is a client concern.
- **Client** (`App.svelte`): a "Your artefacts" list grouped by kind with a kind
  filter, the visibility tier (`authenticated` shown as the UI label "Other users"), and a
  share link when a slug is present; reloads after a successful upload.
- **Tests:** in-memory `listByOwner` unit tests (owner+active filter, newest-first, archived
  hidden / opt-in) and an end-to-end "Your artefacts" test (fresh user → exact-count list, newest
  first, excludes archived + other owners, 401 unauth).

### S14 — Shared with you

- **Status:** done
- **Depends on:** S5

- A signed-in user browses artefacts shared to them (`authenticated` + `public`), grouped by
  kind; their own artefacts (in "Your artefacts") and others' private ones never appear. *(AH 8)*

**Implementation notes (from building S14):**

- Repository port method **`listShared(viewerId)`** — active artefacts with visibility
  `authenticated` or `public`, across owners but **excluding the viewer's own**,
  most-recently-updated first. Drizzle impl uses the `(status, visibility)` index (`inArray`)
  plus `ne(ownerId, viewerId)`; in-memory mirrors it. Private never matches (AH8). *("Shared
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
  private + archived; **excludes the viewer's own**) and an end-to-end "Shared with you" test (two owners
  → a signed-in viewer sees others' shared artefacts, never their own nor others' private;
  each enriched with the owner's identity; `401` unauthenticated).

### S15 — Permanent delete (archived only)

- **Status:** done
- **Depends on:** S7

- The owner permanently deletes an **archived** artefact, confirmed via a modal dialog; an
  active artefact must be archived first. Deletion removes the row, its payload file, and all
  its data entries. *(AH 11)*

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

- A 4th visibility tier `selected` shares the artefact with an explicit set of registered
  users. It is a *shared* tier: minting/retaining a slug exactly like `authenticated`/`public`
  (AH 4, 5, 12), but the access matrix grants view only to the owner + members of `sharedWith`
  — everyone else (signed-in or not) gets a flat 404. *(AH 8, 13)*
- The owner manages members incrementally: **add** and **remove** individuals, searching the
  user directory by **name or email**. Granting is a set op (idempotent), the owner can't be
  added, and the list can't change while archived. *(AH 14)*
- `sharedWith` is retained across tier changes and archive/restore; only consulted under
  `selected` (empty list ⇒ owner-only). *(AH 13)*
- A recipient sees a `selected` artefact they're a member of in **"Shared with you"** (S14),
  attributed to the owner, alongside `authenticated`/`public` shares. *(AH 8)*

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
  owned artefact (non-owner → not-found, AH9), apply the domain fn, save. `set-visibility`
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
  view + non-member 404 + anonymous 404; member sees it in "Shared with you"; user search).

### S19b — Payload-retention seam

- **Status:** specced
- **Depends on:** S3, S15

*Enabler; behaviour-preserving.*

The other half of the history enabler (see **S19a — Data version pin**). (DDD amendment:
`ddd/artefact-hosting.md` AH15.) The seam replaces a deletion in the S3 edit command, and the
S15 permanent delete must give the policy its chance to purge.

- **Hosting — retention seam.** Replace the unconditional delete of the superseded payload in
  `edit-artefact.command.ts` with a **`PayloadRetentionPolicy`** port. OSS wires the default
  `DiscardSupersededPayload` (deletes — **byte-identical behaviour**); the seam is the one place
  a superset swaps in a retaining policy. The artefact still has exactly one head payload.
  *(AH 15)*
- **Acceptance:** edit still leaves exactly one payload file under the default policy (no
  orphan, no retained file); permanent delete still erases payload + data, and the policy gets
  the chance to purge anything it retained.
- **Boundary:** **OSS** (the seam must live where the deletion does). The retaining policy, the
  version store, and rollback are the **EE** *Artefact History* context — see `ee/docs/specs/`.

### S32 — Link controls: password + expiry

- **Status:** specced
- **Depends on:** S6, S11, S12, S21, S25, S30

It depends on every non-owner read path it gates (S6, S11, S12, S21, S30) and on S25, because a
root's gate governs its contained artefacts. (DDD amendment: `ddd/artefact-hosting.md` AH22–AH24.)
An owner-set **link gate** that narrows access after the matrix grants it — the password and
expiry every competing host offers, without a fifth tier. (Rationale: market analysis gap #4.)

- **Domain** — `LinkGate` value object `{ passwordHash, expiresAt, version }` on `Artefact` and
  `Collection` (roots only). Pure `evaluateLinkGate(gate, now, pass) → open | expired |
  challenge`; pure `effectiveLinkGate(artefact, root)` (the root's gate when contained, AH20).
  `setLinkGate` / `clearLinkGate` on both aggregates: owner-only (AH9), not archived (AH7),
  top-level or root only, password ≥ 8, `expiresAt` in the future; a password change bumps
  `version`. *(AH22, AH23)*
- **Access composition** — one `authorizeArtefactRead(artefact, viewer, pass, now)` =
  effective matrix (AH20/AH18) **then**, for non-owners only, the effective gate. Every non-owner
  read uses it, **whichever ref form** is used: `/a/:slug` shell + `/frame`, `…/data/*` reads and
  writes, `…/download`, `…/viewers`, and (S34) threads. `expired` maps to the private outcome
  (sign-in redirect / 404); `challenge` renders the unlock page (shell) or `403 {gate:
  "password"}` (API). The id alias must not bypass the gate. *(AH22–AH24)*
- **Passes** — `POST /a/:slug/unlock` verifies the password (scrypt, constant-time) and sets an
  httpOnly, SameSite=Lax, HMAC-signed (`BETTER_AUTH_SECRET`) cookie scoped to the gate holder id,
  carrying `version`, TTL `min(7 d, expiresAt)`. Stale `version` → void. Rate limit: 10 attempts
  per holder + client IP per 15 min.
- **Persistence** — migration adds `link_password_hash`, `link_expires_at`,
  `link_gate_version` (default 0) to `artefact` and `collection`. The hash is never mapped into
  any summary or MCP result.
- **BFF** — `PUT|DELETE /api/artefacts/:id/link-gate`, `PUT|DELETE /api/collections/:id/link-gate`
  (owner). Summaries expose `linkGate: { passwordProtected, expiresAt }` to the owner only.
- **Client** — `ManageAccessModal` gains a "Link protection" section (password set/change/clear,
  expiry picker with presets 1 d / 7 d / 30 d / custom); contained artefacts show it as
  "Inherited from `<root>`". Owner cards show lock / clock badges. An unlock page in the shell for
  challenged viewers; an "expired" owner banner in the preview.
- **Acceptance:** owner is never challenged or expired; a non-owner on a password-gated `public`
  link is challenged, a wrong password is rejected, a right one opens shell + frame + data reads
  for that holder only; the same artefact via its **id alias** is gated identically; changing the
  password voids an existing pass; past `expiresAt` a signed-in non-owner gets 404 and an
  anonymous one the sign-in redirect, with tier, `sharedWith` and slug unchanged, and extending
  the expiry restores the same URL; a `selected` artefact's non-member is denied by the matrix
  **before** any challenge (AH24 — no leak); a contained artefact follows its root's gate and its
  own is dormant; setting a past expiry, a short password, or a gate while archived is rejected;
  unlock is rate-limited; `download` and `…/viewers` honour the gate.
- **Out of scope:** per-recipient passwords, view-count limits, MCP tools to set a gate (a
  password typed into an agent transcript is the wrong habit).
- **Boundary:** **OSS**.

### S33 — Share-invitation seam

- **Status:** specced
- **Depends on:** S1, S16, S25

*Enabler; behaviour-preserving.*

The core hook a superset uses to let an owner share with an **email that
has no Account yet** (market analysis gap #1). **OSS does not invite anyone:** it has no
transactional email, and its sign-up allowlist (IA4) stays the only way in. The invitation
aggregate, magic-link sign-in, mail delivery and cross-org grants are the EE **Share
invitations** context (`ee/docs/specs/ddd/share-invitations.md`) — in cloud, where sign-up is
open (IA5), an invited person becomes an ordinary Account. No DDD invariant changes: an accepted
invitation is an ordinary AH14 grant.

- **Capabilities** — public `GET /api/config` gains `capabilities: { shareInvitations: boolean,
  magicLinkSignIn: boolean }`, supplied by an injected `Capabilities` value through
  `createApp` (the S22/S24 pattern). **OSS default: both `false`.**
- **Endpoint contract (not mounted in OSS)** — the client targets, and a superset mounts:
  `POST|GET /api/artefacts/:id/invitations`, `POST|GET /api/collections/:id/invitations` (owner;
  body `{ email }` → `{ status: "granted" | "pending", invitation? }`; `GET` lists pending
  `{ id, email, createdAt, expiresAt }`), and `DELETE /api/invitations/:id`. `granted` means the
  email already had an Account and was added to `sharedWith` directly.
- **Client** — when `shareInvitations` is on, `ManageAccessModal`'s people picker offers "Invite
  `<email>`" for a well-formed email with no directory match and shows pending invitations as chips
  (resend = re-POST, revoke = DELETE) beside the access list; a `private` target prompts to share
  as `selected` first. When `magicLinkSignIn` is on, the sign-in page offers "Email me a sign-in
  link" (BetterAuth's standard `POST /api/auth/sign-in/magic-link`). With both off, the UI renders
  exactly as today.
- **Acceptance:** under the OSS defaults `/api/config` reports both capabilities `false`, the
  modal and sign-in page render unchanged, and no invitation route exists (404); with stub
  capabilities on and stub endpoints, typing an unknown email shows "Invite", inviting renders a
  pending chip, `granted` refreshes the access list instead, revoke removes the chip, and the
  sign-in page shows the magic-link option.
- **Boundary:** **OSS** (the capabilities flag, client affordances and endpoint contract). The
  invitation domain, persistence, mail and sign-in are **EE** (Share invitations, EI1–EI3).

### S35 — Artefact thumbnails

- **Status:** done
- **Depends on:** S2, S3, S10, S14, S15, S30
- **Optional:** S32
- **Linear:** ALI-271

A WebP preview on every dashboard, collection and "Shared with you" card, rendered server-side
from the stored payload alone, so an artefact published through the MCP connector (which has no
browser) gets one too. It builds on create (S2) and edit (S3), which enqueue renders, on the
lists whose cards show it (S10, S14), on permanent delete (S15), which removes the files, and on
the S30 download resolver, which the thumbnail read reuses. S32 is optional: the link gate is
inherited through that resolver when it lands. (DDD amendment: `ddd/artefact-hosting.md`
AH25–AH27, with the AH11 and AH22 amendments and the AH17 note.)

- **Domain** — `Artefact.thumbnailHash: string | null` (`null` at create, untouched by
  `editArtefact`); pure `isThumbnailStale(a)`. Ports `ThumbnailStore { put, get,
  deleteAllExcept, deleteAll }` and `ThumbnailRenderer { render(html) }`. `ArtefactRepository`
  gains `recordThumbnail(id, renderedHash)` — a compare-and-set against `payloadHash` that never
  bumps `updatedAt` — and the system read `listNeedingThumbnail(limit)` (active rows whose
  `thumbnailHash` is null or stale). `save()` never writes `thumbnailHash`. *(AH25, AH26, AH17)*
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
  volume, egress limits) lands; that follow-up flips the default to `on`. An in-process `ThumbnailService`:
  a synchronous, never-throwing `enqueue(job)` deduped by artefact id (latest wins); one worker
  that skips fresh jobs, drops a job whose payload is gone, renders, stores, records by
  compare-and-set (deleting its file when the record loses) and then deletes the superseded
  files; failed hashes are remembered per process and never retried; `start()` sweeps
  backfill + crash recovery. Create and payload-replacing edit enqueue after the save (UI and
  MCP alike). Permanent delete (and the CL8 collection cascade) removes the files.
  `GET /api/artefacts/:ref/thumbnail` behind `requireAuth`, resolved like the S30 download,
  `image/webp` + `Cache-Control: private, max-age=31536000, immutable` + `nosniff`.
  `ArtefactSummary.thumbnailUrl` = `/api/artefacts/<id>/thumbnail?v=<thumbnailHash>` for an
  active artefact with a thumbnail, else `null`. *(AH27, AH11)*
- **Client** — a shared `CardThumbnail.svelte` in `ArtefactCard` and `GalleryCard`: a 16:10
  preview area showing the image (`loading="lazy"`, top-aligned, `object-fit: cover`) or, when
  there is none or it fails to load, the striped kind placeholder; the kind badge and chips stay
  overlaid. After an upload or HTML replace the SPA polls that artefact every 2 s for up to
  ~30 s until its `thumbnailUrl` appears.
- **Packaging** — the runtime image installs `chromium-headless-shell` under
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` with `ARTEFACTOR_THUMBNAIL_DIR=/data/thumbnails`
  but does not set `ARTEFACTOR_THUMBNAILS=on`; CI installs it before `pnpm test` so the renderer
  isolation tests run.

**Acceptance:**

- **Create** (UI upload or MCP `create_artefact`) returns the same status and body as before,
  plus `thumbnailUrl: null`, without awaiting any render; a job with the saved `payloadHash` is
  enqueued exactly once; a throwing or absent queue doesn't fail the command.
- **Edit** replacing the HTML (UI or MCP `update_artefact`) enqueues once with the new hash; a
  title/kind-only edit enqueues nothing.
- **Summary URL** — `thumbnailUrl` is `null` before a render completes, and after it
  `thumbnailHash === payloadHash` and `thumbnailUrl` is
  `/api/artefacts/<id>/thumbnail?v=<thumbnailHash>`; an archived artefact's is `null`.
- **Repository CAS** — `recordThumbnail` applies only on a hash match and leaves `updatedAt`
  unchanged (in-memory and Drizzle); a `save()` after a record doesn't revert `thumbnailHash`;
  `listNeedingThumbnail` returns only active rows that are null or stale.
- **Stale render** — a render finishing after the payload changed again is not recorded, its
  file is removed, and the newer render's result wins.
- **Superseded file** — a successful re-render deletes every other thumbnail file of the
  artefact; until then the previous thumbnail is still served.
- **Failure** — a renderer failure leaves `thumbnailHash` unchanged and that hash isn't retried
  in the same process.
- **Startup sweep** — `start()` enqueues active artefacts that are null or stale, never archived
  ones.
- **Route access** — 200 `image/webp` with the three headers for the owner, a `selected`
  member, any signed-in user on `authenticated` or `public`, and collection-inherited tiers;
  401 for anonymous whatever the ref; a flat 404 for an unknown ref, not viewable, archived
  (owner included) and no thumbnail yet.
- **Permanent delete** of an archived artefact removes its thumbnail files.
- **Disabled by default** — with `ARTEFACTOR_THUMBNAILS` unset (or `off`, or no Chromium) the
  server starts, logs once that thumbnails are disabled, never renders, every card shows the
  placeholder, and all other behaviour is identical; `on` builds the renderer.
- **Renderer integration** (runs in CI; skips locally only without Chromium) — a fixture with
  CDN CSS, a web font and a canvas yields a valid 512×320 WebP; a loopback canary receives zero
  requests from `fetch`, `<img>`, `sendBeacon` and WebSocket; a public WebSocket is blocked; a
  `while(true){}` page is aborted within the 15 s cap.
- **Card** — `pnpm check` passes; a manual run shows upload → placeholder → thumbnail without a
  reload, the thumbnail in "Shared with you", and the placeholder for an archived artefact and a
  broken image.

- **Out of scope:** the Chromium OS sandbox (off in the container; isolation relies on the
  synthetic origin, WebSocket/service-worker blocking, the timeout, no credentials and the
  container), anonymous thumbnail reads, OG/social images, thumbnails in MCP responses, list
  rows and collection tiles, owner-chosen crops, per-kind viewports, dark-mode variants, an
  object-storage store, a durable queue and per-tenant render quotas.
- **Boundary:** **OSS** (the EE Postgres repository mirrors the column and the two repository
  methods).
