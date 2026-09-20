# Artefactor

Artefactor hosts and serves **trusted HTML artefacts** produced by [claude.ai](https://claude.ai)
and Claude design — UX/UI prototypes, slide decks, forms, and interactive documents — and
gives them **server-side persistence for free** by transparently hijacking `localStorage`.

Upload a self-contained HTML file (or push one from Claude over the MCP connector), share it
privately, with signed-in users, or publicly by link, and any data the artefact saves is
persisted per-user on the backend with no changes to the artefact's code.

## Status

Usable, still pre-1.0. Hosting and sharing, collections, per-user artefact data, the MCP
connector and card thumbnails are in place; artefacts are served in a sandboxed frame. What is
built, in progress or still specced lives in the slice DAG —
[`docs/specs/fdd/slice-dag.md`](docs/specs/fdd/slice-dag.md) and the context files it catalogues
— which is the single, test-enforced source of truth for status.

## Highlights

- **Trusted-HTML hosting** with three visibility tiers: `private`, `authenticated`
  (any signed-in user), and `public` (anyone with the link).
- **Zero-change persistence** — Artefactor replaces `localStorage` with a backend-backed,
  per-user store, seeded server-side so reads stay synchronous. Artefacts just use the
  standard `localStorage` API.
- **Two ingestion paths** — manual upload and the MCP connector (OAuth-authenticated, so Claude
  publishes and updates artefacts directly) — enforcing identical domain invariants.
- **Collections** — an owner-only nestable folder tree whose root's access the artefacts inside
  it inherit, with per-user bookmarks and an archive that cascades.
- **Card thumbnails** — a rendered preview per artefact for the dashboard and gallery, produced
  by an isolated renderer container that runs the uploader's JavaScript far from the app.
- **Single deployable monolith** — one Hono process serves the API and the Svelte SPA.

## Tech stack

| Layer | Choice |
| ------- | -------- |
| Backend / BFF | [Hono](https://hono.dev/) on Node |
| Frontend | [Svelte 5](https://svelte.dev/) (Vite SPA) |
| Design system | [shadcn-svelte](https://www.shadcn-svelte.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| ORM / DB | [Drizzle](https://orm.drizzle.team/) over SQLite (`better-sqlite3`) |
| Auth | [BetterAuth](https://www.better-auth.com/) (Google OAuth in production; email+password in dev/test only) |
| Deploy | Docker monolith on a [Coolify](https://coolify.io/)-managed VPS |

## How it's built

Development is **spec-driven**:

- **DDD** (Domain-Driven Design) defines the model — aggregates, invariants, business logic.
- **FDD** (Feature-Driven Design) slices that model into a dependency DAG; slices are built
  in topological order.
- **TDD** — every slice is built test-first; spec, tests, and implementation are kept in sync.

The specs are the source of truth and live in [`docs/specs/`](docs/specs/). Start with
[`docs/specs/README.md`](docs/specs/README.md).

## Quick start

Requires Node **26.4.0** (pinned in [`.nvmrc`](.nvmrc)) and pnpm 11+. Use that version for every
command: `better-sqlite3` is a native addon compiled from source against the Node you install
with, and a different Node then refuses to load it (ABI mismatch).

```bash
pnpm install
pnpm approve-builds --all     # compile better-sqlite3 (native; pnpm blocks build scripts by default)
pnpm db:migrate               # create the SQLite schema
pnpm dev                      # Vite (5173) + Hono (3000); open http://localhost:5173
```

Other commands:

```bash
pnpm test                     # unit tests (Vitest)
pnpm check                    # type-check (svelte-check + tsc)
pnpm build && pnpm start      # production build, then run the bundled server
```

## Project layout

```text
src/
  domain/     pure domain model — aggregates, invariants, ports (no framework imports)
  infra/      adapters: Drizzle/SQLite (db/), filesystem payload store (storage/), rendering (render/)
  server/     Hono BFF — composition root, env, routes, artefact serving, MCP connector
  renderer/   the isolated thumbnail renderer — a separate role from the same image
  client/     Svelte SPA + Tailwind + shadcn-svelte components
  shared/     contracts shared between the BFF and the client
deploy/       Compose example, seccomp profile and egress rules for the two-container deployment
docs/specs/   DDD + FDD specifications (source of truth)
skills/       Agent Skill teaching Claude to author artefacts that persist correctly
```

## Docker

```bash
docker build -t artefactor .
docker run -p 3000:3000 -v artefactor-data:/data artefactor
```

The image runs migrations on boot and serves on `:3000`. Mount a volume at `/data` — it holds
the SQLite database, the artefact payloads and their thumbnails (the entire state of the
monolith). The image declares no `VOLUME`, so the mount is yours to name.

Card **thumbnails** are rendered by a second container from the same image
(`ARTEFACTOR_ROLE=renderer`): it screenshots artefact HTML in sandboxed Chromium, holds no
secrets or storage, and is thrown away after every job. Run the pair with
[`deploy/docker-compose.example.yml`](deploy/docker-compose.example.yml) and read
[`docs/renderer-isolation.md`](docs/renderer-isolation.md) first — it is a security boundary, not
a convenience. Without `ARTEFACTOR_RENDERER_URL` the app never renders anything and cards show a
kind placeholder.

## License

[MIT](LICENSE.md) © Hidden Value AB
