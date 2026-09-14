# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Where work stands:** slice status and dependencies live in the slice DAG — the catalog
[`docs/specs/fdd/slice-dag.md`](docs/specs/fdd/slice-dag.md) and the per-context files it lists
under `docs/specs/fdd/slices/` — the single, test-enforced source of truth (`pnpm spec:dag`
prints the graph, the next build waves and the next free slice id). In-flight work lives in
**Linear**. This file holds only what's true between slices.

## Architecture at a glance

- **Monolith**: one Hono process (`src/server`) serves the BFF API (`/api`, `/health`), the
  artefact serving routes (`/a/*`), the MCP server (`/mcp`) and the built Svelte SPA
  (`dist/client`, with SPA fallback). Entry `src/server/index.ts`.
- **Pure domain layer** (`src/domain`) — aggregates + invariants, **no framework imports**;
  defines repository/store **ports**. This is the primary TDD surface (tested against
  in-memory repos). Adapters live in `src/infra` (Drizzle in `db/`, filesystem payloads in
  `storage/`). The server is the composition root wiring routes → domain → adapters.
- **Client** (`src/client`) is a Vite + Svelte 5 SPA; shared BFF contracts in `src/shared`.
- **Composition + enabler seams.** `createApp` takes the persistence adapter set
  (`src/server/adapters.ts` is the OSS default: SQLite + filesystem) and the BetterAuth instance
  as injected dependencies, plus a `TenantScopeResolver` and an `AccessPolicy`. These are
  **enabler seams**: behaviour-preserving extension points that let a closed superset extend
  the core without forking it, each wired with an OSS default that keeps OSS behaviour
  byte-identical. The access matrix (`domain/artefact/access.ts`) stays single-sourced; the
  policy decides only its one overridable cell (a signed-in non-owner on the `authenticated`
  tier).
