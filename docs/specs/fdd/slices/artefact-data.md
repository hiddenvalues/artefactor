# Artefact Data

## Slices

### S11 — Store: read/write own data blob

- **Status:** done
- **Depends on:** S2

*Shipped with S13.*

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

### S12 — Host UI: data-context switcher

- **Status:** done
- **Depends on:** S11

- A signed-in viewer with read access can list authors who have data and load another
  author's blob into the artefact, **read-only** (re-seed/iframe reload). *(AD 4, 5)*
- Tiers enforced via the `…/data/authors` + `…/data/:authorId` endpoints: private → owner
  only; authenticated → signed-in; public → anyone. *(AD 4)*
- This lives entirely in the host (BFF + chrome); the artefact stays opaque.
  *(Amended by S36: sandboxed, token-seeded, persistence via the shell — the author is named by
  a minted frame token, not `?author=`.)*
  *(Amended by S41: the owner may narrow this to own-only — then a non-owner lists and loads
  only their own entry (AD11); the owner still reaches every author.)*

**Implementation notes (from building S12):**

- **`/a/:slug` now returns a host *shell*** (`src/server/runtime/shell.ts`) — a thin toolbar
  with the data-context `<select>` wrapping an `<iframe>`. The artefact itself moved to
  **`/a/:slug/frame`** (`?author=<id>` selects the context). Both routes resolve the slug and
  apply the same access matrix (deny → 404). Splitting them keeps the switcher chrome
  *outside* the artefact container, exactly as AD §"Data context" requires.
  *(Amended by S36: the context is named by a minted frame token (`?t=`), never `?author=`, and
  the frame routes live in `routes/frame.ts`, where they read no cookies.)*
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

### S13 — Artefact runtime bootstrap (localStorage hijack)

- **Status:** done
- **Depends on:** S11

*Shipped with S11.*

- Served artefacts get an injected shim that **replaces `window.localStorage`** with a
  backend-backed store, **seeded server-side** with the current data context so reads are
  synchronous; writes are write-through + debounced with a `pagehide` beacon flush.
  *(AD runtime contract §1)*
  *(Amended by S31: writes only when dirty, pinned with `If-Match`/`If-None-Match: *`, and a
  412 stops the tab writing and prompts a reload in the host shell.)*
  *(Amended by S36: sandboxed, token-seeded, persistence via the shell — the shim posts changes
  to the shell, which owns the S31 discipline.)*
- The artefact needs **zero code changes** and sees **one opaque dataset** — `localStorage`
  only, no `ARTEFACTOR` helper.
