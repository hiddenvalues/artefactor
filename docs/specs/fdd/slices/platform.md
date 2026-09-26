# Platform & enabler seams

## Slices

### S0 — Scaffold

- **Status:** done
- **Depends on:** —

*Prerequisite, not a domain slice.*

Monolith builds and runs: Hono serves the Svelte app; Drizzle connected to SQLite with
migrations; Tailwind + shadcn-svelte wired; pure `domain/` layer + Vitest harness; Docker
image builds and runs locally. **Full detail: [`s0-scaffold.md`](../s0-scaffold.md).**

### S22 — Tenant scope + access-policy seam

- **Status:** done
- **Depends on:** S6, S10, S14

*Enabler; behaviour-preserving.*

Two thin core seams that let a superset be **multi-tenant**, byte-identical in OSS. (DDD amendments:
`ddd/artefact-hosting.md` AH17/AH18, `ddd/identity-access.md` IA5. EE context:
`ee/docs/specs/ddd/tenancy.md`.)
> **Progress:** **done — A1 + A2 + B + C.** A1 — `Artefact.tenantId` + the `tenant_id` column
> (both schemas,
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

### S23 — EE enforcement policy seams (quota / payload-size / branding)

- **Status:** specced
- **Depends on:** S2, S3, S12

*Enabler; behaviour-preserving.*

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

### S24 — Inject persistence ports into the composition

- **Status:** done
- **Depends on:** S2, S11, S12, S21

*Enabler; behaviour-preserving.*

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

### S39 — Deployment export bundle

- **Status:** done
- **Depends on:** S1, S2, S11, S16, S21, S25, S27, S32a, S41
- **Linear:** ALI-351

An operator command that writes a whole deployment's state as one self-describing, versioned
**export bundle** — Accounts (identity only, never credentials), every artefact with its payload,
access lists, collections and their tree, data entries, views and bookmarks, with slugs,
visibility and link gates intact. Read-only against the source, taken from one consistent
snapshot, and verifiable. It is a self-host backup/move format in its own right, and the contract
the EE importer (EM1 — Import an OSS export bundle as a cloud org) consumes — the first user being
the humlytech → `artefactor.cloud` move. **Format and invariants DX1–DX5:
[`ddd/deployment-export.md`](../../ddd/deployment-export.md).**

- **Reader** (`src/infra/export/`): zod schemas for the manifest and each record type — the
  format's single definition — and `readBundle(dir)`, which validates the whole bundle (format +
  major, schemas, counts, referential closure, payload hashes) and returns the manifest, one
  async iterator per record type and `readPayload(hash)` — each re-proving on read that the bytes
  are the verified ones (a record file or payload changed since verification throws `changed`).
  Exported for EM1, which imports in one transaction.
- **Writer** (`src/infra/export/`): `exportBundle({ sqlite, payloadStore, out })` reads every
  record in one read transaction (DX3), then copies each distinct payload under its sha256,
  hashing each artefact's file against its `payloadHash` (DX4). It writes into `<out>.partial`
  and renames to `<out>` only on success, and refuses an `out` that exists and is non-empty, or an
  existing `<out>.partial`. Everything it writes is owner-only (directories `0700`, files `0600`).
- **CLI** (`src/infra/export/cli.ts`): `pnpm export:bundle --out <dir>` exports the deployment
  named by `DATABASE_PATH` / `ARTEFACTOR_PAYLOAD_DIR` (the database opened read-only);
  `--verify <dir>` runs `readBundle` and prints the counts. Any failure exits non-zero, naming the
  failing check; `--verify` loads none of the server's configuration. `build:server` bundles it
  to `dist/server/export.js`, so an operator runs `node dist/server/export.js --out
  /data/export-…` inside the image (as the `node` user).
