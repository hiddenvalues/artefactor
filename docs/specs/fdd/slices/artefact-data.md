# Artefact Data

## Slices

### S11 — Store: read/write own data blob

- **Status:** done
- **Depends on:** S2
- **Delivers:** data.entry.one-per-pair, data.entry.identity-immutable, data.write.author-is-caller,
  data.write.requires-auth, data.read.follows-artefact-access, data.lifecycle.archived-inert,
  data.blob.bounded-opaque-json

*Shipped with S13.*

The BFF endpoints for the caller's own entry. They are consumed by the host shell on the served
artefact's behalf: the artefact never calls them directly, its persistence flows through the
hijacked `localStorage`. `:ref` is the artefact's **public slug or its id** — the runtime resolves
either (the id form addresses a never-shared private artefact; see the implementation notes).

| Method | Path | Purpose | Consumer / access |
| -------- | ------ | --------- | ------------------- |
| `GET` | `/api/artefacts/:ref/data/me` | The caller's own entry | host/runtime; authenticated |
| `PUT` | `/api/artefacts/:ref/data/me` | Upsert the caller's blob (full replace); optionally conditional (`If-Match` / `If-None-Match: *` → 412, S31) | host shell, for the shim; authenticated |
| `DELETE` | `/api/artefacts/:ref/data/me` | Remove the caller's entry | authenticated |

**Acceptance:**

r[data.me.own-entry-endpoint]
`GET …/data/me` returns the caller's blob (`blob: null` when they have none); `PUT …/data/me`
rejects invalid JSON with 400 and an oversize blob with 413.

The rest restate requirements the slice delivers:

- Authenticated viewer upserts their own JSON blob for an artefact (one per author)
  (`data.entry.one-per-pair`, `data.write.author-is-caller`, `data.write.requires-auth`).
- Unauthenticated write rejected; archived artefact → 404 (`data.write.requires-auth`,
  `data.lifecycle.archived-inert`).

**Implementation notes (from building S11):**

- **New bounded context** `src/domain/data/`: the `DataEntry` aggregate (opaque `blob` text,
  `MAX_BLOB_BYTES = 5 MB`), `assertBlobWithinBounds` (size-then-`JSON.parse`, `data.blob.bounded-opaque-json`),
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
  can see; archived / not-viewable / unknown ref all collapse to `404`
  (`data.read.follows-artefact-access`, `data.lifecycle.archived-inert`).
- **Commands** (`src/server/data/own-data.command.ts`): `get` / `put` / `delete` own entry,
  all gated by the slug+access resolver. `authorId` is always the authenticated caller
  (`data.write.author-is-caller`, `data.write.requires-auth`) — there is no anonymous write.
- **BFF** (`routes/data.ts`, mounted at `/api/artefacts/:ref/data`): `GET /me` (200 with
  `blob: null` when none), `PUT /me` (raw JSON body, `InvalidBlob → 400`, `BlobTooLarge →
  413`), `DELETE /me` (204). All `requireAuth`; `ArtefactNotFound → 404`.
- **Tests:** domain unit (blob bounds, upsert), command unit (per-author isolation, access/
  archived gating, delete), and an end-to-end `data.test.ts` (upsert/read, `blob:null`,
  per-author separation, `400`/`401`/`413`, archived `404`, private non-owner `404`, delete).
- The author-listing + per-author endpoints (S12) and the localStorage runtime shim (S13)
  build on this; no client UI yet (S11 is the API surface they consume).

### S12 — Host UI: data-context switcher

- **Status:** done
- **Depends on:** S11
- **Delivers:** data.read.follows-artefact-access, data.write.own-context-only,
  data.context.host-chosen

The host data-context switcher: list which authors have data, and load a chosen author's blob into
the viewer. These two endpoints exist **only** to power it; the artefact itself stays opaque and
single-dataset.

| Method | Path | Purpose | Consumer / access |
| -------- | ------ | --------- | ------------------- |
| `GET` | `/api/artefacts/:ref/data/authors` | List authors who have an entry (id + `updatedAt`) | host UI; per access matrix |
| `GET` | `/api/artefacts/:ref/data/:authorId` | Load one author's blob (for seeding/switching) | host UI; per access matrix |