- Over-cap write throws `QuotaExceededError`; a read-only context (logged-out public viewer,
  or another author's data loaded via S12) throws on write while seeded reads still work.
  *(AD 3, 5, 8)*

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
  public viewer gets an empty read-only one (no anonymous writes — AD3/AD5).
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

*Enabler; behaviour-preserving.*

One half of the core change that makes artefact **history / rollback** buildable by a superset
without adding versioning to OSS; the other half is **S19b — Payload-retention seam**. (DDD
amendment: `ddd/artefact-data.md` AD9.) The halves are independent and ship apart. The EE
*Artefact History* context needs **both**, so this pin alone doesn't unblock it. The pin is
stamped at the S11 write site; the S3 payload edit is what makes a pin stale.

- **Data — version pin.** `DataEntry` gains `authoredAgainstVersion`. `upsertDataEntry`
  requires it, so no write path can skip it, and `putOwnDataEntry` stamps it with the resolved
  artefact's `payloadHash`. That one site covers `PUT …/data/me` **and** `set_artefact_data`
  (S31), with no connector-specific path. Advisory only: opacity and the read/write access rules
  are unchanged. The Drizzle upsert's `ON CONFLICT DO UPDATE SET` carries the pin, so it
  **re-stamps** on update and doesn't freeze at the first write. `get_artefact_data` now returns
  the entry's pin in the field S30 reserved (same shape). Not exposed on the BFF
  `DataEntryResponse` or the S12 author list (no consumer). *(AD 9)*
- **Acceptance:** a fresh data write records the current payload hash; an entry written before
  a subsequent payload edit reads back a pin ≠ the new hash (the staleness signal), and the
  next write re-stamps it; an entry predating the column reads `null` and is still read and
  written normally (its next write stamps it); the pin never grants or refuses access (a stale
  pin doesn't block its author; a current one doesn't admit a non-viewer); the Drizzle adapter
  re-stamps on update. Because S30 and S31 had already shipped, the connector is covered too:
  `get_artefact_data` returns `null` with no entry, `= currentPayloadVersion` after a write, and
  `≠` after `update_artefact` replaces the HTML; `set_artefact_data` and a direct
  `putOwnDataEntry` stamp the same pin.
- **Persistence:** migration `0008` adds the nullable `authored_against_version` column (no
  backfill). The EE Postgres mirror (`pg-schema.ts` + `PgDataRepository`) carries the same
  column and mapping (P3 parity).
- **Boundary:** **OSS** (the pin must live where the write does). The version store and
  rollback are the **EE** *Artefact History* context — see `ee/docs/specs/`.

### S20 — Hide the data-context switcher for non-persisting artefacts

- **Status:** done
- **Depends on:** S2, S3, S12

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

### S41 — Owner-set data visibility: shared or own-only

- **Status:** in progress
- **Depends on:** S12, S18, S20, S36
- **Linear:** ALI-367

Let the owner decide whether viewers may load each other's saved data. Under AD4 anyone who can
view an artefact can list every author and load any author's blob, so every respondent to a
survey or form can read every other respondent's answers. (DDD amendments:
`ddd/artefact-data.md` AD11, `ddd/artefact-hosting.md` AH30.)

- **Domain** — `Artefact` gains `dataVisibility: "shared" | "own"`; `createArtefact` sets
  `own`. `setDataVisibility(artefact, actorId, value)` is owner-only (a non-owner is refused as
  not found, AH8/AH9), blocked while archived (AH7), bumps `updatedAt` and is a no-op when
  unchanged. A pure `canLoadAuthorData(artefact, viewerId, authorId)` beside the access matrix
  is the single predicate: own author (signed in), the owner, or `shared`. *(AD 11, AH 30)*
- **Persistence** — `data_visibility text NOT NULL DEFAULT 'shared'` (migration), so existing
  rows keep today's behaviour; the Drizzle, in-memory and EE Postgres repos map it.
- **Enforcement (four points, one predicate)** — `…/data/authors` lists only what the viewer may
  load (under `own`, a non-owner sees only their own entry, so S20's "≥1 other author" rule hides
  the picker with no shell change); `…/data/:authorId` 404s a refused author; `POST
  …/frame-token { author }` 404s a refused author; frame redemption re-checks the token's
  `authorId`, so a flip to `own` takes effect on the next frame load (AD10).
- **BFF** — `PUT /api/artefacts/:id/data-visibility { dataVisibility }`: owner only (404
  otherwise, AH8), 400 on a bad value or an archived artefact (the existing archived-mutation
  status), 200 with the summary. `dataVisibility` rides `ArtefactSummary`.
- **Client (SPA)** — a "Saved data" section in the visibility popover, only when `usesStorage`:
  *Shared with viewers* / *Only each viewer's own*. Shown for an inherited (in-collection)
  artefact too, since the setting is per artefact.
- **MCP** — `set_data_visibility { id, dataVisibility }` (owner, active, in scope; anything else
  is not found); `get_artefact` / `list_artefacts` report `dataVisibility`. The authoring guide
  and the skill say new artefacts default to own-only.
- **Acceptance:** create → `own`; owner flips it; non-owner / archived refused; the predicate
  is false only for (`own`, non-owner or anonymous, foreign author); a legacy row reads
  `shared`; under `own` a non-owner lists only themself and 404s on another author's entry and
  frame token, while the owner reaches everyone; a foreign-context token minted under `shared`
  404s once the owner flips to `own`; the viewer's own context is unchanged.
- **Boundary:** **OSS** core, with the Postgres mirror in `ee/`.