- **Acceptance:** exporting a seeded deployment (two Accounts, artefacts across all four
  visibility tiers incl. an archived one, a `selected` access list, a gated public artefact, a
  two-level collection tree with a root access list, data entries from two authors, views, both
  bookmark kinds) → `readBundle` returns records equal to the seed, field for field, with
  matching manifest counts; no password hash, session, verification or OAuth value appears
  anywhere in the bundle (DX2); a gated artefact's `linkGate.passwordHash` equals the stored
  scrypt hash, an ungated one's `linkGate` is `null`; the source DB file and payload directory are
  byte-identical before and after (DX1); identical HTML → one payload file named by both rows; a
  missing or altered payload fails the export with only `<out>.partial` left (DX4); a write
  committed after the snapshot opened is absent and the bundle still verifies (DX3); `readBundle`
  rejects an unknown major, a missing manifest, a schema failure, a count mismatch, a dangling
  reference and a payload that doesn't hash to its name, and accepts an unknown extra field and an
  unknown extra `.jsonl` under a known major (DX5); two exports of an unchanged deployment differ
  only in `manifest.exportedAt`; a non-empty `--out`, or an existing `<out>.partial`, is refused
  with nothing written; the bundle is owner-only even under umask `000`; `--verify` runs in
  production without the auth configuration; `--verify`
  exits 0 with the counts on a good bundle and non-zero naming the check on a tampered one.
- **Not in scope:** any importer (EM1; an OSS → OSS restore can follow without a format change),
  exporting from the Postgres adapter, an HTTP route or UI, incremental exports, encryption,
  signing or compression, and S32b's collection link-gate fields (a later `1.1`).
- **Boundary:** **OSS**.

### S43 — React client on stock shadcn/ui

- **Status:** done
- **Depends on:** S0
- **Linear:** ALI-383

A behaviour-preserving re-platform of the SPA (`src/client`) from Svelte 5 to **React** on stock
**shadcn/ui** (Tailwind v4, the default theme), so designs made in Claude design (which works in
React) land without a hand translation. It touches no domain invariant: the BFF contracts
(`src/shared`, `lib/api.ts`), the server, the domain and the serving runtime are unchanged.
"Behaviour-preserving" means the same flows, the same copy and the same persisted UI preferences;
only the look changes.

- **Behaviour suite first.** `src/client/e2e/app.browser.test.ts` drives the built client in a
  real Chromium (Vitest + `playwright-core`, the S35/S36 pattern) against the real app on a
  throwaway SQLite database. It was written and made to pass on the Svelte app before any port
  code, then passes unchanged on the React app.
- **Foundation.** `@vitejs/plugin-react` replaces the Svelte plugin; shadcn/ui components live
  under `src/client/lib/components/ui/` (`components.json`, `cn` in `lib/utils.ts`); the `$lib`
  alias, the dev proxy and port 5273 stay. `pnpm check` is `tsc` for the client and the server.
- **Tokens.** One tokens file (`src/client/app.css`): the Mint garden theme
  (`docs/design/theme/mint-garden.md`) on shadcn's CSS variables, light in `:root` and dark in
  `.dark`, plus the app-specific tokens that carry meaning — the five artefact-kind colours and
  tints and the six collection hues, in light and dark. The light kind colours mirror
  `src/shared/kind-presentation.ts`, which the server-rendered shell keeps using. S45 — App dark
  mode with a UI toggle adds the dark kind values there too, once the shell follows the theme.
- **Port.** An app shell (TopBar + Sidebar + layout) and one component per screen: `Dashboard`,
  `SharedGallery`, `CollectionPage`, `Archive`, `AuthScreen`. Menus are `DropdownMenu`, modals
  `Dialog`, the delete confirmation `AlertDialog`, the toast `Sonner`, the visibility picker
  `Popover`; icons come from `lucide-react`; auth from `better-auth/react`. Persisted UI
  preferences keep their `localStorage` keys (`artefactor:` + view/density/kind/access/sort/sidebar).
  Grid cards keep the Svelte client's hover lift (rise, scale, deeper shadow, tinted border;
  reduced motion drops the rise and scale, keeping the shadow and border); list rows stay still.
- **Guardrail.** `pnpm lint` (ESLint, CI) bans inline `style` props and raw hex/rgb/hsl colour
  literals in `src/client`; a `style` whose keys are all CSS custom properties
  (`style={{ "--hue": … }}`) is the one allowed form.

**Acceptance:** the behaviour suite passes (auth, upload + cap error, edit, visibility + share
link + copy toast, archive + undo + restore, permanent delete, collections + breadcrumb + tree
expand/collapse + archive, manage access, bookmarks, "Shared with you" in grid and list, filters
surviving a reload, grid cards lifting on hover, keyboard: Esc closes menus and dialogs, Tab
reaches controls with a visible focus ring); the lint fails on `style={{ color: "#fff" }}` and
passes on `style={{ "--hue": x }}`; `pnpm build` and `pnpm check` pass and `dist/client` carries
no Svelte runtime.

