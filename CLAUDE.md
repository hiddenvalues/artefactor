# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: v0.2 shipped; post-v0.2 adds behaviour-preserving enabler seams

The v0.2 feature slices are **done** (S0–S7, S10–S16, S18, **S20**, **S21**; **S8/S9/S17
dropped**) — the Artefact Hosting and Artefact Data contexts, the MCP connector, and the client
UI are complete. **Post-v0.2 the DAG also defines *enabler seams*: behaviour-preserving extension
points that let a closed superset extend the core without forking it** (each ships an OSS default
that keeps OSS behaviour byte-identical). **S24** (inject persistence ports into the composition)
and **S22** (tenant scope + access-policy seams — scope-aware repo reads, the `AccessPolicy` port
deciding the one overridable `authenticated`-tier cell, and the allow-all sign-up option) are
**done**; **S19** (payload-retention seam) and **S23** (quota / payload-size / branding policies)
are **specced but not yet implemented**. **S25–S27**
(**Collections & Bookmarks**) are **done**: an owner-only nestable folder tree whose **root's**
access (all four tiers incl. `selected`) the contained artefacts **inherit at read time**
(AH20/AH21 — own tier dormant, slug minted on effective share), archive/restore/permanent-delete
**cascades**, per-user bookmarks, and the sidebar/collection-page/archive-view client UI. **S28/S29**
extend this: shared collections are **viewer-facing** for signed-in users (both-way listing, no
collection slugs) and **collaborative** — the root's access list doubles as its **contributor**
list (place-own-artefacts-only; CL12), containment is co-owned (owner may eject, CL13), and
lifecycle cascades **evict foreign artefacts instead of touching them** (CL14). Context:
`docs/specs/ddd/artefact-collections.md`. New work
either implements a pending enabler seam or adds a new slice (with its governing DDD invariant)
before coding, per the spec-driven process below.

