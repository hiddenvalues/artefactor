# Artefactor

Artefactor hosts and serves **trusted HTML artefacts** produced by [claude.ai](https://claude.ai)
and Claude design — UX/UI prototypes, slide decks, forms, and interactive documents — and
gives them **server-side persistence for free** by transparently hijacking `localStorage`.

Upload a self-contained HTML file (or push one via the API), share it privately, with signed-in
users, or publicly by link, and any data the artefact saves is persisted per-user on the
backend with no changes to the artefact's code.

## Status

Early development. **S0 (project scaffold) is complete** — the monolith builds, runs,
migrates, and tests green. Feature slices (auth, artefact CRUD, sharing, the data store) are
built next, test-first, per the spec.

## Highlights

- **Trusted-HTML hosting** with three visibility tiers: `private`, `authenticated`
  (any signed-in user), and `public` (anyone with the link).
- **Zero-change persistence** — Artefactor replaces `localStorage` with a backend-backed,
  per-user store, seeded server-side so reads stay synchronous. Artefacts just use the
  standard `localStorage` API.
- **Two ingestion paths** — manual upload and authenticated API push — enforcing identical
  domain invariants.
- **Single deployable monolith** — one Hono process serves the API and the Svelte SPA.

## Tech stack

| Layer | Choice |
| ------- | -------- |
| Backend / BFF | [Hono](https://hono.dev/) on Node |
| Frontend | [Svelte 5](https://svelte.dev/) (Vite SPA) |
| Design system | [shadcn-svelte](https://www.shadcn-svelte.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| ORM / DB | [Drizzle](https://orm.drizzle.team/) over SQLite (`better-sqlite3`) |
| Auth | [BetterAuth](https://www.better-auth.com/) (email+password in dev, Google OAuth later) |
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

Requires Node 24+ and pnpm 11+.

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
  infra/      adapters: Drizzle/SQLite (db/), filesystem payload store (storage/)
  server/     Hono BFF — composition root, env, routes, static serving
  client/     Svelte SPA + Tailwind + shadcn-svelte components
  shared/     contracts shared between the BFF and the client
docs/specs/   DDD + FDD specifications (source of truth)
skills/       Agent Skill teaching Claude to author artefacts that persist correctly
```

## Docker

```bash
docker build -t artefactor .
docker run -p 3000:3000 -v artefactor-data:/data artefactor
```

The image runs migrations on boot and serves on `:3000`. Mount a volume at `/data` — it holds
the SQLite database and artefact payloads (the entire state of the monolith).

## License

[MIT](LICENSE.md) © Hidden Value AB