- **Boundary:** **OSS** (core client). Up-sync is held until the design system stabilizes
  (ALI-382).

### S45 — App dark mode with a UI toggle

- **Status:** in progress
- **Depends on:** S43, S36
- **Linear:** ALI-410

The app applies the Mint garden `.dark` values S43 already ships, behind a toggle, and the
server-rendered host shell (`/a/:slug`) and unlock page move onto Mint garden in light and dark.
Theme is host presentation and touches no domain invariant. The one rule it respects is the
sandboxed frame (S36): the theme lives only in the host chrome, and the frame's payload response is
byte-identical whatever the viewer's theme — an artefact renders exactly as authored.

- **Preference.** `src/client/lib/theme.ts`: `THEMES = ["light", "dark", "system"]`, a per-browser
  UI preference stored under `artefactor:theme` through `lib/prefs.ts` (the class of
  view/density/sort — never the artefact's hijacked store, never the backend); the default, and the
  fallback for an unknown value, is `system`. `resolveTheme(pref, prefersDark)` is pure.
  `useTheme()` gives `{ theme, resolved, setTheme }` from one `ThemeProvider` at the app root
  (`App.tsx`, so the auth screen follows too), which persists through `usePref`, follows
  `matchMedia("(prefers-color-scheme: dark)")` while the pref is `system`, and toggles `.dark` on
  `<html>`. `app.css` sets `color-scheme` in `:root` and `.dark`, so native controls follow.
- **No flash.** `src/shared/theme-boot.ts` exports `THEME_BOOT_JS`, one dependency-free script
  that reads `artefactor:theme` (a throw counts as `system`), resolves it against the OS and sets
  `.dark` on `<html>` synchronously, and keeps following the OS while the pref is `system`. Vite's
  `transformIndexHtml` inlines it at the top of `index.html`'s `<head>` (dev and build); the host
  shell inlines the same string in its own `<head>`. There is one copy of the resolution logic.
- **Toggle and toast.** The TopBar avatar menu has a **Theme** radio group — Light, Dark, System —
  above Sign out. The auth screen and the host shell have no toggle: they apply the stored choice,
  else the OS. The Sonner toaster takes `resolved` in place of the pinned light theme.
- **Host shell and unlock page.** `src/server/runtime/shell-theme.ts` holds the chrome's tokens as
  Mint garden values in light and dark (background, foreground, card, muted, muted-foreground,
  border, primary, primary-foreground, ring), plus shell-local `--warn-bg`/`--warn-fg`/
  `--warn-border` for the read-only badge and the conflict/expired banners. It emits a **class**
  form for the shell (`:root` + `.dark`, driven by `THEME_BOOT_JS`) and a **media** form for the
  script-free unlock page (`:root` + `@media (prefers-color-scheme: dark)`). The shell carries no
  colour literal of its own; `KindPresentation` gains `darkColor`/`darkTint` and the kind icon
  strokes with `var(--kind)`. Nothing is injected into the frame.

**Acceptance:** `resolveTheme` maps system/OS, light and dark as named, and an unknown or missing
stored value restores as `system`; the boot script, evaluated with injected globals, sets `.dark`
for stored dark, OS dark with nothing stored, and OS dark when `localStorage` throws (without
throwing), leaves it off for stored light under OS dark, and follows a media change only while the
pref is `system`; `shell-theme.ts` tokens and the dark kind values equal their `app.css`
counterparts; the rendered shell has `THEME_BOOT_JS` ahead of its `<style>`, no hex/rgb literal,
and a `var(--kind)` icon; the unlock page has a dark `@media` block and no `<script>`. In Chromium:
an OS-dark visitor with nothing stored gets `.dark` and the dark background before the bundle runs;
the avatar menu's Light/Dark/System apply, persist across a reload and (System) follow the OS live;
a toast in dark mode renders dark; `/a/:slug` with stored dark has a dark toolbar, and an anonymous
OS-dark viewer of a public link a dark shell; the frame's payload body is identical under stored
light and dark.

- **Boundary:** **OSS** (core client, shared and serving runtime). Up-sync is held until the design
  system stabilizes (ALI-382).