**A server-rendered shell.** `/a/:slug` returns a thin host shell (a toolbar that wraps an
`<iframe>` loading the artefact from `/a/:slug/frame`). The frame URL carries a short-lived
**frame token** that names the context (`data.frame-token.signed-claims`). Switching author asks
the BFF for a new tokened frame URL, and an expired token makes the frame ask the shell to mint a
fresh one. The shell is server-rendered rather than part of the SPA because `/a/:slug` is the
shareable link and must also serve unauthenticated/public viewers, who never load the SPA. For a
signed-in viewer the picker itself only appears when there's another context to switch to (S20).
The switcher lists only the authors `data.visibility.narrows-reads` lets the viewer load: under
`own`, a non-owner's list holds at most their own entry, so the picker stays hidden for them. Only
the viewer's *own* context is seeded writable; any other author is read-only
(`data.write.own-context-only`).

**Acceptance:**

r[data.switcher.signed-in-only]
The **host tools** — the data-context picker, and any future toolbar widgets — live in a
**signed-in-only** wrapper: an anonymous public viewer gets the title bar + artefact only, never
the switcher. (This is a host-UI choice, not an access rule: the `…/authors` / `…/:authorId`
endpoints stay **not** `requireAuth`-gated, so `data.read.follows-artefact-access` — anonymous
*may* read a `public` artefact's data — still holds at the API; the switcher just isn't surfaced to
them.)

The rest restate requirements the slice delivers:

- A signed-in viewer with read access can list authors who have data and load another
  author's blob into the artefact, **read-only** (re-seed/iframe reload)
  (`data.context.host-chosen`, `data.write.own-context-only`).
- Tiers enforced via the `…/data/authors` + `…/data/:authorId` endpoints: private → owner
  only; authenticated → signed-in; public → anyone (`data.read.follows-artefact-access`).
- This lives entirely in the host (BFF + chrome); the artefact stays opaque. The author is named by
  a minted frame token (S36), and the owner may narrow the switcher to own-only (S41,
  `data.visibility.narrows-reads`).

**Implementation notes (from building S12):**

- **`/a/:slug` now returns a host *shell*** (`src/server/runtime/shell.ts`) — a thin toolbar
  with the data-context `<select>` wrapping an `<iframe>`. The artefact itself moved to
  **`/a/:slug/frame`** (`?author=<id>` selects the context). Both routes resolve the slug and
  apply the same access matrix (deny → 404). Splitting them keeps the switcher chrome
  *outside* the artefact container, exactly as `data.context.host-chosen` requires.
  *(Amended by S36: the context is named by a minted frame token (`?t=`), never `?author=`, and
  the frame routes live in `routes/frame.ts`, where they read no cookies.)*
- **Server-rendered, not the SPA.** `/a/:slug` is the shareable link and serves
  unauthenticated/public viewers who never load the Svelte SPA, so the shell + picker are
  server-rendered (inline JS that fetches `…/data/authors` and re-points the iframe). The
  DDD doc's "Svelte chrome" was aspirational; the served path is Hono, not the SPA.
- **Read-only foreign context** (`data.write.own-context-only`): `renderServedArtefact` gained an
  `authorId` option; the seeded context is writable **only** when the viewer is signed in *and*
  `authorId` equals the viewer (otherwise `writable:false`, so the S13 shim throws on write).
