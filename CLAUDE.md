# CLAUDE.md

**Where work stands:** slice status and dependencies live in the slice DAG — the catalog
[`docs/specs/fdd/slice-dag.md`](docs/specs/fdd/slice-dag.md) and the per-context files it lists
under `docs/specs/fdd/slices/` — the single, test-enforced source of truth (`pnpm spec:dag`
prints the graph, the next build waves and the next free slice id). In-flight work lives in
**Linear**. This file holds only what's true between slices.

## Architecture at a glance

Orientation only: what each part is and where its code lives. The **specs own the detail** —
routes, invariants, mechanics — so every bullet that a spec governs ends with a link to it (paths
under [`docs/specs/`](docs/specs/): `ddd/` for the domain model, `fdd/slices/` for the slices);
read that spec before changing anything in the area. The first three bullets describe the repo's
shape rather than a bounded context, so no spec governs them.

- **Monolith**: one Hono process (`src/server`) serves the BFF API (`/api`, `/health`), the
  artefact serving routes (`/a/*`), the MCP server (`/mcp`) and the built React SPA
  (`dist/client`, with SPA fallback). Entry `src/server/index.ts`.
- **Pure domain layer** (`src/domain`) — aggregates + invariants, **no framework imports**;
  defines repository/store **ports**. The primary TDD surface (tested against in-memory repos).
  Adapters live in `src/infra` (Drizzle in `db/`, filesystem payloads in `storage/`); the server
  is the composition root wiring routes → domain → adapters.
- **Client** (`src/client`) is a Vite + React SPA on stock shadcn/ui; shared BFF contracts in
  `src/shared`, colour tokens in `src/client/app.css`, guarded by `pnpm lint`.
  → [`fdd/slices/platform.md`](docs/specs/fdd/slices/platform.md)
- **Composition + enabler seams.** `createApp` takes the adapters (`src/server/adapters.ts`, the
  OSS default), BetterAuth and the tenancy/access/organization seams as injected dependencies, so
  a closed superset extends the core without forking it.
  → [`fdd/slices/platform.md`](docs/specs/fdd/slices/platform.md)
- **Identity & Access** (`src/server/auth.ts`) — BetterAuth; its user id *is* the `ownerId`.
  → [`ddd/identity-access.md`](docs/specs/ddd/identity-access.md),
  [`fdd/slices/identity-access.md`](docs/specs/fdd/slices/identity-access.md)
- **Artefact Hosting** (`src/domain/artefact/`, `src/server/artefacts/`) — the core context: the
  `Artefact` aggregate, the access matrix and the `/api/artefacts` routes.
  → [`ddd/artefact-hosting.md`](docs/specs/ddd/artefact-hosting.md),
  [`fdd/slices/artefact-hosting.md`](docs/specs/fdd/slices/artefact-hosting.md)
- **Artefact Collections** — an owner's nestable folder tree, under `/api/collections`.
  → [`ddd/artefact-collections.md`](docs/specs/ddd/artefact-collections.md),
  [`fdd/slices/artefact-collections.md`](docs/specs/fdd/slices/artefact-collections.md)
- **Artefact Data** (`src/domain/data/`, `src/server/data/`) — one opaque JSON blob per
  `(artefact, author)`, under `/api/artefacts/:ref/data/*`.
  → [`ddd/artefact-data.md`](docs/specs/ddd/artefact-data.md),
  [`fdd/slices/artefact-data.md`](docs/specs/fdd/slices/artefact-data.md)
- **Artefact Views** — who has viewed an artefact, surfaced in the serving shell.
  → [`ddd/artefact-views.md`](docs/specs/ddd/artefact-views.md),
  [`fdd/slices/artefact-views.md`](docs/specs/fdd/slices/artefact-views.md)
- **Serving runtime** (`src/server/runtime/`) — `/a/:slug`: a host shell around a sandboxed,
  cookieless `<iframe>` with a seeded `localStorage` shim.
  → [`ddd/artefact-hosting.md`](docs/specs/ddd/artefact-hosting.md),
  [`ddd/artefact-data.md`](docs/specs/ddd/artefact-data.md)
