# FDD — Feature Slice DAG (v0.2)

Each slice is a **vertical cut** through the stack: BFF endpoint (Hono) + domain logic +
Drizzle persistence + Svelte UI where relevant. Built **test-first** (TDD) against the
invariants it touches. A slice is only started once its dependencies are done.

## Dependency DAG

```
S0 Scaffold (Hono + Vite/Svelte + Tailwind + shadcn-svelte + Drizzle/SQLite + Docker)
        │
        ▼
S1 Identity (BetterAuth — email+password for dev; Google OAuth added later)
        │
        ├────────────► S2 Create artefact (active/private, manual upload)
        │                     ├──► S3 Edit artefact (title / kind / payload)
        │                     ├──► S4 Owner views own artefact
        │                     ├──► S5 Share / unshare (private↔authenticated↔public; mint+retain slug)
        │                     │            ├──► S6 Serve artefact by slug (access matrix)
        │                     │            ├──► S14 Shared with you (others' shared+public, by kind)
        │                     │            └──► S16 Share with specific people (selected tier + access list UX)
        │                     ├──► S7 Archive / restore
        │                     ├──► S10 Your artefacts (list own artefacts)
        │                     └──► S11 Store: read/write own data blob
        │                                  ├──► S12 Host UI: data-context switcher (load another author, read-only)
        │                                  └──► S13 Artefact runtime bootstrap (localStorage hijack, opaque)
        │
        └────────────► S18 MCP connector (remote MCP server + OAuth via BetterAuth `mcp` plugin;
                              wraps the Hosting commands as tools — needs S2, S3, S4, S5, S7, S10)
                                     │
                                     └──► S30 Export artefact HTML (GUI download + MCP read-back
                                                tools — needs S2, S4, S6, S11, S18)
                                                │  ┊
                                                │  ┊ (optional sharpener, NOT a dependency)
                                                │  ┄┄┄ S19 data version pin (AD9)
                                                │
                                                └──► S31 Agent edits data: set_artefact_data
                                                           (needs S11, S18, S30; S19 likewise
                                                           an optional sharpener only)

Market-analysis slices (post-S31):

S6 + S11/S12 + S21 + S25 + S30 ──► S32 Link controls (password + expiry; AH22–AH24)
S1 + S16 + S25 ──────────────────► S33 Share-invitation seam (enabler; EE implements)
S12 + S18 + S21 + S25 + S32 ─────► S34 Comments + agent feedback loop (FB1–FB7)
                                        └──► S34b Anchored comments (needs S19)

~~S8 Issue / revoke API key~~ and ~~S9 API push ingestion~~ are **dropped** — the pinned
better-auth has no api-key plugin and a raw token API was deemed unnecessary; programmatic
access is the MCP connector (S18), authenticated by OAuth, not API keys.
~~S17 Data merge-patch~~ is also **dropped** — a backend merge would parse the blob and break
its opacity; data writes stay whole-blob `PUT`s and the artefact owns shape compatibility.
```

## Slices & acceptance criteria

Acceptance criteria are the seed for each slice's unit tests. Invariant numbers reference
`ddd/artefact-hosting.md` (AH), `ddd/identity-access.md` (IA), and `ddd/artefact-data.md` (AD).

### S0 — Scaffold *(prerequisite, not a domain slice)*
Monolith builds and runs: Hono serves the Svelte app; Drizzle connected to SQLite with
migrations; Tailwind + shadcn-svelte wired; pure `domain/` layer + Vitest harness; Docker
image builds and runs locally. **Full detail: [`s0-scaffold.md`](./s0-scaffold.md).**

### S1 — Identity (BetterAuth) — **done** (incl. Google OAuth + domain allowlist)
- Users sign in with **Google OAuth** (the production method) and, in dev/test only, **email
  + password**. Production disables email+password (`emailAndPassword.enabled = NODE_ENV !==
  "production"`), removing the open unverified sign-up path from prod.
- Account creation is restricted to allowed email domains (`AUTH_ALLOWED_EMAIL_DOMAINS`,
  default `example.com` for dev; org domains set in prod), enforced for every provider via the
  user-create hook. *(IA 4)*
- An authenticated session exposes a stable `ownerId` to the BFF.
- Protected endpoints reject unauthenticated requests. *(IA 1)*

**Implementation notes (from building S1):**
- **BetterAuth instance** in `src/server/auth.ts` — `betterAuth()` with the **Drizzle
  adapter** (`provider: "sqlite"`) over the shared `db`, `emailAndPassword.enabled` (gated to
  non-production), `socialProviders.google` (configured when `GOOGLE_CLIENT_ID` +
  `GOOGLE_CLIENT_SECRET` are set), and `trustedOrigins` for the dev client origin. Secret +
  base URL + trusted origins are env-driven (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `AUTH_TRUSTED_ORIGINS`); production refuses the placeholder secret **and requires the Google
  creds** (`env.ts` superRefine).
- **Domain allowlist (IA 4):** pure `domain/identity/email-domain.ts`
  (`isEmailDomainAllowed`), enforced in `databaseHooks.user.create.before` (throws
  `APIError("FORBIDDEN")` for a disallowed domain). Domains from
  `AUTH_ALLOWED_EMAIL_DOMAINS`. Covers every provider on the create path. The Google callback
  is `<BETTER_AUTH_URL>/api/auth/callback/google`.
- **Auth tables** (`user`, `session`, `account`, `verification`) live in the shared
  `src/infra/db/schema.ts`, generated by **`pnpm dlx @better-auth/cli generate --config
  src/server/auth.ts`** — regenerate + `pnpm db:generate` when the auth config changes (e.g.
  the api-key plugin in S8). `artefact.owner_id` and `data_entry.author_id` now carry FKs to
  `user.id` (the deferred S0 FKs).
- **BFF wiring** (`src/server/routes/index.ts`): BetterAuth handler mounted at
  `/api/auth/*` (with CORS), then `attachSession` middleware resolves the session for all
  other routes, exposing `user`/`ownerId` via Hono context (`src/server/middleware/auth.ts`).
  `requireAuth` is the 401 guard for protected endpoints; `GET /api/me` is the first
  protected endpoint, returning the caller's `ownerId`.
- **Client** (`src/client/lib/auth.ts`): `createAuthClient` from `better-auth/svelte`;
  `AuthScreen.svelte` leads with **Continue with Google** (`signIn.social`, with an
  `errorCallbackURL` so a rejected out-of-domain account shows a friendly message) and exposes the
  email+password form only in dev (`import.meta.env.DEV`).