- **Identity** (`src/server/auth.ts`) — BetterAuth via its Drizzle adapter: Google OAuth in
  production, email + password in dev/test only, a sign-up email-domain allowlist (with a `*`
  allow-all option), session middleware + the `requireAuth` guard, protected `GET /api/me`, and
  an `Origin` / `Sec-Fetch-Site` check refusing cross-origin state changes under `/api` (IA6;
  `/api/auth/*` is BetterAuth's own).
- **Artefact Hosting** (`src/domain/artefact/`, `src/server/artefacts/`) — the `Artefact`
  aggregate, a Drizzle `ArtefactRepository`, the pure access matrix, and commands for
  create / edit / set-visibility / manage access list / archive / restore / permanent delete.
  Routes: `POST|GET /api/artefacts`, `GET|PATCH|DELETE /api/artefacts/:id` (+ `/:id/raw` owner
  preview), `PUT …/:id/visibility`, `GET|POST|DELETE …/:id/access(/:userId)`,
  `POST …/:id/archive|restore`, `PUT …/:id/collection`, `PUT|DELETE …/:id/bookmark`,
  `GET /api/shared`, `GET /api/users/search`, and the export `GET /api/artefacts/:ref/download`
  (the **stored** payload verbatim — no bootstrap, no shell — so download → edit → re-upload
  round-trips).
- **Artefact Collections** (`docs/specs/ddd/artefact-collections.md`) — an owner-only nestable
  folder tree whose **root's** access the contained artefacts inherit at read time; the root's
  access list doubles as its contributor list. Archive / restore / permanent delete cascade and
  evict foreign artefacts rather than touching them. Per-user bookmarks. Routes under
  `/api/collections` and `GET /api/shared/collections`.
- **Artefact Data** (`src/domain/data/`, `src/server/data/`) — the `DataEntry` aggregate: an
  opaque ≤ 5 MB JSON blob, one per `(artefact, author)`, stamped on every write with the
  payload hash it was authored against (advisory). `GET|PUT|DELETE /api/artefacts/:ref/data/me`
  (`:ref` = slug **or** id, access-matrix gated; `PUT` optionally pinned with
  `If-Match` / `If-None-Match: *` → 412), plus `GET …/data/authors` and `GET …/data/:authorId`,
  which are access-matrix gated but **not** auth-gated (anonymous may read a `public`
  artefact's data). `GET /api/artefacts/:ref/viewers` lists who has viewed.
- **Artefact thumbnails** (`src/server/thumbnails/`, `src/infra/render/`, `src/renderer/`) — a
  derived 512×320 WebP per artefact for the dashboard and gallery cards, rendered from the stored
  payload alone (no bootstrap, no shell, no data) at a synthetic origin, through an **in-process
  queue**: create / HTML replace enqueue after the save and a startup sweep backfills, and a
  render is recorded only by a compare-and-set against the current payload hash. Files live
  beside the payloads (`ARTEFACTOR_THUMBNAIL_DIR`); `GET /api/artefacts/:ref/thumbnail` is
  signed-in only and resolves like the download. Because a render runs the uploader's JavaScript,
  Chromium never runs in the app: `src/renderer/` is a **separate role from the same image**
  (`ARTEFACTOR_ROLE=renderer`) — its own entry point and env, no secrets, DB or storage, sandbox
  **on**, one job per container, egress-restricted — and the app talks to it over HTTP
  (`ARTEFACTOR_RENDERER_URL`, `HttpThumbnailRenderer`), never rendering payloads over
  `MAX_RENDER_INPUT_BYTES` (10 MB). With the URL unset every card keeps its kind placeholder and
  nothing else changes (AH25/AH29; `docs/renderer-isolation.md`, `deploy/`).
- **Serving runtime** (`src/server/runtime/`) — `/a/:slug` is a server-rendered host **shell**
  (toolbar: data-context switcher, viewers, conflict banner) wrapping the artefact in a
  **sandboxed, opaque-origin** `<iframe>` (no `allow-same-origin`; the frame responses carry the
  same flags as a `sandbox` CSP). Frames (`/a/:slug/frame`, `/api/artefacts/:id/raw/frame`,
  `routes/frame.ts`) never read cookies: they are opened with a short-lived HMAC **frame token**
  (`?t=`, viewer + author + route) that the shell render embeds and
  `POST /api/artefacts/:ref/frame-token` re-mints (author switch, reload, expiry), and they
  re-check access at every redeem. Both serving paths inject a seeded `localStorage` shim, so
  artefacts persist with zero code changes; the shim **posts each change to the shell**, which
  saves it under the viewer's session — writing only on change, pinned, never overlapping, and on
  a 412 it stops and offers a reload, so an open tab can neither block nor silently revert another
  writer. Optional `ARTEFACTOR_CONTENT_ORIGIN` serves frames from a separate registrable domain
  that answers nothing else.
- **MCP connector** (`src/server/mcp/`) — `POST /mcp` (Streamable HTTP via `@hono/mcp`,
  stateless JSON responses) behind an OAuth bearer from BetterAuth's `mcp` plugin (discovery at
  `/.well-known/oauth-*`, dynamic client registration, authorize / consent / token under
  `/api/auth/mcp/*`, OIDC tables `oauth_application|oauth_access_token|oauth_consent`). Tools
  wrap the Hosting and Data commands, each attributed to the token's Account:
  `create_artefact`, `update_artefact`, `list_artefacts`, `get_artefact`, `set_visibility`,
  `archive_artefact`, `restore_artefact`, the read-backs `get_artefact_html` and
  `get_artefact_data` (the caller's **own** blob verbatim + the declared schema + the
  `currentPayloadVersion` / `authoredAgainstVersion` pin), the write `set_artefact_data`, and
  `get_authoring_guide`. Read-backs hard-error above a context cap (~1 MB HTML / 256 KB blob)
  instead of truncating, pointing at the GUI download. Because connector-only clients (e.g.
  Claude design) **can't load the `artefactor` Agent Skill**, the server's `instructions` carry
  a compact persistence summary (ambient, before any tool call) and `get_authoring_guide`
  returns the full `skills/artefactor/SKILL.md` body (the Dockerfile copies `skills/` into the
  runtime image). `src/server/mcp/authoring-guide.ts` and the skill are kept in sync.
- **Data blobs stay opaque — no merge-patch.** A backend merge would have to parse the blob,
  breaking opacity. The server parses only to enforce the size/JSON bound. Agents edit data by
  **read-modify-write**: `get_artefact_data`, transform **agent-side**, write the **whole** blob
  back with `set_artefact_data` through the same `putOwnDataEntry` as `PUT …/data/me`, only to
  the caller's own entry, optionally pinned (`if_unmodified_since` → `DataConflict`).
  `get_artefact` / `update_artefact` return `dataAuthorCount` so a breaking HTML change can be
  flagged; the artefact owns its data-shape compatibility (versioned `localStorage` keys + a
  forward migration shipped in its own HTML, and a declared data schema in
  `<script type="application/artefactor-schema+json">`).
- **Two publishing paths.** *Path A* — the MCP connector pushes HTML; it cannot carry base64
  raster image bytes through a tool call. *Path B* — the **manual HTML upload** dialog in the
  client (`lib/components/UploadModal.svelte`: drag-drop or pick a single `.html` file, title +
  kind; the same dialog replaces an existing artefact's HTML) — is the supported way to publish
  an artefact that embeds raster images. Both run the same create/edit commands, so invariants
  are identical. (See `skills/artefactor/SKILL.md` and the MCP `instructions`.)
- **Client UI** (`src/client`) is the human-facing app, not a stub: sign-in; a dashboard of
  owned / "shared with you" / archived artefacts (grouped by kind, searchable, filterable by
  access); a collections sidebar, collection pages and an archive view; manual upload;
  manage-access (`ManageAccessModal.svelte`); archive / restore / permanent delete
  (`ConfirmDialog.svelte`); "Download HTML" in an owned artefact's `MoreMenu`.

## What this is

**Artefactor** is a web app that serves HTML artefacts produced by claude.ai and Claude
design — UX/UI prototypes, slide decks, forms, interactive documents, and similar
self-contained HTML deliverables. It hosts these artefacts and presents them through the
app.

## Specifications (read these first)

The domain and build plan live in `docs/specs/` and are the **source of truth**:

- `docs/specs/ddd/` — domain model: ubiquitous language, the **Identity & Access**,
  **Artefact Hosting**, and **Artefact Data** bounded contexts, with aggregates and
  invariants.
- `docs/specs/fdd/slice-dag.md` — the feature slice DAG's catalog, listing one file per context
  under `docs/specs/fdd/slices/` with every slice's status, dependencies and acceptance criteria
  (the seeds for TDD tests). `s0-scaffold.md` has the full S0 spec.

`skills/artefactor/SKILL.md` is an Agent Skill for the **authoring + publishing** side
(claude.ai / Claude design) — it teaches Claude both to **publish/update/share** artefacts via
the S18 MCP connector and to **write artefacts that persist correctly** via Artefactor's
localStorage hijack. It mirrors the runtime contract in `docs/specs/ddd/artefact-data.md` and
the connector tool surface in `src/server/mcp/`; **keep them in sync** (same no-drift rule as
specs).

Before any change, locate the governing DDD invariant and FDD slice. Keep spec ↔ tests ↔
code in sync in the same commit.

### Locked product decisions (v0.2)

- **Tenancy:** multi-user; login required.
- **Auth:** delegated to **BetterAuth** via its Drizzle adapter. **Email + password during
  development**, **Google OAuth added later**. Programmatic access is the **MCP connector**
  (S18), authenticated by **OAuth** via BetterAuth's `mcp` plugin — there is **no API-key
  credential** (the pinned better-auth has no api-key plugin; S8/S9 dropped). The domain treats
  the BetterAuth user id as `ownerId` — no hand-rolled user/session aggregate.
- **Ingestion:** manual HTML upload (authenticated UI) **and** the **MCP connector**
  (OAuth-authenticated, S18); both enforce identical invariants.
- **Artefacts are trusted HTML:** served as-is, no sanitization/script-stripping. Payload
  cap **100 MB**, stored on the **filesystem** (SQLite row holds a reference + size + hash,
  never the inline blob).
- **Visibility (3 tiers):** `private` (owner) | `authenticated` (any signed-in user) |
  `public` (anyone). Sharing mints a unique slug; the slug is **retained** when set back to
  private (link 404s while private). Unauthenticated access is **by slug link only** — the
  "Shared with you" view is signed-in users only.
- **Kind:** metadata only; drives grouping when browsing.
- **Slug:** short random URL-safe token, collision-checked at mint.
- **Backend store:** per-`(artefact, author)` **opaque** JSON blob, **single upsert** (cap
  **5 MB**; artefact owns the shape, backend doesn't interpret it). Writes require auth and
  only to your own blob — **no anonymous writes**. On serve, Artefactor **hijacks
  `localStorage`** (seeded server-side, write-through) so artefacts persist with **zero code
  changes**. The artefact sees **one opaque dataset** — no `ARTEFACTOR` helper. Viewing
  another user's data is a **host UI** feature (user-picker re-seeds the artefact read-only),
  outside the artefact container. See `docs/specs/ddd/artefact-data.md`.
- **Versioning:** none — single mutable payload, edited in place.
- **Lifecycle:** soft-delete via **archive/restore**; an **archived** artefact can then be
  **permanently deleted** (owner-only, confirmed in the UI) — removing its row, payload file,
  and data entries. Active artefacts must be archived first.

## Development process

The process is layered and spec-driven. Specs are the source of truth and are kept in
sync with implementation and tests at all times.

- **DDD (Domain-Driven Design)** — defines the domain model: aggregates, entities, value
  objects, invariants, and business logic. This is the *what* and the *rules*.
- **FDD (Feature-Driven Design)** — implementation is driven by features, where each
  feature is a vertical slice of the DDD model. Features are organized as a **DAG**:
  a feature depends on the features (slices) it builds on, and is only started once its
  dependencies are in place. Build order follows the DAG topologically.
  The DAG is a catalog, `docs/specs/fdd/slice-dag.md` (a context table + the high-water mark per
  id prefix), and one context file per context under `docs/specs/fdd/slices/` holding the
  slices. In a context file, each `### <id> — <title>` slice heading is followed, after one blank
  line, by a metadata block —

  ```markdown
  ### S31 — Agent edits data: `set_artefact_data` MCP tool

  - **Status:** done
  - **Depends on:** S11, S18, S30
  - **Optional:** S19a
  - **Linear:** ALI-268
  ```

  `Status` is `specced | in progress | done | dropped`; `Depends on` lists hard edges (bare ids,
  `—` for none); `Optional` (non-blocking edges) and `Linear` may be omitted. The drift test
  `src/specs/slice-dag.test.ts` (part of `pnpm test`) fails on a missing or invalid block, an
  unknown or dropped dependency, a cycle, a `done`/`in progress` slice with an unfinished
  dependency, a catalog that disagrees with its context files or high-water marks, or slice
  status creeping back into this file. `pnpm spec:dag` prints the graph, the parallel build
  waves and the next free id; a new slice takes that id and bumps the mark (a sub-lettered
  split such as `S19a` keeps its number and the mark), then joins its context's Slices cell
  (details: `docs/specs/README.md`).
- **TDD (Test-Driven Development)** — every slice is built test-first. Unit tests encode
  the invariants and business logic from the DDD spec. A spec, its implementation, and
  its tests must always agree.

Practical implication for any change: locate the governing DDD spec and FDD slice first.
If a change would alter behavior, the spec and tests change together with the code — never
let them drift. If no spec covers the work, write/extend the spec before coding.

## Tech stack

- **Backend:** [Hono](https://hono.dev/) acting as a **Backend-for-Frontend (BFF)** — the
  backend tailors APIs to the frontend's needs rather than exposing a generic API.
- **Frontend:** [Svelte](https://svelte.dev/).
- **Design system:** [shadcn-svelte](https://www.shadcn-svelte.com/) components with
  [Tailwind CSS](https://tailwindcss.com/) for styling.
- **Persistence:** [Drizzle ORM](https://orm.drizzle.team/) over **SQLite**.
- **Deployment:** single **monolith** in a **Docker** container, deployed to a
  [Coolify](https://coolify.io/)-managed VPS.

## Architecture intent

- One deployable monolith: Hono serves both the BFF endpoints and the Svelte frontend.
- The BFF layer is the only thing the Svelte frontend talks to; it shapes responses for
  the UI and keeps domain logic server-side.
- Domain logic (aggregates, invariants) lives behind the BFF, not in the frontend.
- Drizzle/SQLite is the persistence boundary for the domain; keep schema changes tied to
  domain/spec changes.
- Artefacts are HTML deliverables served by the app — treat their storage, addressing,
  and rendering as a core domain concern to be specified in the DDD work.

## Conventions for working in this repo

- Specs first. Before implementing, confirm the DDD aggregate/invariants and the FDD slice
  that govern the work.
- Keep spec ↔ tests ↔ implementation in sync in the same change.
- Respect the FDD DAG: don't build a slice before its dependency slices exist.
- `CLAUDE.md` holds only what's true between slices: product, architecture, locked decisions,
  process and commands. A change edits it only for an architecture fact or a locked-decision
  reversal — slice status belongs in the slice DAG (`docs/specs/fdd/`), in-flight work in Linear.
- **Slice naming:** in all human-facing text a session writes (chat, Linear, PR titles and
  bodies, commit messages), refer to a slice by its **full title** — e.g. "S31 — Agent edits
  data: `set_artefact_data` MCP tool", never "S31". The machine-parsed metadata fields and catalog
  cells keep bare ids.

## Commands

```bash
pnpm dev                       # Vite (5173) + Hono (3000) together; Vite proxies /api,/health
pnpm build                     # build:client (Vite → dist/client) + build:server (esbuild → dist/server)
pnpm start                     # run the built server: node dist/server/index.js
pnpm test                      # Vitest (domain unit tests)
pnpm test <file> -t "name"     # run a single test by name
pnpm check                     # svelte-check + tsc --noEmit (server) — type safety
pnpm db:generate               # drizzle-kit: generate a migration from src/infra/db/schema.ts
pnpm db:migrate                # apply migrations (tsx src/infra/db/migrate.ts)
pnpm db:studio                 # drizzle studio
pnpm spec:dag [catalog]        # slice DAG → mermaid graph + build waves + next free id (default: core catalog)
pnpm lint:md                   # markdownlint-cli2 over every tracked .md (.markdownlint-cli2.jsonc); CI gate
pnpm lint:md:fix               # apply markdownlint's auto-fixes (over-long prose lines still rewrap by hand)
pnpm dev:renderer              # the isolated thumbnail renderer (S37), long-lived for local work
pnpm exec playwright-core install chromium-headless-shell  # once, for the renderer + its browser tests

# Identity (S1): regenerate BetterAuth's Drizzle tables after changing src/server/auth.ts
# (e.g. the mcp/OIDC plugin tables added in S18), then re-run db:generate to emit the migration.
pnpm dlx @better-auth/cli generate --config src/server/auth.ts --output src/infra/db/auth-schema.ts
```

**Native deps:** pnpm 11 blocks dependency build scripts. After a fresh `pnpm install`, run
**`pnpm approve-builds --all`** to compile `better-sqlite3` (no prebuilt for Node 26 — builds
from source; needs `python3`/`make`/`g++`). The Dockerfile does this automatically. The project
pins **Node 26.4.0** (`.nvmrc`); use it for every command so the native addon's ABI matches.

**Docker:** multi-stage `Dockerfile` builds a single image with two roles, chosen by
`ARTEFACTOR_ROLE` in `docker-entrypoint.sh`: `app` (the default — migrations, then the server) and
`renderer` (the isolated thumbnail renderer: no chown, no migrations, no `gosu`, refuses to run as
root). The image declares **no** `VOLUME`, so mount an explicit volume at `/data` (SQLite DB +
artefact payloads + thumbnails). `deploy/docker-compose.example.yml` runs both roles;
`docs/renderer-isolation.md` is the operator's guide.