- **Artefact thumbnails** (`src/server/thumbnails/`, `src/infra/render/`, `src/renderer/`) — a
  derived WebP per artefact, rendered by an isolated renderer role (`ARTEFACTOR_ROLE=renderer`).
  → [`ddd/artefact-hosting.md`](docs/specs/ddd/artefact-hosting.md),
  [`docs/renderer-isolation.md`](docs/renderer-isolation.md)
- **MCP connector** (`src/server/mcp/`) — `POST /mcp` behind BetterAuth OAuth; its tools wrap the
  Hosting and Data commands. `src/server/mcp/authoring-guide.ts` mirrors
  `skills/artefactor/SKILL.md`.
  → [`ddd/mcp-connector.md`](docs/specs/ddd/mcp-connector.md),
  [`fdd/slices/mcp-connector.md`](docs/specs/fdd/slices/mcp-connector.md)
- **Deployment export** (`src/infra/export/`) — `pnpm export:bundle` writes the deployment as a
  verifiable export bundle; `readBundle` is the format's single definition.
  → [`ddd/deployment-export.md`](docs/specs/ddd/deployment-export.md),
  [`fdd/slices/platform.md`](docs/specs/fdd/slices/platform.md)
- **Two publishing paths** — the MCP connector (no raster image bytes) and the manual HTML upload
  dialog; both run the same commands.
  → [`skills/artefactor/SKILL.md`](skills/artefactor/SKILL.md)

## What this is

**Artefactor** is a web app that serves HTML artefacts produced by claude.ai and Claude
design — UX/UI prototypes, slide decks, forms, interactive documents, and similar
self-contained HTML deliverables. It hosts these artefacts and presents them through the
app.

## Specifications (read these first)

The domain and build plan live in `docs/specs/` and are the **source of truth**:

- `docs/specs/ddd/` — domain model: the ubiquitous language, and one file per bounded
  context with its aggregates and invariants.
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
- **Auth:** delegated to **BetterAuth** via its Drizzle adapter. Both **email + password** and
  **Google OAuth** exist; which are enabled is **deployment configuration**
  (`AUTH_EMAIL_PASSWORD`, the Google credentials), with **at least one required in production**
  (IA7, S38). Account **creation** is gated by `AUTH_ALLOW_SIGNUP` beside the domain allowlist —
  defaulting to closed exactly when production has the unverified email+password path open.
  Programmatic access is the **MCP connector**
  (S18), authenticated by **OAuth** via `@better-auth/mcp` — there is **no API-key
  credential** (better-auth core ships no api-key plugin; S8/S9 dropped). The domain treats
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
  its tests must always agree. A spec states each checkable rule as an `r[<id>]` requirement
  marker; a test cites it with `// r[verify <id>]`, the one site that decides it with
  `// r[impl <id>]`, and `pnpm test` fails when they drift (`docs/specs/README.md`
  *Requirements*).

Practical implication for any change: locate the governing DDD spec and FDD slice first.
If a change would alter behavior, the spec and tests change together with the code — never
let them drift. If no spec covers the work, write/extend the spec before coding.

## Tech stack