- **Tests:** `requireAuth` guard unit test plus an end-to-end `identity.test.ts` that signs a
  user up against a throwaway SQLite db and round-trips `/api/me` (IA 1) and rejects a
  disallowed-domain sign-up (IA 4); pure `email-domain.test.ts` for the allowlist predicate. A
  shared `src/test/setup.ts` points each test run at a temp DB and sets the test allowlist.

### S2 — Create artefact — **done**
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

### S3 — Edit artefact — **done** *(shipped with S7)*
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

### S4 — Owner views own artefact — **done**
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

### S5 — Share / unshare — **done**
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

### S6 — Serve artefact by slug (access matrix) — **done**
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

### S7 — Archive / restore — **done** *(shipped with S3)*
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

### S8 — API key issue / revoke — **dropped**
### S9 — API push ingestion — **dropped**
The pinned `better-auth` (1.6.20) ships no api-key plugin, and a raw token REST API was
judged unnecessary. Programmatic access is the **MCP connector (S18)**, authenticated by
OAuth. See the DDD amendment in `ddd/identity-access.md` ("Programmatic access").

### S10 — Your artefacts (owner's own list) — **done**
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

### S11 — Store: read/write own data blob — **done** *(shipped with S13)*
- Authenticated viewer upserts their own JSON blob for an artefact (one per author). *(AD 1, 2, 3)*
- `GET …/data/me` returns the caller's blob; rejects oversize/invalid JSON. *(AD 8)*
- Unauthenticated write rejected; archived artefact → 404. *(AD 3, 6)*

**Implementation notes (from building S11):**
- **New bounded context** `src/domain/data/`: the `DataEntry` aggregate (opaque `blob` text,
  `MAX_BLOB_BYTES = 5 MB`), `assertBlobWithinBounds` (size-then-`JSON.parse`, AD8),
  `upsertDataEntry` (one per `(artefact, author)`, preserves id/createdAt, bumps updatedAt),
  the `DataRepository` port + in-memory double, and `InvalidBlob`/`BlobTooLarge` errors.
- **Drizzle adapter** (`infra/db/data-repository.drizzle.ts`) upserts on the
  `(artefact_id, author_id)` unique pair; the `data_entry` table already existed from S0.