- **Two new endpoints** under the existing `/api/artefacts/:ref/data` mount — `GET /authors` and
  `GET /:authorId` — gated by the access matrix (`data.read.follows-artefact-access`), **not**
  `requireAuth` (a public artefact's data is readable by the anonymous). Static `/authors`+`/me` are
  defined before the `/:authorId` param so they win. Commands in
  `src/server/data/author-data.command.ts` reuse `resolveViewableArtefact`; the repo gained
  `listAuthorsByArtefact` (no schema change).
- **Author labels** are enriched BFF-side: a `UserDirectory` port
  (`src/server/data/user-directory.ts` + Drizzle adapter) resolves author ids → name/email
  from the BetterAuth `user` table. The Artefact Data store still holds only opaque ids; the
  BFF composes them with Identity for presentation.
- **Tests:** `author-data.command.test.ts` (access-matrix unit cover), `data-authors.test.ts`
  (e2e endpoints incl. anonymous-public, archived→404, `/me` not shadowed), and `serve.test.ts`
  extended for the shell/frame split + the read-only `?author` seed.

### S13 — Artefact runtime bootstrap (localStorage hijack)

- **Status:** done
- **Depends on:** S11
- **Delivers:** data.shim.injected-first, data.shim.full-sync-api, data.shim.keyspace-is-blob,
  data.shim.seeded-server-side, data.shim.writes-through-shell, data.shim.quota-over-cap,
  data.shim.read-only-throws, data.shim.no-helper, data.context.host-chosen

*Shipped with S11.*

The acceptance criteria restate requirements the slice delivers (the runtime contract,
`ddd/artefact-data.md`):

- Served artefacts get an injected shim that **replaces `window.localStorage`** with a
  backend-backed store, **seeded server-side** with the current data context so reads are
  synchronous; writes are write-through + debounced (`data.shim.injected-first`,
  `data.shim.full-sync-api`, `data.shim.keyspace-is-blob`, `data.shim.seeded-server-side`,
  `data.shim.writes-through-shell`). The shell writes only when dirty, pinned
  (`data.shell.writes-pinned`, S31), and persists for the sandboxed frame (S36).
- The artefact needs **zero code changes** and sees **one opaque dataset** — `localStorage`
  only, no `ARTEFACTOR` helper (`data.shim.no-helper`).
- Over-cap write throws `QuotaExceededError`; a read-only context (logged-out public viewer,
  or another author's data loaded via S12) throws on write while seeded reads still work
  (`data.shim.quota-over-cap`, `data.shim.read-only-throws`).

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
  *(Amended by S36: the shim no longer fetches. It posts `artefactor:data-changed` with the whole
  blob to the host shell, which sends the pinned `PUT …/data/me` itself — `shellFrameJs` in
  `runtime/shell.ts`.)*
- **Injection** (`injectBootstrap`): placed right after `<head>` (else `<html>`, else
  prepended) so it runs before any artefact script. The artefact is unchanged.
- **Seeding** (`runtime/render.ts`): on serve, the BFF loads the viewer's own `DataEntry` and
  inlines it. Both serving paths inject it — `GET /a/:slug` (S6, writes back via the slug)
  and the owner preview `GET /api/artefacts/:id/raw` (S4, writes back via the id alias). An
  authenticated viewer gets a read-write context seeded with their own blob; an unauthenticated
  public viewer gets an empty read-only one (no anonymous writes — `data.write.requires-auth`,
  `data.write.own-context-only`).
- **S12 deferred:** loading *another* author's blob read-only (the host data-context switcher)
  is S12; S13 ships the own-context (default) seeding and the read-only mechanism it will reuse.
- **Tests:** the shim is unit-tested by **evaluating the generated JS** with mocked browser
  globals (seeded reads, write-through PUT, debounce/pagehide flush, over-cap + read-only →
  `QuotaExceededError`) plus injection/escaping tests; integration tests assert the bootstrap
  is injected and seeded with the viewer's own data (read-write) vs anonymous (read-only).
  *(Amended by S36: the shim tests assert the post to the shell and that it never fetches; the
  write-through `PUT`, debounce-then-save and pagehide keepalive are tested on the shell, in
  `runtime/shell.test.ts`.)*

### S17 — Data merge-patch

- **Status:** dropped
- **Depends on:** S11

A partial-update (RFC 7396 merge) endpoint would force the backend to parse and transform the
data blob, breaking its opacity invariant (`ddd/artefact-data.md`). Data writes stay
whole-blob `PUT`s; an artefact owns its own data-shape compatibility (versioned `localStorage`
keys), and a breaking shape change is published as a new artefact. The MCP connector therefore
exposes **no data-write tool** — it surfaces `dataAuthorCount` so a breaking HTML update can be
flagged (see S18).

### S19a — Data version pin

- **Status:** done
- **Depends on:** S3, S11
- **Linear:** ALI-269
- **Delivers:** data.pin.stamped-on-write, data.pin.null-before-pin

*Enabler; behaviour-preserving.*

One half of the core change that makes artefact **history / rollback** buildable by a superset
without adding versioning to OSS; the other half is **S19b — Payload-retention seam**. (DDD
amendment: `ddd/artefact-data.md` *payload version pin*.) The halves are independent and ship apart.
The EE *Artefact History* context needs **both**, so this pin alone doesn't unblock it. The pin is
stamped at the S11 write site; the S3 payload edit is what makes a pin stale.

- **Data — version pin.** `DataEntry` gains `authoredAgainstVersion`. `upsertDataEntry`
  requires it, so no write path can skip it, and `putOwnDataEntry` stamps it with the resolved
  artefact's `payloadHash`. That one site covers `PUT …/data/me` **and** `set_artefact_data`
  (S31), with no connector-specific path. Advisory only: opacity and the read/write access rules
  are unchanged. The Drizzle upsert's `ON CONFLICT DO UPDATE SET` carries the pin, so it
  **re-stamps** on update and doesn't freeze at the first write. `get_artefact_data` now returns
  the entry's pin in the field S30 reserved (same shape). Not exposed on the BFF
  `DataEntryResponse` or the S12 author list (no consumer). *(`data.pin.stamped-on-write`)*
- **Persistence:** migration `0008` adds the nullable `authored_against_version` column (no
  backfill). The EE Postgres mirror (`pg-schema.ts` + `PgDataRepository`) carries the same
  column and mapping, as the EE persistence-parity rule requires.
- **Boundary:** **OSS** (the pin must live where the write does). The version store and
  rollback are the **EE** *Artefact History* context — see `ee/docs/specs/`.

**Acceptance:**

r[data.pin.adapter-restamps]
The Drizzle adapter re-stamps the pin on update: its upsert's `ON CONFLICT DO UPDATE SET` carries
`authoredAgainstVersion`, so an entry written before a payload edit reads back a pin ≠ the new hash
and the next write re-stamps it.

The rest restate requirements the slice delivers: a fresh data write records the current payload
hash; an entry predating the column reads `null` and is still read and written normally (its next
write stamps it); the pin never grants or refuses access (a stale pin doesn't block its author; a
current one doesn't admit a non-viewer) (`data.pin.stamped-on-write`, `data.pin.null-before-pin`).
The connector is covered by the MCP connector slices' requirements: `get_artefact_data` returns
`null` with no entry, `= currentPayloadVersion` after a write, and `≠` after `update_artefact`
replaces the HTML; `set_artefact_data` and a direct `putOwnDataEntry` stamp the same pin.

### S20 — Hide the data-context switcher for non-persisting artefacts

- **Status:** done
- **Depends on:** S2, S3, S12
- **Delivers:** hosting.uses-storage.chrome-only, hosting.uses-storage.computed-at-create,
  hosting.uses-storage.recomputed-with-payload

Stop showing the "Data context" picker (S12 chrome) on artefacts that can't usefully use it.
(DDD amendment: `ddd/artefact-hosting.md` `hosting.uses-storage.chrome-only`.)

- **Domain** — a pure `detectUsesStorage(html)` (word-boundary `localStorage` match; excludes
  `sessionStorage`). `Artefact` gains `usesStorage`, set by `createArtefact` and recomputed by
  `editArtefact` only when the payload is replaced. *(`hosting.uses-storage.chrome-only`)*
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
- **Boundary:** **OSS** (benefits self-hosters; pure chrome/UX). No `ee/` involvement.

**Acceptance:**

r[data.switcher.needs-another-author]
The served shell omits the picker when `usesStorage` is false; with `usesStorage` true but no other
author's data, the picker stays hidden; it appears once a second author has an entry.

The rest restate requirements the slice delivers: an artefact whose HTML uses `localStorage` →
`usesStorage = true`; one using only `sessionStorage` or no storage → `false`; a title-only edit
doesn't flip it; a payload-replacing edit recomputes it (`hosting.uses-storage.computed-at-create`,
`hosting.uses-storage.recomputed-with-payload`). Access/serving behaviour is unchanged
(`hosting.access.matrix`, `hosting.uses-storage.chrome-only`).

### S41 — Owner-set data visibility: shared or own-only

- **Status:** done
- **Depends on:** S12, S18, S20, S36
- **Linear:** ALI-367
- **Delivers:** hosting.data-visibility.owner-set, hosting.data-visibility.new-default-own,
  hosting.data-visibility.legacy-rows-shared, hosting.data-visibility.never-gates-viewing,
  data.visibility.narrows-reads, data.visibility.listing-filtered,
  data.visibility.author-read-refused, data.visibility.mint-refused,
  data.visibility.redeem-refused, data.visibility.refusal-no-leak

Let the owner decide whether viewers may load each other's saved data. Under
`data.read.follows-artefact-access` anyone who can
view an artefact can list every author and load any author's blob, so every respondent to a
survey or form can read every other respondent's answers. (DDD amendments:
`ddd/artefact-data.md` *Owner-set data visibility*, `ddd/artefact-hosting.md`
`hosting.data-visibility.owner-set`.)

- **Domain** — `Artefact` gains `dataVisibility: "shared" | "own"`; `createArtefact` sets `own`.
  `setDataVisibility(artefact, actorId, value)` is owner-only (a non-owner is refused as not found,
  `hosting.access.no-existence-leak`, `hosting.authority.owner-only`), blocked while archived
  (`hosting.lifecycle.archived-frozen`), bumps `updatedAt` and is a no-op when unchanged. A pure
  `canLoadAuthorData(artefact, viewerId, authorId)` beside the access matrix is the single
  predicate: own author (signed in), the owner, or `shared`. *(`data.visibility.narrows-reads`,
  `hosting.data-visibility.owner-set`)*
- **Persistence** — `data_visibility text NOT NULL DEFAULT 'shared'` (migration), so existing
  rows keep today's behaviour; the Drizzle, in-memory and EE Postgres repos map it.
- **Enforcement (four points, one predicate)** — `…/data/authors` lists only what the viewer may
  load (under `own`, a non-owner sees only their own entry, so S20's "≥1 other author" rule hides
  the picker with no shell change); `…/data/:authorId` 404s a refused author; `POST
  …/frame-token { author }` 404s a refused author; frame redemption re-checks the token's
  `authorId`, so a flip to `own` takes effect on the next frame load
  (`data.visibility.redeem-refused`).
- **BFF** — `PUT /api/artefacts/:id/data-visibility { dataVisibility }`: owner only (404
  otherwise, `hosting.authority.owner-only`, `hosting.access.no-existence-leak`), 400 on a bad
  value or an archived artefact (the existing archived-mutation status), 200 with the summary.
  `dataVisibility` rides `ArtefactSummary`.
- **Client (SPA)** — a "Saved data" section in the visibility popover, only when `usesStorage`:
  *Shared with viewers* / *Only each viewer's own*. Shown for an inherited (in-collection)
  artefact too, since the setting is per artefact.
- **MCP** — `set_data_visibility { id, dataVisibility }` (owner, active, in scope; anything else
  is not found); `get_artefact` / `list_artefacts` report `dataVisibility`. The authoring guide
  and the skill say new artefacts default to own-only.
- **Boundary:** **OSS** core, with the Postgres mirror in `ee/`.

**Acceptance** — each restates a requirement the slice delivers: create → `own`; owner flips it;
non-owner / archived refused (`hosting.data-visibility.new-default-own`,
`hosting.data-visibility.owner-set`); the predicate is false only for (`own`, non-owner or
anonymous, foreign author) (`data.visibility.narrows-reads`); a legacy row reads `shared`
(`hosting.data-visibility.legacy-rows-shared`); under `own` a non-owner lists only themself and
404s on another author's entry and frame token, while the owner reaches everyone
(`data.visibility.listing-filtered`, `data.visibility.author-read-refused`,
`data.visibility.mint-refused`); a foreign-context token minted under `shared` 404s once the owner
flips to `own` (`data.visibility.redeem-refused`); the viewer's own context is unchanged.