**The whole Artefact Hosting context plus the Artefact Data store *and its localStorage
runtime + host data-context switcher* are complete** — S0, S1, S2, S3, S4, S5, S6, S7, S10,
S11 (own data blob), S12 (data-context switcher), S13 (localStorage hijack), S14, S15
(permanent delete), S16 (share with specific people), S18 (MCP connector + OAuth). The
monolith builds, runs, migrates, and tests green. Auth is
wired (`src/server/auth.ts`): email + password via BetterAuth's Drizzle adapter, session
middleware + `requireAuth` guard, protected `GET /api/me`. Artefact Hosting: Drizzle
`ArtefactRepository` (`save`/`findById`/`findBySlug`/`listByOwner`/`listShared`), the pure
access matrix (`domain/artefact/access.ts`), commands (create/edit/set-visibility/archive/
restore) under `src/server/artefacts/`, and routes `POST|GET /api/artefacts`, `GET|PATCH
/api/artefacts/:id` (+`/:id/raw`), `PUT /api/artefacts/:id/visibility`, `POST
/api/artefacts/:id/archive|restore`, `GET /api/shared`, `GET /a/:slug` (+ `/a/:slug/frame`).
Artefact Data
(`src/domain/data/`, `src/server/data/`): the `DataEntry` aggregate (opaque ≤5 MB JSON blob,
one per `(artefact, author)`), a Drizzle data repo, and `GET|PUT|DELETE
/api/artefacts/:ref/data/me` (`:ref` = slug **or** id, access-matrix gated), plus the S12
switcher reads `GET /api/artefacts/:ref/data/authors` + `GET …/data/:authorId` (access-matrix
gated, **not** auth-gated — anonymous may read a `public` artefact's data). The S13 runtime
(`src/server/runtime/`) injects a seeded `localStorage` shim into both serving paths so
artefacts persist with zero code changes (owner preview writes back via the id alias). S12
serves `/a/:slug` as a host **shell** (toolbar + `<iframe>`) wrapping the artefact at
`/a/:slug/frame` (`?author=<id>` re-seeds another author's blob read-only). Shared port
adapters in `src/server/adapters.ts`. **Programmatic access (S18)** is a remote **MCP server**:
`POST /mcp` (Streamable HTTP via `@hono/mcp`, stateless JSON responses) guarded by an OAuth
bearer (BetterAuth's `mcp` plugin — discovery at `/.well-known/oauth-*`, dynamic client
registration, authorize/consent/token under `/api/auth/mcp/*`, OIDC tables
`oauth_application|oauth_access_token|oauth_consent`). Tools in `src/server/mcp/` wrap the
existing Hosting commands (create/update/list/get/set-visibility/archive/restore), each
attributed to the token's Account. Because connector-only clients (e.g. Claude design) **can't
load the `artefactor` Agent Skill**, the connector self-describes its authoring contract: the
MCP server's `instructions` carry a compact persistence summary (ambient, present before any
tool call) and a `get_authoring_guide` tool returns the full `skills/artefactor/SKILL.md` body
on demand (the Dockerfile copies `skills/` into the runtime image for this). The short summary
in `src/server/mcp/authoring-guide.ts` and the skill are kept in sync (same no-drift rule). **Data blobs stay opaque** — there is no data-write tool
and no merge-patch (a backend merge would break opacity); `get_artefact`/`update_artefact`
return `dataAuthorCount` so a breaking HTML change can be flagged, and the artefact owns its
own data-shape compatibility (versioned localStorage keys). The old **S8/S9** (API-key REST
push) and **S17** (data merge-patch) are **dropped**. See `docs/specs/fdd/slice-dag.md`.

**The client UI (Svelte SPA, `src/client`) is built and is the human-facing app** — not a stub.
It provides: sign-in; a dashboard of your owned / "shared with you" / archived artefacts
(grouped by kind, searchable, filterable by access); the **manual HTML upload** dialog
(`lib/components/UploadModal.svelte` — drag-drop or pick a **single `.html` file**, set title +
kind; the same dialog edits an existing artefact by replacing its HTML); the S12 data-context
switcher; manage-access (`ManageAccessModal.svelte`); and archive / restore / permanent-delete
(`ConfirmDialog.svelte`). **This manual upload is "Path B" for publishing** — the supported way
to get an artefact that embeds **raster images** into Artefactor, because the MCP connector
("Path A") cannot carry base64 image bytes through a tool call. Both paths run the same
create/edit commands, so invariants are identical. (See the two-path guidance in
`skills/artefactor/SKILL.md` and the MCP `instructions`.)

Development is **spec-driven**: locate the governing
DDD invariant and FDD slice before coding, build test-first, and keep spec ↔ tests ↔ code in
sync in the same change.

### Architecture at a glance

- **Monolith**: one Hono process (`src/server`) serves the BFF API (`/api`, `/health`) and
  the built Svelte SPA (`dist/client`, with SPA fallback). Entry `src/server/index.ts`.
- **Pure domain layer** (`src/domain`) — aggregates + invariants, **no framework imports**;
  defines repository/store **ports**. This is the primary TDD surface (tested against
  in-memory repos). Adapters live in `src/infra` (Drizzle in `db/`, filesystem payloads in
  `storage/`). The server is the composition root wiring routes → domain → adapters.
- **Client** (`src/client`) is a Vite + Svelte 5 SPA; shared BFF contracts in `src/shared`.

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
- `docs/specs/fdd/slice-dag.md` — the feature slice DAG (S0–S18; S8/S9/S17 dropped) and per-slice acceptance
  criteria (the seeds for TDD tests) with build order. `s0-scaffold.md` has the full S0 spec.

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

# Identity (S1): regenerate BetterAuth's Drizzle tables after changing src/server/auth.ts
# (e.g. the mcp/OIDC plugin tables added in S18), then re-run db:generate to emit the migration.
pnpm dlx @better-auth/cli generate --config src/server/auth.ts --output src/infra/db/auth-schema.ts
```

**Native deps:** pnpm 11 blocks dependency build scripts. After a fresh `pnpm install`, run
**`pnpm approve-builds --all`** to compile `better-sqlite3` (no prebuilt for Node 26 — builds
from source; needs `python3`/`make`/`g++`). The Dockerfile does this automatically. The project
pins **Node 26.4.0** (`.nvmrc`); use it for every command so the native addon's ABI matches.

**Docker:** multi-stage `Dockerfile` builds a single image; `docker-entrypoint.sh` runs
migrations then starts the server. Mount a volume at `/data` (SQLite DB + artefact payloads).