- **Backend:** [Hono](https://hono.dev/) acting as a **Backend-for-Frontend (BFF)** — the
  backend tailors APIs to the frontend's needs rather than exposing a generic API.
- **Frontend:** [React](https://react.dev/).
- **Design system:** [shadcn/ui](https://ui.shadcn.com/) components with
  [Tailwind CSS](https://tailwindcss.com/) for styling.
- **Persistence:** [Drizzle ORM](https://orm.drizzle.team/) over **SQLite**.
- **Deployment:** single **monolith** in a **Docker** container, deployed to a
  [Coolify](https://coolify.io/)-managed VPS.

## Architecture intent

- One deployable monolith: Hono serves both the BFF endpoints and the React SPA.
- The BFF layer is the only thing the React SPA talks to; it shapes responses for
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
- **Reading code:** read in parts, never whole files — `grep -n` first, then `sed -n 'a,bp'` or
  `Read` with `offset`/`limit`; never `cat` several files at once. Send "how does area X work"
  questions to an Explore subagent. Change a file with `Edit`, not a whole-file `Write`. Read a
  requirement with `pnpm spec:req <id>`, not its spec file.

## Commands

```bash
pnpm dev                       # Vite (5273) + Hono (3000) together; Vite proxies /api,/health,/a/
pnpm dev:seed [--reset]        # local demo DB: demo@example.com + maya@example.com, password artefactor-demo
pnpm dev:local                 # pnpm dev behind portless: https://[<branch>.]artefactor.localhost, any free ports
pnpm build                     # build:client (Vite → dist/client) + build:server (esbuild → dist/server)
pnpm start                     # run the built server: node dist/server/index.js
pnpm test                      # Vitest (domain unit tests)
pnpm test:unit                 # every test but the browser suites (*.browser.test.ts) — CI's `unit` job
pnpm test:browser              # only the *.browser.test.ts suites (real headless Chromium) — CI's `browser` job
pnpm test <file> -t "name"     # run a single test by name
pnpm check                     # tsc --noEmit (client, then server) — type safety
pnpm lint                      # ESLint over src/client: no inline styles, raw colours, palette classes, direct Radix or raw controls (S43, S49a, S49b); CI gate
pnpm db:generate               # drizzle-kit: generate a migration from src/infra/db/schema.ts
pnpm db:migrate                # apply migrations (tsx src/infra/db/migrate.ts)
pnpm db:studio                 # drizzle studio
pnpm export:bundle --out <dir>  # write the deployment's export bundle (S39); --verify <dir> checks one
pnpm spec:dag [catalog]        # slice DAG → mermaid graph + build waves + next free id (default: core catalog)
pnpm spec:trace [--untraced]   # requirement traceability report (coverage, verify/impl sites, stale refs); exits 1 on an error
pnpm spec:bump [--editorial <id>]  # bump changed requirements (+N → +N+1) and rewrite docs/specs/requirements.lock
pnpm spec:req [--refs] <id>…   # print requirements (version, file:line, body; --refs: verify/impl sites) without opening the spec
pnpm lint:md                   # markdownlint-cli2 over every tracked .md (.markdownlint-cli2.jsonc); CI gate
pnpm lint:md:fix               # apply markdownlint's auto-fixes (over-long prose lines still rewrap by hand)
pnpm quiet -- <command…>       # run a command, log its output, print a ≤3 KB summary; keeps its exit code
pnpm dev:renderer              # the isolated thumbnail renderer (S37), long-lived for local work
pnpm exec playwright-core install chromium-headless-shell  # once, for the renderer + its browser tests

# Identity (S1): regenerate BetterAuth's Drizzle tables after changing src/server/auth.ts
# (e.g. the OAuth-provider tables of S18/S63), then re-run db:generate to emit the migration.
pnpm dlx @better-auth/cli generate --config src/server/auth.ts --output src/infra/db/auth-schema.ts
```

**Quiet output:** a tool result stays in an agent session's context for every later call, so
run gates (`pnpm test`, `check`, `lint`, `spec:trace`, `build`) and large fetches (CI job logs)
as `pnpm quiet -- <command…>`. On `exit=0` read nothing more. On a non-zero exit, `grep -n` the
printed log for the failing check, then `sed -n` that range — never `cat` the log. Don't add
`--summary-only` to a gate; it hides the tail a red run needs. Don't pipe it into `head` or
`tail` either: the output is already short, and the pipe's exit code replaces the command's, so a
red gate passes an `&&` chain. Flags: `src/dev/quiet.ts`.

**Native deps:** pnpm 11 blocks dependency build scripts. After a fresh `pnpm install`, run
**`pnpm approve-builds --all`** to compile `better-sqlite3` (no prebuilt for Node 26 — builds
from source; needs `python3`/`make`/`g++`). The Dockerfile does this automatically. The project
pins **Node 26** to an exact version in `.nvmrc`; use it for every command so the native addon's
ABI matches.

**Docker:** multi-stage `Dockerfile` builds a single image with two roles, chosen by
`ARTEFACTOR_ROLE` in `docker-entrypoint.sh`: `app` (the default — migrations, then the server) and
`renderer` (the isolated thumbnail renderer: no chown, no migrations, no `gosu`, refuses to run as
root). The image declares **no** `VOLUME`, so mount an explicit volume at `/data` (SQLite DB +
artefact payloads + thumbnails). `deploy/docker-compose.example.yml` runs both roles;
`docs/renderer-isolation.md` is the operator's guide.