- **Addressing:** the data API is keyed by an artefact **reference** `:ref` that is its slug
  **or** its id — the command resolver tries `findBySlug` then `findById` (slugs are
  base64url, ids are uuids, so the fallback can't mis-resolve). The id form is the alias that
  gives a **never-shared** private artefact (no slug) a data store, and is what the
  owner-preview serving path writes through. Access is resolved through the **Artefact access
  matrix** — `canViewArtefact` reused — so a viewer can only touch data on an artefact they
  can see; archived / not-viewable / unknown ref all collapse to `404` (AD4, AD6).
- **Commands** (`src/server/data/own-data.command.ts`): `get` / `put` / `delete` own entry,
  all gated by the slug+access resolver. `authorId` is always the authenticated caller (AD2,
  AD3) — there is no anonymous write.
- **BFF** (`routes/data.ts`, mounted at `/api/artefacts/:ref/data`): `GET /me` (200 with
  `blob: null` when none), `PUT /me` (raw JSON body, `InvalidBlob → 400`, `BlobTooLarge →
  413`), `DELETE /me` (204). All `requireAuth`; `ArtefactNotFound → 404`.
- **Tests:** domain unit (blob bounds, upsert), command unit (per-author isolation, access/
  archived gating, delete), and an end-to-end `data.test.ts` (upsert/read, `blob:null`,
  per-author separation, `400`/`401`/`413`, archived `404`, private non-owner `404`, delete).
- The author-listing + per-author endpoints (S12) and the localStorage runtime shim (S13)
  build on this; no client UI yet (S11 is the API surface they consume).

### S12 — Host UI: data-context switcher — **done**
- A signed-in viewer with read access can list authors who have data and load another
  author's blob into the artefact, **read-only** (re-seed/iframe reload). *(AD 4, 5)*
- Tiers enforced via the `…/data/authors` + `…/data/:authorId` endpoints: private → owner
  only; authenticated → signed-in; public → anyone. *(AD 4)*
- This lives entirely in the host (BFF + chrome); the artefact stays opaque.

**Implementation notes (from building S12):**
- **`/a/:slug` now returns a host *shell*** (`src/server/runtime/shell.ts`) — a thin toolbar
  with the data-context `<select>` wrapping an `<iframe>`. The artefact itself moved to
  **`/a/:slug/frame`** (`?author=<id>` selects the context). Both routes resolve the slug and
  apply the same access matrix (deny → 404). Splitting them keeps the switcher chrome
  *outside* the artefact container, exactly as AD §"Data context" requires.
- **Server-rendered, not the SPA.** `/a/:slug` is the shareable link and serves
  unauthenticated/public viewers who never load the Svelte SPA, so the shell + picker are
  server-rendered (inline JS that fetches `…/data/authors` and re-points the iframe). The
  DDD doc's "Svelte chrome" was aspirational; the served path is Hono, not the SPA.
- **Read-only foreign context** (AD5): `renderServedArtefact` gained an `authorId` option;
  the seeded context is writable **only** when the viewer is signed in *and* `authorId`
  equals the viewer (otherwise `writable:false`, so the S13 shim throws on write).
- **Two new endpoints** under the existing `/api/artefacts/:ref/data` mount —
  `GET /authors` and `GET /:authorId` — gated by the access matrix (AD4), **not** `requireAuth`
  (a public artefact's data is readable by the anonymous). Static `/authors`+`/me` are defined
  before the `/:authorId` param so they win. Commands in `src/server/data/author-data.command.ts`
  reuse `resolveViewableArtefact`; the repo gained `listAuthorsByArtefact` (no schema change).
- **Author labels** are enriched BFF-side: a `UserDirectory` port
  (`src/server/data/user-directory.ts` + Drizzle adapter) resolves author ids → name/email
  from the BetterAuth `user` table. The Artefact Data store still holds only opaque ids; the
  BFF composes them with Identity for presentation.
- **Tests:** `author-data.command.test.ts` (access-matrix unit cover), `data-authors.test.ts`
  (e2e endpoints incl. anonymous-public, archived→404, `/me` not shadowed), and `serve.test.ts`
  extended for the shell/frame split + the read-only `?author` seed.

### S13 — Artefact runtime bootstrap (localStorage hijack) — **done** *(shipped with S11)*
- Served artefacts get an injected shim that **replaces `window.localStorage`** with a
  backend-backed store, **seeded server-side** with the current data context so reads are
  synchronous; writes are write-through + debounced with a `pagehide` beacon flush. *(AD runtime contract §1)*
  *(Amended by S31: writes only when dirty, pinned with `If-Match`/`If-None-Match: *`, and a
  412 stops the tab writing and prompts a reload in the host shell.)*
- The artefact needs **zero code changes** and sees **one opaque dataset** — `localStorage`
  only, no `ARTEFACTOR` helper.
- Over-cap write throws `QuotaExceededError`; a read-only context (logged-out public viewer,
  or another author's data loaded via S12) throws on write while seeded reads still work. *(AD 3, 5, 8)*

**Implementation notes (from building S13):**
- **Shim** (`src/server/runtime/localstorage-bootstrap.ts`): an inline IIFE that models the
  whole localStorage keyspace as one JSON object (= the `DataEntry.blob`), exposes the full
  synchronous `localStorage` API (`getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`),
  and replaces `window.localStorage` via `Object.defineProperty`. Reads hit the seeded
  in-memory map; writes update it then debounce a `PUT :endpoint` (`fetch` with
  `keepalive:true` — the credentialed, PUT-capable replacement for `sendBeacon`), with a
  `pagehide`/`visibilitychange` flush. Over-cap → `QuotaExceededError` (and the write is
  reverted); a read-only context throws on every write. The seed/config is inlined as JSON
  with `<` escaped so a blob can't break out of the `<script>`. No `window.ARTEFACTOR`.
- **Injection** (`injectBootstrap`): placed right after `<head>` (else `<html>`, else
  prepended) so it runs before any artefact script. The artefact is unchanged.
- **Seeding** (`runtime/render.ts`): on serve, the BFF loads the viewer's own `DataEntry` and
  inlines it. Both serving paths inject it — `GET /a/:slug` (S6, writes back via the slug)
  and the owner preview `GET /api/artefacts/:id/raw` (S4, writes back via the id alias). An
  authenticated viewer gets a read-write context seeded with their own blob; an unauthenticated
  public viewer gets an empty read-only one (no anonymous writes — AD3/AD5).
- **S12 deferred:** loading *another* author's blob read-only (the host data-context switcher)
  is S12; S13 ships the own-context (default) seeding and the read-only mechanism it will reuse.
- **Tests:** the shim is unit-tested by **evaluating the generated JS** with mocked browser
  globals (seeded reads, write-through PUT, debounce/pagehide flush, over-cap + read-only →
  `QuotaExceededError`) plus injection/escaping tests; integration tests assert the bootstrap
  is injected and seeded with the viewer's own data (read-write) vs anonymous (read-only).

### S14 — Shared with you — **done**
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

### S15 — Permanent delete (archived only) — **done**
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

### S16 — Share with specific people (`selected` tier + access list) — **done**
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

### S17 — Data merge-patch — **dropped**
A partial-update (RFC 7396 merge) endpoint would force the backend to parse and transform the
data blob, breaking its opacity invariant (`ddd/artefact-data.md`). Data writes stay
whole-blob `PUT`s; an artefact owns its own data-shape compatibility (versioned `localStorage`
keys), and a breaking shape change is published as a new artefact. The MCP connector therefore
exposes **no data-write tool** — it surfaces `dataAuthorCount` so a breaking HTML update can be
flagged (see S18).

### S18 — MCP connector (remote MCP server + OAuth) — **done**
- Artefactor exposes a **remote MCP server** at `POST /mcp` (Streamable HTTP) that Claude
  (claude.ai / Claude design) connects to as a custom connector. *(IA 2)*
- **OAuth 2.1** via BetterAuth's `mcp` plugin: discovery (`.well-known/oauth-*`), dynamic
  client registration, authorization-code + consent, bearer-token access. A request without a
  valid bearer → `401` with the protected-resource descriptor. *(IA 2, 3)*
- Every tool call is **attributed to the token's Account** and enforces the *same* domain
  invariants as the UI (access matrix, ownership) — the MCP layer is a thin adapter over the
  existing Hosting commands, adding no new authority. *(AH 9)*
- **Tools:** `create_artefact`, `update_artefact`, `list_artefacts`, `get_artefact`,
  `set_visibility`, `archive_artefact`, `restore_artefact`, and `get_authoring_guide`. There is
  **no data-write tool** (opacity, above). `get_artefact` / `update_artefact` return
  **`dataAuthorCount`** so the model can warn before a breaking data-shape change and suggest a
  versioned key or a new artefact. Update never deletes data blobs; it only replaces the HTML
  payload.
- **The connector self-describes its authoring contract**, because connector-only clients (e.g.
  Claude design) cannot load the `artefactor` Agent Skill. Two channels carry it: the MCP
  server's **`instructions`** (returned in `initialize` — ambient, present *before* any tool
  call, so the model has the persistence contract while it is still authoring the HTML) carry a
  compact summary, and the **`get_authoring_guide`** tool returns the full
  `skills/artefactor/SKILL.md` body on demand. Both derive from that one skill file
  (`src/server/mcp/authoring-guide.ts`; the Dockerfile copies `skills/` into the runtime image).
- **Two publishing paths, because a model cannot carry binary through a tool call.** *Path A* —
  push HTML via `create_artefact`/`update_artefact` — works only for artefacts with **no embedded
  raster images** (base64 image bytes can't be emitted reliably in a tool argument; they
  truncate/corrupt). This is the common case (forms, prototypes, slide decks, interactive docs;
  HTML/CSS/SVG are fine). *Path B* — the human downloads the self-contained HTML and uploads it
  via the **S2/S3 manual upload UI** (`UploadModal.svelte`) — is the path for artefacts that need
  real raster images. The `instructions` + skill tell the model to stop and offer the human a
  choice (recreate visuals as SVG/CSS → Path A, or keep base64 raster → Path B) rather than
  silently pushing a broken artefact. Both paths run the same create/edit commands, so invariants
  are identical.
- A companion **skill** (`skills/artefactor`) teaches Claude both to publish/update/share via
  the connector and to write HTML that persists through the localStorage hijack (keep in sync
  with `ddd/artefact-data.md`, the tools in `src/server/mcp/`, and the `instructions` summary in
  `src/server/mcp/authoring-guide.ts` — same no-drift rule as specs).

### S19 — Payload-retention seam + data version pin *(enabler; behaviour-preserving)*
The single core change that makes artefact **history / rollback** buildable by a superset,
without adding versioning to OSS. (DDD amendments: `ddd/artefact-hosting.md` AH15,
`ddd/artefact-data.md` AD9.)
- **Hosting — retention seam.** Replace the unconditional delete of the superseded payload in
  `edit-artefact.command.ts` with a **`PayloadRetentionPolicy`** port. OSS wires the default
  `DiscardSupersededPayload` (deletes — **byte-identical behaviour**); the seam is the one place
  a superset swaps in a retaining policy. The artefact still has exactly one head payload. *(AH 15)*
- **Data — version pin.** `DataEntry` gains `authoredAgainstVersion`; every `PUT …/data/me`
  stamps it with the artefact's current payload content hash. Advisory only — opacity and the
  read/write access rules are unchanged. *(AD 9)*
- **Acceptance:** edit still leaves exactly one payload file under the default policy (no orphan,
  no retained file); a fresh data write records the current payload hash; an entry written before
  a subsequent edit reads back a pin ≠ the new hash (the staleness signal); permanent delete still
  erases payload + data, and the policy is given the chance to purge anything it retained.
- **Boundary:** this slice is **OSS** (the seam must live where the deletion does). The retaining
  policy, the version store, and rollback are the **EE** *Artefact History* context — see
  `ee/docs/specs/`. Migration adds the nullable `authoredAgainstVersion` column.

### S20 — Hide the data-context switcher for non-persisting artefacts
Stop showing the "Data context" picker (S12 chrome) on artefacts that can't usefully use it.
(DDD amendment: `ddd/artefact-hosting.md` AH16.)
- **Domain** — a pure `detectUsesStorage(html)` (word-boundary `localStorage` match; excludes
  `sessionStorage`). `Artefact` gains `usesStorage`, set by `createArtefact` and recomputed by
  `editArtefact` only when the payload is replaced. *(AH 16)*
- **Commands** — `create`/`edit` decode the raw payload bytes (which they already hold to `put`)
  and pass the computed `usesStorage` into the domain.
- **Persistence** — new `uses_storage` column (migration); the Drizzle + in-memory repos map it.
  Defaults to `true` for existing rows (no backfill — the "≥1 other author" rule below hides the
  picker for them anyway).
- **Shell (S12)** — the served chrome shows the picker only when `usesStorage` **and** the
  `…/data/authors` fetch yields ≥1 author other than the viewer; otherwise the picker is omitted
  (and when `usesStorage` is false the shell skips the fetch). The artefact + its data API are
  unchanged — this is chrome only.
- **Client (SPA)** — `usesStorage` rides `ArtefactSummary`, surfaced as a small "saves data"
  indicator (a database glyph) in the dashboard **and** gallery views: upper-right of the grid
  card, and after the kind label on the list row's second line.
- **Acceptance:** an artefact whose HTML uses `localStorage` → `usesStorage = true`; one using
  only `sessionStorage` or no storage → `false`; a title-only edit doesn't flip it; a
  payload-replacing edit recomputes it; the served shell omits the picker when `usesStorage` is
  false; with `usesStorage` true but no other author's data, the picker stays hidden; it appears
  once a second author has an entry. Access/serving behaviour is unchanged (AH8/AH16).
- **Boundary:** **OSS** (benefits self-hosters; pure chrome/UX). No `ee/` involvement.

### S21 — Who has viewed
Record when a signed-in viewer opens an artefact, and surface a "viewed by" list in the host
chrome. (New DDD bounded context: `ddd/artefact-views.md`, invariants VT1–VT5; amends
`ddd/artefact-hosting.md` AH11 — permanent delete also removes view entries.)
- **Domain** — new **Artefact Views** context: a `ViewEntry` aggregate (`id`, `artefactId`,
  `viewerId`, `viewedAt`) with a pure `recordView` factory that upserts (first view creates;
  later views bump `viewedAt`, preserving `id`), and a `ViewRepository` port
  (`findByArtefactAndViewer`, `save` (upsert on the pair), `listViewersByArtefact`,
  `deleteByArtefact`). One entry per `(artefact, viewer)`, latest view only. *(VT1)*
- **Commands** — `recordArtefactView(artefactId, viewerId)` upserts the entry (best-effort;
  the caller has already access-checked the artefact). `listArtefactViewers(ref, viewerId)`
  resolves the artefact by slug-or-id under the access matrix, lists its viewers, and
  **excludes the requesting viewer**. *(VT3, VT4)*
- **Persistence** — new `view_entry` table (migration): `id` pk, `artefact_id` FK
  (`ON DELETE CASCADE`), `viewer_id` FK to `user`, `viewed_at`; unique `(artefact_id,
  viewer_id)` so `save` upserts. Drizzle + in-memory repos. Permanent delete (S15) also calls
  `viewRepo.deleteByArtefact` (the cascade is a DB-level backstop). *(VT5)*
- **BFF** — `GET /api/artefacts/:ref/viewers` (signed-in; access-matrix gated): returns the
  other viewers enriched with name/email via the `UserDirectory`. A view is recorded as a
  **server-side side effect** of serving the shared-link host shell (`GET /a/:slug`) to a
  signed-in viewer — there is **no record endpoint**, so it can't be spoofed or skipped.
  Anonymous opens record nothing (VT2); the owner-preview path `/:id/raw` is not recorded. *(VT2, VT3)*
- **Shell (S12 chrome)** — a "viewed by" widget (eye icon + count) sits beside `.ae-switch`
  inside the signed-in-only `.ae-tools` wrapper. Clicking it opens a pop-over listing the
  other viewers and when each last opened the artefact (relative time). Both the shared-link
  shell and the owner preview pass a `viewersEndpoint`; anonymous viewers never get the
  wrapper, so never the widget.
- **Acceptance:** a signed-in `GET /a/:slug` records a view with the current timestamp; a
  second open by the same viewer bumps `viewedAt` and adds no second row; an anonymous open
  records nothing; `GET …/viewers` lists the other viewers (name/email + `viewedAt`) and never
  the caller; a viewer who can't see the artefact (private non-owner / archived) gets 404 from
  `…/viewers` and is never recorded; permanent delete removes the view entries. Access/serving
  behaviour is otherwise unchanged (AH8).
- **Boundary:** **OSS** (a general hosting feature; pure additive context + chrome). No `ee/`
  involvement.

### S22 — Tenant scope + access-policy seam — **done** *(enabler; behaviour-preserving)*
Two thin core seams that let a superset be **multi-tenant**, byte-identical in OSS. (DDD amendments:
`ddd/artefact-hosting.md` AH17/AH18, `ddd/identity-access.md` IA5. EE context:
`ee/docs/specs/ddd/tenancy.md`.)
> **Progress:** **done — A1 + A2 + B + C.** A1 — `Artefact.tenantId` + the `tenant_id` column (both schemas,
> migration `0006`) default to `DEFAULT_TENANT` and are stamped at create. A2 — `findById`,
> `listByOwner`, and `listShared` are now **scope-aware** (take a `TenantScope`,
> `domain/artefact/tenant-scope.ts`); `findBySlug` stays **tenant-global** because a slug is a
> globally-unique capability (AH6) and the per-tier tenant check for a slug-served artefact is the
> `AccessPolicy`'s job (part B). The scope is resolved per request by an injected
> `TenantScopeResolver` (OSS default `singletonScopeResolver` → `DEFAULT_TENANT`, byte-identical;
> threaded through `createApp`/`createApiRoutes` + the artefact/data/view route factories + the MCP
> `createMcpRoutes`). A `TenantScope` is a **single** tenant (the active org), not an org-set: a
> multi-org user works within one active org per request, which also maps 1:1 onto the EP2 RLS
> `SET LOCAL app.tenant_id`. Behaviour-preserving — all existing tests stay green; new in-memory
> tests prove a stub multi-tenant scope excludes other-tenant rows and that `findBySlug` stays
> cross-tenant. B — the **`AccessPolicy` port** (`domain/artefact/access.ts`): `ViewableArtefact`
> carries `tenantId`, and the matrix is factored so its **one policy-decided cell** — a signed-in
> non-owner asking for the `authenticated` tier — delegates to
> `grantsAuthenticatedTier(viewerId, tenantId)` (`canViewArtefactUnder`; the sync `canViewArtefact`
> stays the OSS default form). AH7/AH8/AH9 are fixed **by construction**: the policy is never asked
> about the anonymous, the owner's own view, other tiers, or archived. Injected through
> `createApp`/`createApiRoutes` (default `defaultAccessPolicy`, byte-identical) into the paths where
> the **slug capability crosses tenants**: serving (`/a/:slug` shell + frame) and the slug-resolved
> data/viewers reads. Deliberately **not** threaded into id-addressed reads (bookmarks, dashboards)
> or `canViewCollection`: those resolve via the tenant-scoped repo (T2), and within a scope the
> viewer is a co-member by construction (collections additionally have no slugs and are signed-in
> only), so a policy there could never decide differently. C — the sign-up allowlist accepts the
> `"*"` allow-all sentinel (IA5). Route-level tests (`server/access-policy.test.ts`) prove a stub
> co-member policy grants a member, denies a signed-in non-member with a flat 404 (AH8), keeps the
> anonymous redirect uniform, never denies the owner, and leaves `public` untouched.
- **Scope.** `Artefact` gains `tenantId` (immutable; migration defaults existing + new rows to
  `DEFAULT_TENANT`). `ArtefactRepository` list/find take a **`TenantScope`**; OSS wires the singleton
  scope, so listing/serving is unchanged. Subordinate reads (data, views, versions) inherit the
  scope. *(AH17)*
- **Access policy.** Extract the access-matrix decision into an **`AccessPolicy`** port; OSS wires
  the default = the current matrix. Only the `authenticated` tier is overridable; AH8/AH9 are fixed.
  *(AH18)*
- **Identity.** The sign-up allowlist predicate gains an **allow-all** config option (OSS keeps its
  configured domains). *(IA5)*
- **Acceptance:** under the OSS defaults, every existing access/listing/serving test passes
  unchanged (one tenant; `authenticated` = any signed-in user; allowlist as configured); a stub
  multi-tenant scope makes `listByOwner`/`listShared`/serve exclude other-tenant rows; a stub access
  policy that scopes `authenticated` to a tenant denies a signed-in non-member with a flat 404 (AH8
  holds).
- **Boundary:** **OSS** (the scope + policy must live in the repo/serving/access path). The org
  model, the real scope, and the org-aware policy are the **EE Tenancy/Organizations** context.

### S23 — EE enforcement policy seams (quota / payload-size / branding) *(enabler; behaviour-preserving)*
The core seams the **EE Usage & Quota** context plugs into — all **no-op in OSS**. (DDD:
`ee/docs/specs/ddd/usage-quota.md`; size-cap amendment `ddd/artefact-hosting.md` AH19.)
- **QuotaPolicy.** A `QuotaPolicy` port consulted at `createArtefactCommand` (+ payload-replacing
  edit for the storage fence). OSS default = **allow / unlimited**. *(usage-quota Q1)*
- **Payload-size policy.** Extract `MAX_PAYLOAD_BYTES` into a policy; **OSS default keeps 100 MB**.
  EE drives it from the *Large Artefacts* entitlement (10 MB / 100 MB). *(AH19)*
- **BrandingPolicy.** A `BrandingPolicy` consulted by the host shell on **public** serves; **OSS
  default = no badge**. EE shows the Artefactor badge unless *Remove branding* is held.
- **Acceptance:** under the OSS defaults, creates are unlimited, the size cap is 100 MB, and no badge
  renders — byte-identical; a stub deny-quota makes `create` return `402`; a stub 10 MB size policy
  rejects an 11 MB payload; a stub branding policy renders the badge on a public serve.
- **Boundary:** **OSS** (the seams sit at the create/edit commands and the S12 shell). The metering,
  plan-aware policy, entitlements, and soft fences are the **EE Usage & Quota** context (EQ1–EQ5).

### S24 — Inject persistence ports into the composition — **done** *(enabler; behaviour-preserving)*
Make the BFF composition accept the domain-port adapters as **injected dependencies**, so a
superset can wire a different backend (Postgres) without forking the composition. (EE context:
`ee/docs/specs/ddd/postgres-persistence.md`.)
- Today `src/server/adapters.ts` builds the SQLite/filesystem adapters as module singletons and
  `createApiRoutes()` imports them directly. Refactor `createApiRoutes()` and the `/api` route
  modules to **take the adapter set** (`{ artefactRepository, dataRepository, viewRepository,
  payloadStore, userDirectory }`) as a parameter; `createApp()` threads it. `adapters.ts` remains
  the **OSS default set** (SQLite + filesystem), passed by the OSS entry. (The serve + MCP route
  factories already take injected deps.)
- **The BetterAuth instance is injected the same way** — `createApp(adapters, auth)` (OSS default =
  the SQLite-backed `auth`); `attachSession` becomes a factory `createAttachSession(auth)`. This is
  required because `artefact.ownerId` and the data/view rows FK to BetterAuth's `user` table and the
  `UserDirectory` reads it, so a superset's Postgres app must back **auth and the domain by the same
  database** — a SQLite/Postgres split would FK-fail. Behaviour-identical for OSS.
- **Acceptance:** every existing route/serving/MCP test passes unchanged under the default
  (SQLite) wiring + default `auth`; a test injecting in-memory/fake adapters into `createApp`
  exercises the full `/a` serve surface **without** touching `adapters.ts`/`client.ts`; no route
  module imports the adapter or auth singleton directly anymore.
- **Boundary:** **OSS** (the composition lives in core). The Postgres adapter set, pg schema, RLS,
  and the EE entry that injects them are the EE **Postgres persistence** context. Behaviour-
  preserving; also a testability win for OSS.

### S25 — Collections (folder tree + inherited access)
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
Deps: **S25, S15.** (CL7/CL8.)
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
Deps: **S25** (bookmarkable collections; artefact bookmarks alone would only need S10). (BM1–4.)
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
Deps: **S25.** (CL11; relaxes CL10's audience.)
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
Deps: **S28.** (CL1 relaxed; CL12/CL13/CL14.)
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

### S30 — Export artefact HTML (GUI download + MCP read-back tools)
Deps: **S2, S4, S6, S11, S18.** (AH7/AH8/AH9 for the export read path; AD2/AD4/AD8 for the
data snapshot.) Artefactor could take HTML in but never give it back: the client had no
download affordance, and an agent on the connector could `create`/`update` an artefact but
never *read* one — so it could neither derive a new artefact from an existing one (A) nor
safely update one in place after losing the original from context (B). (B) is a correctness
problem: `update_artefact` replaces the HTML and leaves every per-user data blob untouched,
and the backend treats blobs as opaque (AD8), so it cannot migrate them.

- **Domain** — `extractDeclaredSchema(html)`: a pure, best-effort lift of the artefact's
  **declared data schema** block (below) from its trusted HTML. Absent/malformed/non-object
  → `null`, never an error. A payload *convention*, never enforced.
- **Shared** — `artefactFilename(title, fallback)` + `attachmentDisposition(filename)`: pure
  download-naming helpers (slugify, bound, ASCII-fold, RFC 5987), unit-tested on their own.
- **BFF** — `GET /api/artefacts/:ref/download` (`:ref` = slug **or** id). Resolution and
  access reuse `resolveViewableArtefact`, so effective-tier resolution through a collection
  root (AH20) and the `AccessPolicy` cell (AH18) are **inherited, not re-implemented**. Body
  = `PayloadStore.get(payloadRef)` **verbatim** — no S13 bootstrap, no S12 host shell, so the
  download round-trips (download → edit → re-upload / `update_artefact` yields the same
  artefact). `Content-Type: text/html; charset=UTF-8`; `Content-Disposition: attachment` with
  both `filename` and `filename*`; `Content-Length` = `payloadBytes`. Unknown ref /
  not-viewable / **archived** → flat 404.
- **MCP** — `get_artefact_html { id }` → `{ id, title, kind, html, dataAuthorCount }`;
  `get_artefact_data { id }` → `{ id, blob, bytes, updatedAt, dataAuthorCount, schema,
  currentPayloadVersion, authoredAgainstVersion }` — the caller's **own** entry only, verbatim
  via `getOwnDataEntry`, with no server-side summarising or key/type digest (that would be the
  backend interpreting the blob). Both owner-scoped via `loadOwnActiveArtefact`. Each
  hard-errors above its cap (`MAX_MCP_HTML_BYTES` ≈ 1 MB, `MAX_MCP_BLOB_BYTES` ≈ 256 KB),
  naming the real size and pointing at the GUI download — **no truncation**: truncated HTML is
  unusable for editing and truncated JSON unparseable, and either invites the agent to act on
  a fragment as though it were whole.
- **Doctrine** — `skills/artefactor/SKILL.md` + `PERSISTENCE_CONTRACT_SUMMARY`: **migrate
  forward** now leads the breaking-change guidance (read old key → transform → write new;
  idempotent, at load before first render, old key kept one generation, never `clear()`), the
  snapshot is one blob and not the population, and the schema block joins the template +
  checklist. Bumping the key without migrating is named for what it is — silent data loss.
- **Client** — "Download HTML" in `MoreMenu` (reaching `ArtefactRow` + `ArtefactCard`), owned
  artefacts only. A plain anchor: session-cookie auth needs no fetch/blob dance.
- **Acceptance:** owner downloads own artefact by id at any visibility, byte-identical to what
  was uploaded; viewer downloads a shared artefact by slug; anonymous downloads a `public` one;
  private-to-a-non-owner, **archived (including for the owner)**, and unknown ref all 404; both
  `Content-Disposition` forms present and `Content-Length` = `payloadBytes`; no bootstrap or
  shell in the body; filename helper covers ASCII / non-ASCII (åäö) / symbol-only (falls back
  to slug-or-id) / 300-char (bounded) / always `.html`. `get_artefact_html` returns the exact
  stored HTML with `dataAuthorCount`; `get_artefact_data` returns the caller's own blob
  verbatim, `blob: null` when they have none, never another author's; over-cap on either →
  error naming the actual size; non-owner / unknown / archived / out-of-scope → not found;
  `schema` is parsed JSON when present and `null` when absent, malformed, or not valid JSON —
  **never** an error; a blob is never validated against a declared schema (AD8 holds); an
  artefact with a declared schema survives export → re-upload intact; `currentPayloadVersion`
  equals `payloadHash` and `authoredAgainstVersion` is `null` while S19 is unbuilt (both
  fields' presence and shape asserted).
- **Archived stays inert (AH7)** — no owner carve-out. Restore → download → re-archive is one
  click, which is not worth an exception in AH7 for an escape hatch.
- **On S19/AD9 — reserve, don't depend.** `get_artefact_data` returns the version-pin **pair**
  but S19 is **not** a dependency edge, and the missing edge is deliberate, not an oversight:
  AD9 is *advisory by spec* and never gates a read or write, so nothing here is incorrect while
  the pin is `null`; and S19 also carries the unrelated AH15 `PayloadRetentionPolicy` port in
  the edit command, which read-back has no business pulling in. `currentPayloadVersion` is free
  today (`payloadHash` is already on the aggregate). When S19 lands, the pin populates with
  **no tool-shape change and no doctrine rewrite** — the rule "pin present and ≠ current ⇒ that
  user's data predates this payload" is written now and becomes true then.
- **Out of scope:** the download affordance for "shared with you" (`GalleryCard`/`GalleryRow`)
  and the `/a/:slug` shell toolbar (the endpoint already honours the matrix — widening is
  client-only); baking a data snapshot into the downloaded file; any data **write** tool (S31);
  a per-artefact "allow download" toggle (new field + invariant + migration, and defeated by
  view-source anyway).
- **Boundary:** **OSS**. No schema change.

### S31 — Agent edits data: `set_artefact_data` MCP tool
Deps: **S11, S18, S30.** (AD1/AD2/AD3/AD6/AD8; AH7.) A user's saved data could only change by
opening the artefact and editing by hand. With the S30 snapshot read, an agent can close the
loop: read the whole blob, transform it in the session ("add these six rows", "reset last
quarter"), write the whole blob back.

- **Not S17.** The dropped merge-patch put the merge in the backend (parsing the blob, breaking
  AD8). S31 transforms **agent-side** and writes through the existing `putOwnDataEntry`, which
  parses only to enforce AD8 — the server still never interprets the blob. See "Connector write
  (S31)" in `ddd/artefact-data.md`.
- **Domain / command** — `DataConflict` (new `DataError`). `putOwnDataEntry` gains an optional
  `{ ifUnmodifiedSince?: Date | null }`: a timestamp refuses the write if the stored entry's
  `updatedAt` is newer; `null` ("I read no entry") refuses if an entry now exists; absent writes
  unconditionally.
- **BFF** — `PUT …/data/me` optionally conditional: `If-Match: "<updatedAt ISO>"` → timestamp
  pin, `If-None-Match: *` → `null`; conflict → **412**; unparseable `If-Match` → 400 (never an
  unconditional write). No header → unconditional, as before.
- **Runtime (amends S13)** — the open tab is the likeliest concurrent writer and, unguarded,
  would silently revert an agent's write by saving its stale in-memory copy. The shim now
  writes **only when dirty** (an idle open tab never writes — hide/close sends nothing), pins
  every `PUT` to the `updatedAt` it was seeded with / last saved (`seedUpdatedAt` inlined by
  `render.ts`), never overlaps saves (except the forced `pagehide` flush), and on 412 stops
  writing and posts `artefactor:data-conflict` to the parent.
- **Host shell (amends S12)** — a signed-in-only banner ("changed elsewhere … Reload") revealed
  by that message, accepted only from its own same-origin frame; Reload re-seeds the current
  data context.
- **MCP** — `set_artefact_data { id, blob, if_unmodified_since? }` → `{ id, bytes, updatedAt }`.
  **Whole-blob replacement only**, stated outright in the description (a model assuming merge
  semantics would silently delete every key it didn't send). Owner-scoped via
  `loadOwnActiveArtefact`, matching the S30 reads. `InvalidBlob` → error carrying the JSON
  parser's message; `BlobTooLarge` → error naming the actual size against the 5 MB cap;
  `DataConflict` → error directing a re-read via `get_artefact_data`. All leave the entry
  untouched.
- **Doctrine** — `skills/artefactor/SKILL.md` + `PERSISTENCE_CONTRACT_SUMMARY`: read before
  write, always, pinned with the read's `updatedAt`; use the declared schema (its `example` is
  what makes a write into an empty blob possible) but verify an inferred shape against
  `get_artefact_html`; check the version pin (`≠ current` or `null` ⇒ transform to the live
  shape, don't write back as found); keep the pre-write blob to revert; say what will change
  before writing.
- **Acceptance:** round-trip get → transform → set → re-read returns the blob verbatim with
  `updatedAt` bumped and `createdAt` + entry id preserved; first write creates, second updates
  (never two entries); another author's entry untouched; invalid JSON → error naming the parse
  failure; over 5 MB → error naming the actual size; HTTP `If-Match` current → 200, stale → 412
  with nothing written, `If-None-Match: *` → 200 then 412, malformed → 400; the shim sends
  nothing from an idle tab (hide/close), doesn't re-send after a completed save, pins with
  `If-Match`/`If-None-Match: *`, adopts its own save's `updatedAt`, serialises overlapping
  saves, and on 412 stops writing + notifies the shell; the served frame inlines the entry's
  `updatedAt` as the pin; the shell renders the banner for signed-in viewers only and accepts
  the message only from its own frame; stale pin (timestamp or `null`) →
  conflict, nothing written, message directs a re-read; no pin → unconditional write, existing
  data tests green; non-owner (even on a shared artefact) / unknown / archived / out-of-scope →
  not found; a tool-written blob — including one built from the declared schema's `example`
  into an empty entry — is what the served artefact's localStorage shim seeds.
- **On S19/AD9 — sharpener, not dependency** (as S30). The write path stamps the pin for free
  once S19 exists, because it is the same `putOwnDataEntry`; S19's own tests assert it. The
  doctrine holds either way.
- **Open question, decided: owner-scoped v1.** `putOwnDataEntry` already permits writing your
  own blob on any viewable artefact, but a write reaching further than the owner-scoped read
  would break read-modify-write exactly where the reach was wanted. Widening read + write
  together (addressed by slug or id) is one deliberate follow-up.
- **Out of scope:** a delete tool (write `{}`); merge-patch (S17 stays dropped); writing another
  author's blob (a domain no, not a follow-up); any GUI equivalent.
- **Boundary:** **OSS**. No schema change.

### S32 — Link controls: password + expiry
Deps: **S6, S11/S12, S21, S25, S30.** (DDD amendment: `ddd/artefact-hosting.md` AH22–AH24.)
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
  "Inherited from <root>". Owner cards show lock / clock badges. An unlock page in the shell for
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

### S33 — Share-invitation seam *(enabler; behaviour-preserving)*
Deps: **S1, S16, S25.** The core hook a superset uses to let an owner share with an **email that
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
  <email>" for a well-formed email with no directory match and shows pending invitations as chips
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

### S34 — Comments + agent feedback loop (MCP)
Deps: **S12, S18, S21, S25, S32** (gate composition). (New DDD bounded context: `ddd/artefact-feedback.md`, FB1–FB7; amends
`ddd/artefact-hosting.md` AH11.) Threaded comments in the host chrome, read and answered by the
owner's agent through the connector. (Market analysis gap #3 — the most differentiating slice.)
- **Domain** — `CommentThread` aggregate with `Comment` entities; pure `startThread`, `reply`,
  `editComment`, `deleteComment` (removes an emptied thread), `resolve` / `reopen`, each
  enforcing FB4 authority. `CommentBody` value object (FB, ≤ 10 000 chars). `anchor` field
  present and forced `null` (FB7). `ThreadRepository` port (`save`, `findById`,
  `listByArtefact(status)`, `countOpenByArtefacts`, `deleteByArtefact`).
- **Commands** — every command resolves the artefact by ref under `authorizeArtefactRead` (S32)
  for FB3, and checks `archived` for FB5. Permanent delete (S15) and the CL8 cascade call
  `deleteByArtefact` (FB6).
- **Persistence** — `comment_thread` (`id`, `artefact_id` FK cascade, `tenant_id`, `anchor`
  JSON null, `status`, `created_by`, `created_at`, `resolved_by`, `resolved_at`) and `comment`
  (`id`, `thread_id` FK cascade, `author_id` FK, `body`, `via_connector`, `created_at`,
  `edited_at`). Drizzle + in-memory repos.
- **BFF** — the endpoints in `artefact-feedback.md`. Owner summaries gain `openThreadCount`
  (batched via `countOpenByArtefacts`).
- **MCP** — `list_feedback`, `reply_to_feedback`, `resolve_feedback` (owner-only, `viaConnector
  = true`); `get_artefact` returns `openThreadCount`. Update the connector `instructions`,
  `authoring-guide.ts` and `skills/artefactor/SKILL.md` with the **list → update → reply →
  resolve** loop in the same change.
- **Shell (S12 chrome)** — a comments widget (speech-bubble + open count) in `.ae-tools` beside
  the viewer list, opening a side drawer: open / resolved tabs, new-thread box, replies, edit /
  delete / resolve per FB4, "via Claude" label on connector comments. Bodies rendered as text
  nodes only.
- **Client (SPA)** — owner dashboard cards show an open-thread badge.
- **Acceptance:** a signed-in viewer starts a thread and replies; a non-viewer gets 404 and an
  anonymous viewer of a `public` artefact sees no threads and cannot post (FB2/FB3); a
  password-gated artefact's threads need a pass (AH22); an author
  edits their own comment, the owner can delete but not edit it, a stranger can do neither;
  deleting a thread's last comment removes the thread; the owner or thread creator
  resolves/reopens, others cannot; archived → 404 for everyone, threads back on restore;
  permanent delete (and a collection delete cascade) removes threads; a body of `<img src=x
  onerror=alert(1)>` renders as literal text in the shell; an empty or 10 001-char body is
  rejected; a non-null anchor is rejected (FB7); `list_feedback` returns only open threads by
  default, is not-found for a non-owner token, and `reply_to_feedback` produces a comment with
  `viaConnector = true` attributed to the token's Account; `openThreadCount` matches.
- **Out of scope:** notifications and mentions (EE — OSS has no transactional email), markdown,
  anchoring (**S34b**).
- **Boundary:** **OSS**.

#### S34b — Anchored comments *(follow-on; not yet specced in detail)*
Deps: **S34, S19** (payload version). Attach a thread to a text quote in the payload
(`Anchor` = TextQuoteSelector + `payloadVersion`, reserved in FB7) via an annotation layer
injected alongside the S13 runtime; threads whose `payloadVersion` ≠ the current payload hash
show as "on an earlier version" instead of mis-anchoring. Governing invariants to be written
before the slice starts.

## Build order

Topological: **S0 → S1 → S2 → {S3, S4, S5, S7, S10, S11}**, **S5 → {S6, S14, S16}**,
**S7 → S15**, **S11 → {S12, S13}**, **{S2, S3, S4, S5, S7, S10} → S18** (S18's tools expose the
S4 single-artefact read and the S10 owner list). S10 can land early (right after
S2) to give a working surface to iterate against. The data-store branch (S11–S13) is
independent of the sharing branch and can proceed in parallel once S2 exists. ~~S8/S9~~ (API
keys) and ~~S17~~ (data merge-patch) are dropped — see the DAG note. S18 is the programmatic
surface. **S19** (retention seam + data pin) depends only on **S3** (the edit/replace path) and
**S11** (`DataEntry`); it is behaviour-preserving in OSS and is the sole core dependency of the
EE *Artefact History* context. **S22** (tenant scope + access-policy seam) depends on the repo +
serving/access path (**S6/S10/S14**) and **S23** (EE policy seams) on the create/edit commands
(**S2/S3**) + the S12 shell; both are behaviour-preserving enablers and the sole core dependencies
of the EE **Tenancy/Organizations** and **Usage & Quota** contexts respectively. **S24** (inject
persistence ports) refactors the composition (**S2 onward**); behaviour-preserving and the sole core
dependency of the EE **Postgres persistence** context. **S25** (collections) depends on the
hosting core + sharing (**S2/S5/S6/S10/S16**); **S26** (collection lifecycle) on **S25 + S15**;
**S27** (bookmarks) on **S25**; **S28** (viewer-facing shared collections) on **S25** and
**S29** (contributors + evict-on-cascade) on **S28**. All five are OSS feature slices
(context `ddd/artefact-collections.md`). **S30** (export HTML) depends on the hosting read
path + the data store + the connector (**S2/S4/S6/S11/S18**); **S19** is an *optional
sharpener* of S30's staleness signal, **not** a dependency edge (see the slice's
reserve-don't-depend note). **S31** (agent data write) depends on **S11/S18/S30**, with S19
again an optional sharpener only. **S32** (link controls) depends on every non-owner read path it
gates (**S6/S11/S12/S21/S30**) and on **S25** (the root's gate governs contained artefacts).
**S33** (share-invitation seam) depends on `/api/config` (**S1**) and the access-list modal for
artefacts and collection roots (**S16/S25**); it is behaviour-preserving and the sole core
dependency of the EE **Share invitations** context. **S34** (comments) depends on the shell
(**S12**), the connector (**S18**), the S21 chrome pattern, **S25** (effective access) and **S32**
(its composed read authorization). **S34b** (anchors) needs **S34 + S19**. S32, S33 and S34's
prerequisites are independent, so S32 and S33 can proceed in parallel. All are OSS.
