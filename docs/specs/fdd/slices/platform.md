# Platform & enabler seams

## Slices

### S0 — Scaffold

- **Status:** done
- **Depends on:** —

*Prerequisite, not a domain slice.*

Monolith builds and runs: Hono serves the Svelte app; Drizzle connected to SQLite with
migrations; Tailwind + shadcn-svelte wired; pure `domain/` layer + Vitest harness; Docker
image builds and runs locally. **Full detail: [`s0-scaffold.md`](../s0-scaffold.md).**

**Acceptance** (from its definition of done):

r[platform.scaffold.health]
The `health` endpoint returns 200.

### S22 — Tenant scope + access-policy seam

- **Status:** done
- **Depends on:** S6, S10, S14
- **Delivers:** hosting.tenant.invisible-to-oss, hosting.tenant.id-fixed,
  hosting.tenant.scope-excludes-other-tenants, hosting.access.policy-decided,
  hosting.access.policy-asked-last, hosting.access.no-existence-leak, identity.signup.allow-all

*Enabler; behaviour-preserving.*

Two thin core seams that let a superset be **multi-tenant**, byte-identical in OSS. (DDD amendments:
`ddd/artefact-hosting.md` `hosting.tenant.invisible-to-oss`, `hosting.access.policy-decided`,
`ddd/identity-access.md` `identity.signup.allow-all`. EE context: `ee/docs/specs/ddd/tenancy.md`.)
> **Progress:** **done — parts A, B and C.** A, first — `Artefact.tenantId` + the `tenant_id` column
> (both schemas, migration `0006`) default to `DEFAULT_TENANT` and are stamped at create. A, second
> — `findById`, `listByOwner`, and `listShared` are now **scope-aware** (take a `TenantScope`,
> `domain/artefact/tenant-scope.ts`); `findBySlug` stays **tenant-global** because a slug is a
> globally-unique capability (`hosting.slug.globally-unique`) and the per-tier tenant check for a
> slug-served artefact is the `AccessPolicy`'s job (part B). The scope is resolved per request by an
> injected `TenantScopeResolver` (OSS default `singletonScopeResolver` → `DEFAULT_TENANT`,
> byte-identical; threaded through `createApp`/`createApiRoutes` + the artefact/data/view route
> factories + the MCP `createMcpRoutes`). A `TenantScope` is a **single** tenant (the active org),
> not an org-set: a multi-org user works within one active org per request, which also maps 1:1 onto
> the EE Postgres persistence context's RLS `SET LOCAL app.tenant_id`. Behaviour-preserving — all
> existing tests stay green; new in-memory tests prove a stub multi-tenant scope excludes
> other-tenant rows and that `findBySlug` stays cross-tenant. B — the **`AccessPolicy` port**
> (`domain/artefact/access.ts`): `ViewableArtefact` carries `tenantId`, and the matrix is factored
> so its **one policy-decided cell** — a signed-in non-owner asking for the `authenticated` tier —
> delegates to `grantsAuthenticatedTier(viewerId, tenantId)` (`canViewArtefactUnder`; the sync
> `canViewArtefact` stays the OSS default form). `hosting.lifecycle.archived-not-served`,
> `hosting.access.matrix`, `hosting.authority.owner-only` are fixed **by construction**: the policy
> is never asked about the anonymous, the owner's own view, other tiers, or archived. Injected
> through `createApp`/`createApiRoutes` (default `defaultAccessPolicy`, byte-identical) into every
> read gate that decides an `authenticated` cell: serving (`/a/:slug` shell + frame), the
> slug-resolved data/viewers reads, and the id-addressed reads inside the tenant-scoped repo —
> bookmarks, "Shared with you", collection reads (`collections.read.follows-root`) and the move into
> a contributed tree. C — the sign-up allowlist accepts the `"*"` allow-all sentinel
> (`identity.signup.allow-all`). Route-level tests (`server/access-policy.test.ts`) prove a stub
> co-member policy grants a member, denies a signed-in non-member with a flat 404
> (`hosting.access.no-existence-leak`), keeps the anonymous redirect uniform, never denies the
> owner, and leaves `public` untouched.

- **Scope.** `Artefact` gains `tenantId` (immutable; migration defaults existing + new rows to
  `DEFAULT_TENANT`). `ArtefactRepository` list/find take a **`TenantScope`**; OSS wires the
  singleton scope, so listing/serving is unchanged. Subordinate reads (data, views, versions)
  inherit the scope. *(`hosting.tenant.invisible-to-oss`)*
- **Access policy.** Extract the access-matrix decision into an **`AccessPolicy`** port; OSS wires
  the default = the current matrix. Only the `authenticated` tier is overridable;
  `hosting.access.matrix`, `hosting.authority.owner-only` are fixed.
  *(`hosting.access.policy-decided`)*
- **Identity.** The sign-up allowlist predicate gains an **allow-all** config option (OSS keeps its
  configured domains). *(`identity.signup.allow-all`)*
- **Acceptance:** under the OSS defaults, every existing access/listing/serving test passes
  unchanged (one tenant; `authenticated` = any signed-in user; allowlist as configured); a stub
  policy that scopes `authenticated` to a tenant is checked by the hosting rules it delivers; and:

r[platform.tenancy.scope-excludes-other-tenants+2]
With a stub `TenantScopeResolver` injected into `createApp` that puts the caller in another tenant,
the BFF's own list, "Shared with you" and id-addressed reads exclude the first tenant's rows
(`hosting.tenant.scope-excludes-other-tenants`).

- **Boundary:** **OSS** (the scope + policy must live in the repo/serving/access path). The org
  model, the real scope, and the org-aware policy are the **EE Tenancy/Organizations** context.

### S23 — EE enforcement policy seams (quota / payload-size / branding)

- **Status:** done
- **Depends on:** S2, S3, S12
- **Linear:** ALI-297
- **Delivers:** hosting.payload.cap-policy-decided

*Enabler; behaviour-preserving.*

The core seams the **EE Usage & Quota** context plugs into — all **no-op in OSS**. (DDD:
`ee/docs/specs/ddd/usage-quota.md`; size-cap amendment `ddd/artefact-hosting.md`
`hosting.payload.cap-policy-decided`.) The ports and their OSS defaults live in
`src/domain/artefact/enforcement.ts` as one `EnforcementPolicies` bundle, injected through
`createApp`'s trailing `enforcement` parameter (default `ossEnforcement`) into the artefact routes,
the MCP tools and the serve route. Each policy is asked with an `EnforcementContext`
(`{ ownerId, tenantId }`): the creator and the tenant the artefact is created in, or the edited
artefact's owner and tenant.

- **QuotaPolicy.** `quota.check({ ownerId, tenantId, action, bytes })` returns a verdict: `allow`,
  `warn` or `deny`. `createArtefactCommand` asks it with `action: "create"`, and
  `editArtefactCommand` with `action: "edit"` on a **payload-replacing** edit only (a title or kind
  edit asks nothing), after the size check and before the payload is stored. A `deny` throws
  `QuotaDenied` carrying its `reason`, `upgradePath` and optional `retryAfter`, so nothing is
  written; `warn` proceeds exactly like `allow`. The upload routes answer a deny with
  `402 { error: reason, upgradePath }`, or `429` with a `Retry-After` header and
  `{ error, upgradePath, retryAfter }` when the verdict carries `retryAfter`; the MCP
  `create_artefact`/`update_artefact` tools return the reason, upgrade path and retry-after as a
  tool error. OSS default = **allow**. *(the EE Usage & Quota context's quota gate)*
- **Payload-size policy.** `payloadSize.maxBytes(ctx)` is the cap, held between 1 MB and the
  100 MB ceiling by the one resolver every caller uses (`resolvePayloadCap`; a non-finite value
  reads as 100 MB). The commands resolve it and pass it to the domain factories
  (`maxPayloadBytes`); the upload routes check an uploaded file's size against it before copying
  it into a payload. An oversize payload is a `400` whose message
  names the cap (`payload exceeds the N MB cap`). **OSS default keeps 100 MB** (`DEFAULT_MAX_PAYLOAD_BYTES`).
  EE drives it from the *Large Artefacts* entitlement (10 MB / 100 MB).
  *(`hosting.payload.cap-policy-decided`)*
- **BrandingPolicy.** `branding.badgeFor({ ownerId, tenantId, artefactId })` returns a badge
  (`{ label, href }`) or `null`. The `/a/:slug` serve asks it only when the artefact's effective
  tier is `public`, whoever the viewer is, and the host shell renders the badge as a link in its
  top bar. **OSS default = no badge**. EE shows the Artefactor badge unless *Remove branding* is
  held.
- **Acceptance:** the size cap is checked by `hosting.payload.cap-policy-decided`, which it
  delivers; and:

r[platform.enforcement.oss-defaults+2]
Under the OSS defaults, creates are unlimited and no badge renders — byte-identical.

r[platform.enforcement.quota-denies-create+2]
A stub deny-quota makes `create` return `402` with its reason and upgrade path, writing nothing; the
MCP `create_artefact` tool returns them as a tool error.

r[platform.enforcement.quota-retry-after]
A stub deny verdict carrying `retryAfter` makes `create` return `429` with a matching `Retry-After`
header.

r[platform.enforcement.quota-edit-payload-only]
A stub deny-quota makes a payload-replacing edit return `402`, leaving the artefact unchanged; a
title or kind edit never consults the quota.

r[platform.enforcement.warn-proceeds]
A stub `warn` verdict proceeds exactly like `allow`: the create succeeds.

r[platform.enforcement.branding-badge-on-public+2]
A stub branding policy renders its badge on a public serve, for any viewer, and is never consulted
on a non-public serve.

- **Boundary:** **OSS** (the seams sit at the create/edit commands and the S12 shell). The metering,
  plan-aware policy, entitlements, and soft fences are the **EE Usage & Quota** context (its
  E-slices).

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
  (SQLite) wiring + default `auth`; and:

r[platform.composition.injected-adapters-serve]
A test injecting in-memory/fake adapters into `createApp` exercises the full `/a` serve surface
**without** touching `adapters.ts`/`client.ts`.

r[platform.composition.no-singleton-imports]
No route module imports the adapter or auth singleton directly anymore.

r[platform.composition.unhandled-error-reporter]
`createApp` takes an optional reporter for unhandled errors. Each error the app answers with
Hono's 500 is handed to it once, after it is logged; a save conflict's 409 and an error carrying
its own response are not. The default reports nothing, and a reporter that throws never changes
the 500. A superset hands the errors to its monitoring without editing core.

- **Boundary:** **OSS** (the composition lives in core). The Postgres adapter set, pg schema, RLS,
  and the EE entry that injects them are the EE **Postgres persistence** context. Behaviour-
  preserving; also a testability win for OSS.

### S39 — Deployment export bundle

- **Status:** done
- **Depends on:** S1, S2, S11, S16, S21, S25, S27, S32a, S41
- **Linear:** ALI-351
- **Delivers:** export.bundle.owner-only, export.format.stable-order, export.snapshot.read-only,
  export.account.no-credentials, export.snapshot.one-transaction, export.payload.writer-verifies,
  export.payload.reader-verifies, export.output.never-reused, export.format.versioned,
  export.reader.validates-bundle, export.reader.records-re-proved,
  export.reader.payload-re-proved, export.reader.opens-once, export.bundle.lossless,
  export.format.json-lines, export.format.utc-millis, export.format.null-not-omitted,
  export.format.blob-untouched, export.format.excludes-derived, export.format.archived-included,
  export.format.self-contained, export.reader.import-all-or-nothing

An operator command that writes a whole deployment's state as one self-describing, versioned
**export bundle** — Accounts (identity only, never credentials), every artefact with its payload,
access lists, collections and their tree, data entries, views and bookmarks, with slugs,
visibility and link gates intact. Read-only against the source, taken from one consistent
snapshot, and verifiable. It is a self-host backup/move format in its own right, and the contract
the EE importer (the Tenant migration context's bundle import) consumes — the first user being
the humlytech → `artefactor.cloud` move. **Format and invariants (the `export.*` requirements it
delivers): [`ddd/deployment-export.md`](../../ddd/deployment-export.md).**

- **Reader** (`src/infra/export/`): zod schemas for the manifest and each record type — the
  format's single definition — and `readBundle(dir)`, which validates the whole bundle (format +
  major, schemas, counts, referential closure, payload hashes) and returns the manifest, one
  async iterator per record type and `readPayload(hash)` — each re-proving on read that the bytes
  are the verified ones (a record file or payload changed since verification throws `changed`).
  Exported for the EE importer, which imports in one transaction.
- **Writer** (`src/infra/export/`): `exportBundle({ sqlite, payloadStore, out })` reads every
  record in one read transaction (`export.snapshot.one-transaction`), then copies each distinct
  payload under its sha256, hashing each artefact's file against its `payloadHash`
  (`export.payload.writer-verifies`). It writes into `<out>.partial`
  and renames to `<out>` only on success, and refuses an `out` that exists and is non-empty, or an
  existing `<out>.partial`. Everything it writes is owner-only (directories `0700`, files `0600`).
- **CLI** (`src/infra/export/cli.ts`): `pnpm export:bundle --out <dir>` exports the deployment
  named by `DATABASE_PATH` / `ARTEFACTOR_PAYLOAD_DIR` (the database opened read-only);
  `--verify <dir>` runs `readBundle` and prints the counts. Any failure exits non-zero, naming the
  failing check; `--verify` loads none of the server's configuration. `build:server` bundles it
  to `dist/server/export.js`, so an operator runs `node dist/server/export.js --out
  /data/export-…` inside the image (as the `node` user).
- **Acceptance:** the `export.*` requirements it delivers, as checked here: no password hash,
  session, verification or OAuth value appears anywhere in the bundle, a gated artefact's
  `linkGate.passwordHash` equals the stored scrypt hash and an ungated one's `linkGate` is `null`
  (`export.account.no-credentials`); the source DB file and payload directory are byte-identical
  before and after (`export.snapshot.read-only`); identical HTML → one payload file named by both
  rows, and a missing or altered payload fails the export with only `<out>.partial` left
  (`export.payload.writer-verifies`); a write committed after the snapshot opened is absent and the
  bundle still verifies (`export.snapshot.one-transaction`); `readBundle` rejects an unknown major,
  a missing manifest, a schema failure, a count mismatch, a dangling reference and a payload that
  doesn't hash to its name, and accepts an unknown extra field and an unknown extra `.jsonl` under
  a known major (`export.reader.validates-bundle`, `export.format.versioned`); two exports of an
  unchanged deployment differ only in `manifest.exportedAt` (`export.format.stable-order`); a
  non-empty `--out`, or an existing `<out>.partial`, is refused with nothing written
  (`export.output.never-reused`); the bundle is owner-only even under umask `000`
  (`export.bundle.owner-only`). And:

r[export.bundle.round-trips+2]
The seeded deployment — two Accounts, artefacts across all four visibility tiers incl. an archived
one, a `selected` access list, a gated public artefact, a two-level collection tree with a root
access list, data entries from two authors, views, both bookmark kinds — round-trips: `readBundle`
returns every seeded record (`export.bundle.lossless`), and the manifest's counts match the seed.

r[export.cli.verify-needs-no-config]
`--verify` runs in production without the auth configuration.

r[export.cli.exit-status]
`--verify` exits 0 with the counts on a good bundle and non-zero naming the check on a tampered
one.

- **Not in scope:** any importer (the EE Tenant migration context's; an OSS → OSS restore can
  follow without a format change), exporting from the Postgres adapter, an HTTP route or UI,
  incremental exports, encryption, signing or compression, and S32b's collection link-gate fields
  (a later `1.1`).
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
  code, then passes unchanged on the React app. Its tests run concurrently: each signs up its own
  user and opens its own browser context, so none depends on another's data or order; a test bound
  to wall-clock time runs sequentially.
- **Foundation.** `@vitejs/plugin-react` replaces the Svelte plugin; shadcn/ui components live
  under `src/client/lib/components/ui/` (`components.json`, `cn` in `lib/utils.ts`); the `$lib`
  alias, the dev proxy and port 5273 stay. `pnpm check` is `tsc` for the client and the server.
- **Tokens.** One tokens file (`src/client/app.css`): the Ruby theme
  (`docs/design/foundations/color.md`) on shadcn's CSS variables, light in `:root` and dark in
  `.dark`, plus the app-specific tokens that carry meaning — the five artefact-kind colours and
  tints and the six collection hues, in light and dark. The light kind colours mirror
  `src/shared/kind-presentation.ts`, which the server-rendered shell keeps using. S45 — App dark
  mode with a UI toggle adds the dark kind values there too, once the shell follows the theme.
  Every token pair drawn as text on a background reads at least 4.5:1 in light and dark;
  `src/shared/contrast.ts` holds the pairs and the maths.
- **Port.** An app shell (TopBar + Sidebar + layout) and one component per screen: `Dashboard`,
  `SharedGallery`, `CollectionPage`, `Archive`, `AuthScreen`. Menus are `DropdownMenu`, modals
  `Dialog`, the delete confirmation `AlertDialog`, the toast `Sonner`, the visibility picker
  `Popover`; icons come from `lucide-react`; auth from `better-auth/react`. Persisted UI
  preferences keep their `localStorage` keys (`artefactor:` + view/density/kind/access/sort/sidebar).
  Grid cards keep the Svelte client's hover lift (rise, scale, deeper shadow, tinted border;
  reduced motion drops the rise and scale, keeping the shadow and border); list rows stay still.
  The lift stays under the sticky top bar: page chrome stays above the content scrolling beneath
  it.
- **Guardrail.** `pnpm lint` (ESLint, CI) bans inline `style` props and raw hex/rgb/hsl colour
  literals in `src/client`; a `style` whose keys are all CSS custom properties
  (`style={{ "--hue": … }}`) is the one allowed form.

**Acceptance:**

r[platform.client.behaviour-suite+2]
In Chromium against the real server, `src/client/e2e/app.browser.test.ts` shows each flow: signing
in with email + password lands on Home, and signing out returns to the auth screen; an `.html` file
uploaded with a title and kind becomes a card, and a file over 100 MB shows the cap error; editing
an artefact's title and replacing its file updates the card; the card's Share switches an artefact
private → org members → public; archiving toasts Undo, lists the artefact under Archive and restores
it, and an archived artefact is deleted permanently after a confirmation; a collection is created,
an artefact filed in it, the collection opened under a breadcrumb leading back to Collections, a
child nested, the tree expanded and collapsed, and the collection archived; an artefact is
bookmarked into the sidebar and removed again; another user's members artefact shows under Home's
Shared with me, in grid and list; type, access, sort and density filters survive a reload; a hovered
grid card lifts, eased, and a list row stays still; Esc closes an open menu and an open dialog; and
Tab reaches every top-bar and card control with a visible focus indicator.

r[platform.client.card-lift-under-top-bar]
A grid card's hover lift raises it above neighbouring cards but never above the sticky top bar: a
hovered card scrolled under the bar is drawn beneath it.

r[platform.client.inline-style-lint]
The lint fails on `style={{ color: "#fff" }}` and passes on `style={{ "--hue": x }}`.

r[platform.client.no-svelte-runtime]
`pnpm build` and `pnpm check` pass and `dist/client` carries no Svelte runtime.

r[platform.theme.text-contrast]
Every token pair the app draws as text on a background has a WCAG 2 contrast ratio of at least
4.5:1, in light and in dark. A translucent background is first composited over `--background` and,
separately, over `--card`, and both results must pass. The pairs: `foreground`/`background`,
`card-foreground`/`card`, `popover-foreground`/`popover`, `primary-foreground`/`primary`,
`secondary-foreground`/`secondary`, `accent-foreground`/`accent`, `muted-foreground` on
`background`, `card`, `popover` and `muted`, `destructive` on `background`, `card` and `popover`,
`sidebar-foreground`/`sidebar`, `sidebar-primary-foreground`/`sidebar-primary`,
`sidebar-accent-foreground`/`sidebar-accent`, each `kind-*` on its `kind-*-tint`, and the host
shell's `warn-fg`/`warn-bg`.

r[platform.theme.dark-follows-data-theme]
Dark mode follows either switch on an ancestor: the `.dark` class the app sets, or
`[data-theme="dark"]`, the attribute a design-system page sets. `app.css`'s `dark` variant matches
both `.dark *` and `[data-theme="dark"] *`, and its dark token block's selector list holds both
`.dark` and `[data-theme="dark"]`. No token value differs between the two.

- **Boundary:** **OSS** (core client). Up-sync is held until the design system stabilizes
  (ALI-382).

### S45 — App dark mode with a UI toggle

- **Status:** done
- **Depends on:** S43, S36
- **Linear:** ALI-410

The app applies the `.dark` values of the app's theme (S43), behind a toggle, and the
server-rendered host shell (`/a/:slug`) and unlock page move onto that theme in light and dark.
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
  theme values in light and dark (background, foreground, card, muted, muted-foreground,
  border, primary, primary-foreground, ring), plus shell-local `--warn-bg`/`--warn-fg`/
  `--warn-border` for the read-only badge and the conflict/expired banners. It emits a **class**
  form for the shell (`:root` + `.dark`, driven by `THEME_BOOT_JS`) and a **media** form for the
  script-free unlock page (`:root` + `@media (prefers-color-scheme: dark)`). The shell carries no
  colour literal of its own; `KindPresentation` gains `darkColor`/`darkTint` and the kind icon
  strokes with `var(--kind)`. Nothing is injected into the frame, and the iframe element keeps
  `color-scheme: normal`: its used scheme is the artefact's preferred one, so the chrome's theme
  must not reach it.

**Acceptance:**

r[platform.theme.resolve]
`resolveTheme` maps system/OS, light and dark as named, and an unknown or missing stored value
restores as `system`.

r[platform.theme.boot-script]
The boot script, evaluated with injected globals, sets `.dark` for stored dark, OS dark with
nothing stored, and OS dark when `localStorage` throws (without throwing), leaves it off for
stored light under OS dark, and follows a media change only while the pref is `system`.

r[platform.theme.shell-tokens-match-app]
`shell-theme.ts` tokens and the dark kind values equal their `app.css` counterparts.

r[platform.theme.shell-markup]
The rendered shell has `THEME_BOOT_JS` ahead of its `<style>`, no hex/rgb literal, and a
`var(--kind)` icon.

r[platform.theme.unlock-page]
The unlock page has a dark `@media` block and no `<script>`.

In Chromium:

r[platform.theme.no-flash]
An OS-dark visitor with nothing stored gets `.dark` and the dark background before the bundle
runs.

r[platform.theme.menu-applies]
The avatar menu's Light/Dark/System apply, persist across a reload and (System) follow the OS
live; a toast in dark mode renders dark.

r[platform.theme.shell-follows]
`/a/:slug` with stored dark has a dark toolbar, and an anonymous OS-dark viewer of a public link a
dark shell.

r[platform.theme.frame-unthemed]
The frame's payload body is identical under stored light and dark.

- **Boundary:** **OSS** (core client, shared and serving runtime). Up-sync is held until the design
  system stabilizes (ALI-382).

### S46 — Top bar: global search, tabs move out

- **Status:** done
- **Depends on:** S43, S14, S28
- **Linear:** ALI-411

The designer's top-bar hand-back (`docs/design/components/top-bar.md`): the "Your artefacts" /
"Shared with you" tabs leave the top bar, and its search becomes global — one field that finds any
artefact or collection the viewer can see, from any page, in a results dropdown. Host UI only; it
adds no invariant, endpoint or query. Search reads only what the shell already loads: own active
artefacts and collections, others' effectively shared artefacts (S14 — Shared with you,
`hosting.access.matrix`) and shared collection trees (S28 — Shared collections are viewer-facing
(read-only), `collections.read.follows-root`), so a result is never something the viewer couldn't
already open, and archived items never match.

- **Model.** `src/client/lib/search.ts` (pure): `searchLibrary({ owned, shared, collections,
  sharedCollections, collectionById }, query)` → `{ collections, artefacts }` hits, matched by
  `matchesQuery` (case-insensitive title substring), each group most recently updated first and
  capped at 3 collections and 5 artefacts; a blank query gives empty groups. A hit's `meta` is
  where it lives — an own artefact's collection name, else "Your artefacts"; an own collection's
  parent name, else "Your collections" — or "Shared by" plus the owner's name for another user's.
  `highlight(title, query)` splits the first match out as `[before, match, after]`.
- **Top bar.** Sidebar toggle · logo · search · spacer · New artefact · account menu; `view`,
  `onGoDashboard`, `onGoGallery` and `searchPlaceholder` go, `results` and `onOpenResult` arrive,
  and the placeholder is fixed: "Search artefacts and collections…". The dropdown is a `Popover`
  anchored to the field that keeps focus in the input: **Collections** then **Artefacts** rows
  (hue swatch or kind icon, the match bold, `meta`), the first row highlighted, footer key hints,
  and "No matches for “…”" in a `role="status"` when nothing matches. ↑/↓ move the highlight
  across both groups, clamped at the ends; Enter opens it; Esc closes and keeps the text; the ×
  button empties the field, which closes the dropdown. The search sits in `role="search"`; the
  input is a `combobox` (`aria-expanded`, `aria-controls`, `aria-activedescendant`) over a
  `listbox` of `option`s with `aria-selected` on the highlighted one. On narrow screens the search
  shrinks first. The rest of the narrow layout is S80's (S80 — Account menu as its own
  component, and a top bar that fits narrow screens).
- **Shell.** `AppShell` passes `searchLibrary(lib, query)` to the top bar. Opening an artefact hit
  opens it in a new tab — the owner-preview URL for your own, `/a/:slug` for another's — and a
  collection hit opens its page; the query clears either way, and on any navigation. The query no
  longer filters page grids: `Filters` has no `query`, and the kind, access and sort filters are
  unchanged.
- **Interim Sidebar entry.** Until the landing page re-homes the two views, the Sidebar has a
  **Shared with you** item under Home, active on the `gallery` view, which stays restorable across
  reloads.

**Acceptance:**

r[platform.search.library-hits]
`searchLibrary` returns empty groups for a blank query; matches case-insensitively across all four
sources, capping 4 + 7 matches at 3 + 5, newest first; and gives each `meta` as above.

r[platform.search.highlight]
`highlight("Roadmap draft", "map")` is `["Road", "map", " draft"]`, and a miss is
`["Roadmap draft", "", ""]`.

r[platform.search.filters-ignore-text]
`applyFilters` filters by no text.

In Chromium:

r[platform.search.top-bar-dropdown+2]
Typing part of another user's shared title on the Dashboard opens the dropdown with it under
Artefacts, bold and "Shared by …", leaving the grid's card count unchanged; on a collection page
an own artefact outside it is found; ↓ then Enter on a collection hit shows its page and closes
the dropdown; Esc closes and keeps the text, × empties and closes; a nonsense query shows the
`role="status"` message; exactly one option is `aria-selected`; the top bar has no tab controls
and Tab reaches the search between the logo and New artefact.

r[platform.search.top-bar-previews]
The catalog preview test passes with the TopBar variants default, results and no results.

The interim criterion — the Sidebar's Shared with you opens that view in grid and list — is
superseded: S47 — Home: one landing screen for own and shared artefacts removes that entry.

- **Boundary:** **OSS** (core client). Up-sync is held until the design system stabilizes
  (ALI-382).

### S49a — Design-system lint: token colours and wrapped Radix only

- **Status:** done
- **Depends on:** S43
- **Linear:** ALI-432

Extends S43's guardrail ("colours live in one tokens file", components from stock shadcn/ui) from
colour literals to colour *class names* and to imports. It touches no domain invariant, and the
client's behaviour is unchanged: `pnpm lint` (`eslint.config.js`) gains rules, no client source
moves.

- **Palette colour utilities.** A `no-restricted-syntax` selector over `Literal` and
  `TemplateElement` values (class strings, `cn()` arguments, template literals) fails a
  colour-bearing prefix (`bg`, `text`, `text-shadow`, `border` and `border-{t,r,b,l,x,y,s,e}`,
  `ring`, `ring-offset`, `inset-ring`, `outline`, `divide`, `shadow`, `inset-shadow`,
  `drop-shadow`, `fill`, `stroke`, `from`, `via`, `to`, `decoration`, `accent`, `caret`,
  `placeholder`) followed by a palette name of the installed Tailwind (`red` … `stone`, and 4.3's
  `mauve`, `olive`, `mist`, `taupe`; `black`, `white`), with an optional shade, an optional
  opacity (`/50`, `/[.3]`) and any variant prefix (`hover:`, `dark:`…). Token utilities pass:
  `bg-primary`, `text-muted-foreground`, `ring-ring/50`, `border-border`, `text-(--kind)`,
  `from-transparent`, `bg-current`.
- **Direct Radix imports.** `no-restricted-imports` fails a static import of `radix-ui` or
  `@radix-ui/*`, and a `no-restricted-syntax` selector a dynamic `import()` of either (a string, or
  a template literal whose head names the module): the client imports the shadcn/ui wrapper from
  `$lib/components/ui/`. A CSS variable such as
  `w-(--radix-popover-trigger-width)` is a string, not an import, and stays allowed.
- **Exemptions.** Both rules skip `src/client/lib/components/ui/` — stock shadcn, which uses both —
  in a second config object that `ignores` it. S43's selectors are one shared array spread into
  both objects (a later `no-restricted-syntax` replaces the earlier options), so S43 still applies
  inside `ui/`. Tests stay ignored; the catalog chrome (`src/client/design/`) is not exempt.
- **Escape hatch.** `@eslint-community/eslint-comments/require-description` is an error and
  `linterOptions.reportUnusedDisableDirectives` is `"error"`, so an exception reads
  `// eslint-disable-next-line <rule> -- <reason>` and is visible in review.

**Acceptance:** in `src/client/lint.test.ts`,

r[platform.lint.palette-utilities]
`text-red-600`, `bg-white`, `bg-black/50`, `hover:border-slate-200`,
`cn("p-2", active && "bg-emerald-500")` and `` `ring-${x} text-zinc-900` `` fail with the palette
message, as do 4.3's hues and prefixes (`text-mauve-500`, `inset-ring-red-500`,
`text-shadow-red-500`, `drop-shadow-indigo-500`), and the token utilities above pass.

r[platform.lint.radix-imports]
`import … from "radix-ui"` and `"@radix-ui/react-dialog"`, statically or through `import()`, fail
with the Radix message and `$lib/components/ui/button` passes.

r[platform.lint.ui-exemption]
In `lib/components/ui/` `text-white` and a `radix-ui` import pass while
`style={{ color: "#fff" }}` still fails; in `src/client/design/` `bg-white` fails.

r[platform.lint.disable-needs-reason]
A disable directive without `-- reason` fails, one with a reason that silences a problem passes,
and an unused one fails.

The client as it stands has nothing to flag, and S43's cases are unchanged.

- **Boundary:** **OSS** (lint config and specs).

### S49b — Design-system lint: library controls only

- **Status:** done
- **Depends on:** S49a
- **Linear:** ALI-433

Extends S43's "components from stock shadcn/ui" and
[`docs/design/README.md`](../../../design/README.md) *Ground rules* ("Build from shadcn parts")
from a convention to a lint rule. It touches no domain invariant; the client's behaviour and look
are unchanged, and S43's behaviour suite pins that.

- **The rule.** In S49a's non-`ui/` config object, a `no-restricted-syntax` selector
  `JSXOpeningElement[name.name=/^(button|input|select|textarea|label|dialog)$/]` fails a
  hand-rolled control with *"Hand-rolled control — compose the shadcn/ui wrapper (Button, Input,
  Select, Textarea, Label, Dialog) from $lib/components/ui/, or a product component from
  $lib/components/."* Stock shadcn under `lib/components/ui/` and tests are exempt; S49a's
  disable-with-reason policy is the escape hatch. Links and content elements (`<a>`, `<table>`,
  `<img>`) stay allowed.
- **`NavRow`.** A product component (`src/client/lib/components/NavRow.tsx`) composed from
  `Button variant="ghost"`: `active`, `tone` (`sidebar` | `dialog`, picking `sidebar-accent` or
  `accent` for hover and active), children, and Button's props passed through. It keeps the old
  row look — full width, left-aligned, `px-2 py-1.5 text-sm`, rounded, truncating, `font-semibold`
  when active — resetting Button's height and centring through `cn`. `ui/button.tsx` is not edited.
  `NavRow.preview.tsx` covers default/active × sidebar/dialog.
- **Migrated sites.** The Sidebar's nav rows, Add to collection's target rows and Manage access's
  people-picker rows become `NavRow` (tones `sidebar`, `dialog`, `dialog`); the collection
  breadcrumb and an artefact item's collection chip and copy link become `Button variant="link"`,
  the tree's expand/collapse chevron `Button variant="ghost"`, and the upload's hidden file picker
  `Input`, each with its existing look kept through `className`.
- **Open surfaces.** An item's own open target — the artefact card's and row's title, the row's
  kind-icon tile, the gallery row's tile, the card thumbnail and the collection card — is a
  surface rather than a control, and Button's sizing and centring don't fit it: each keeps its raw
  `<button>` under a disable directive that says so.

**Acceptance:** in `src/client/lint.test.ts`,

r[platform.lint.library-controls]
`<button>`, `<input />`, `<select />`, `<textarea />`, `<label>` and `<dialog open />` fail with
the controls message; `<Button>`, `<Input />`, `<Label>` and `<Textarea />` pass; a raw
`<button>` in `lib/components/ui/` passes, as does one under
`eslint-disable-next-line no-restricted-syntax -- <reason>`.

The client as it stands has nothing to flag; S43's behaviour suite passes unchanged
(`platform.client.behaviour-suite`).

- **Boundary:** **OSS** (lint config, `NavRow`, the migrated sites and specs).

### S52 — Requirement traceability: stable links between spec, tests and code

- **Status:** done
- **Depends on:** S0
- **Linear:** ALI-440

Makes spec → test → code a check instead of a convention. A requirement is a line-only `r[<id>]`
marker in a spec; a test cites it with `// r[verify <id>]`, the one code site that decides it with
`// r[impl <id>]`, and `pnpm test` fails when the three drift. It touches no domain invariant.
The format, the lock, coverage and completeness are documented in
[`../../README.md`](../../README.md) *Requirements*; this slice's own acceptance criteria are its
first requirements, so the checker is traced by itself.

- **Checker** (`src/specs/trace/`, pure): parses markers from the specs, references from the
  source tree and the per-tree lock, then checks them against the registry and the slice DAG.
  `traceCheck` returns the errors and the report; `bumpRequirements` computes a bump.
- **Gates:** `src/specs/requirements.test.ts` checks the core tree alone (`pnpm test`);
  `ee/specs/requirements.test.ts` checks core and EE together (`pnpm --filter @artefactor/ee
  test`). `pnpm spec:trace` prints the report and exits non-zero on an error; `pnpm spec:bump
  [--editorial <id>]` bumps changed requirements and rewrites the lock. Each has an EE twin
  through `--filter @artefactor/ee`.
- **Lookup:** `pnpm spec:req [--refs] <query>…` prints one requirement at a time — its version,
  the `file:line` of its marker and its body, and with `--refs` its `verify` and `impl` sites —
  so a session reads a requirement without opening the spec file that defines it.
  `lookupRequirements` (`src/specs/trace/lookup.ts`) reads the markers through the checker's own
  parser; the EE twin (`pnpm --filter @artefactor/ee spec:req`) loads both trees.
- **Files:** `docs/specs/legacy-ids.md` and `docs/specs/requirements.lock`, with EE twins under
  `ee/docs/specs/`; `.gitattributes` (and `ee/.gitattributes`) mark each lock `merge=union`.
- **Not in scope:** a tracey config file, and failing on untraced tests (report-only).
- **Boundary:** **OSS** (the checker, the core gate, the core registry, legacy map and lock), with
  the EE gate, registry, legacy map and lock in `ee/`.

**Acceptance:**

r[platform.trace.marker-syntax]
A line that is exactly `r[<id>]` or `r[<id>+<N>]` (N ≥ 2; no suffix is version 1) starts a
requirement, outside a fenced code block. Its body is the lines that follow, up to the first blank
line, the next marker or a heading, so a paragraph with a directly attached list is one body.
`r[…]` anywhere else in a line is not a marker, and `r[<id>+1]` is a marker error.

r[platform.trace.id-shape]
An id is 2–4 dot-separated kebab-case segments, written as a claim
(`hosting.access.no-existence-leak`). Its first segment is a namespace registered in a catalog's
`## Requirement contexts` table, it is defined in that namespace's DDD or slice file, and it is
unique across both trees; each is an error otherwise.

r[platform.trace.lock]
Each tree's lock (`docs/specs/requirements.lock`, `ee/docs/specs/requirements.lock`) holds one
sorted `<id> <version> <sha256>` line per requirement that tree defines, hashing the body with
whitespace runs collapsed and trimmed. A body whose hash differs from the lock at the same version
is changed without a version bump; a requirement missing from the lock, a lock line for no
requirement, a version the lock disagrees with and a duplicated id line are errors naming
`pnpm spec:bump`.

r[platform.trace.scan+3]
References are read from the files a gate scans: those under `src/` and `deploy/` and the
repository root's own files (core gate), or those and `ee/` (EE gate), ending `.ts`, `.tsx`, `.js`,
`.mjs`, `.sql`, `.sh` or `.yml`, and `Dockerfile*`, skipping `node_modules/`, `dist/` and other
build output. Markers are read from every Markdown file under the tree's `docs/specs/`.

r[platform.trace.references]
`r[verify <id>]` and `r[impl <id>]`, with an optional `+<N>`, are references only inside a comment
(never a string). One naming an unknown id is broken; one naming a version other than the current
one is stale and names its `file:line`; a `verify` outside a `*.test.ts` or `*.test.tsx` file is
an error.

r[platform.trace.direction]
A core-tree file (outside `ee/`) that references or defines a requirement of an EE namespace is a
direction error; an `ee/` file may verify and implement core requirements.

r[platform.trace.coverage]
A requirement is claimed by every non-dropped slice that defines it in its own section or lists it
under `- **Delivers:**`, and the strictest claimant decides: none or `specced` requires nothing
(reported unclaimed or planned); `in progress` requires at least one current `verify` and at most
one current `impl`; `done` requires at least one current `verify` and exactly one current `impl`.
A `Delivers:` id that names no requirement is an error.

r[platform.trace.completeness]
Every registered context, with no opt-out, has no numbered list under its DDD file's
`## Invariants` headings, and every `done` or `in progress` slice in its slice file claims at least
one requirement. A `## Requirement contexts` table with a `Migrated` column is an error.

r[platform.trace.legacy-ban+2]
Every registered context's legacy ids (the `Old` cells of its `legacy-ids.md` section) appear,
word-bounded, nowhere in either tree outside the two `legacy-ids.md` files. A one-letter-prefix
id (`T`, `P`, `M`, `A`, `Q`) is matched only in Markdown, in comments and in
`it`/`describe`/`test` titles.

r[platform.trace.bump]
`pnpm spec:bump` raises the marker of every requirement whose body changed at its locked version
(`+N` → `+N+1`, in place) and rewrites the lock, leaving references stale so the check lists each
site to revisit; `--editorial <id>` records the new hash without a bump and prints the id.

r[platform.trace.report]
The report lists coverage per namespace, stale and broken references, each requirement's verify
sites and impl site, and the tests (`it`/`test` blocks) that cite no requirement. Untraced tests
are report-only and never fail a gate.

r[platform.trace.lookup]
A requirement lookup takes one or more ids, each bare, versioned or as a pasted marker or
reference. For each, it reports the current version, the file and line of its marker and its body,
delimited exactly as the checker delimits it; optionally, its `verify` and `impl` sites. An
unknown id is reported by name, and the lookup fails when any id is unknown.

r[platform.trace.placement+2]
In every registered context's DDD file, every block under an Invariants heading (any level,
up to the next heading of the same or a higher level) is a requirement body, never free prose
or a table, and every marker sits under such a heading. A context with no DDD file passes.

### S53 — Account menu shows the active organization and your role

- **Status:** done
- **Depends on:** S1, S45, S46
- **Linear:** ALI-471
- **Delivers:** identity.org-context.oss-absent, identity.org-context.switch-own-membership

The designer's account-menu hand-back (`docs/design/components/top-bar.md`, merged with S46's
search spec): the account button shows the active organization and your role in it, and the
account menu is reworked. Organizations exist only in a superset, so the context arrives through a
core seam whose OSS default is *no context* (`identity.org-context.oss-absent`), and the switch is
decided in core (`identity.org-context.switch-own-membership`). The role is read-only text; it
gives no authority, and org administration stays with ET4 — Org administration UI (host).

- **Contract.** `src/shared/contracts.ts`: `OrgRole` (`owner` | `admin` | `member`),
  `OrgMembership { id, name, role }`, `OrganizationContext { activeId, memberships }`;
  `MeResponse` gains an optional `organizations`; `SwitchOrganizationRequest { organizationId }`.
- **Seam.** `src/server/org-context.ts`: the `OrganizationContextProvider` port — `get(c)` gives
  the caller's `OrganizationContext | null`, `activate(c, id)` carries out a switch core has
  allowed — and its OSS default `noOrganizationContext` (`get` → `null`). `createApp` takes it as
  its last injected dependency, defaulting to the OSS one. `GET /api/me` adds `organizations` only
  when `get` gives a context. `POST /api/me/active-organization` (session required, behind the
  origin guard) answers 404 for no context or a non-member id, else calls `activate` and answers
  200 with a fresh `MeResponse`.
- **Account button.** With a context: avatar · active org name · role `Badge` ("Owner", "Admin",
  "Member") · chevron, labelled "Account: {org}, {role}"; below `sm` the org name hides and the
  avatar and badge stay. Without one: avatar · chevron, labelled "Account", as before.
- **Account menu.** User header (a label) · with a context, the org header (a label: org name and
  role badge) and, for two or more memberships, **Switch organization ▸** (a submenu of checkbox
  items, one per org with its role, the active one checked) · separator · **Colour theme ▸** (a
  submenu holding S45's Light / Dark / System radio group) · with a context, **Usage**, disabled
  with a "Soon" badge · separator · **Log out**, destructive (was "Sign out").
- **Switching.** Picking another org posts the switch; on 200 `AppShell` takes the response as its
  user, re-fetches the library lists and toasts "Switched to {org}", staying on the page. On
  failure nothing changes and the toast reads "Couldn't switch organization". Picking the active
  org does nothing. One switch runs at a time (a pick while one is pending is ignored), and the
  refresh starts a new library generation, so a list answered for the old org is dropped.
- **Previews.** `TopBar.preview.tsx` adds no org (OSS), Owner with one org, Member with several
  orgs (switcher open) and narrow.

**Acceptance (routes)**, in `src/server/org-context.test.ts`:

r[platform.org-context.me-organizations]
`GET /api/me` carries `organizations` only when the provider gives a context; without one it
answers exactly `{ id, email, name }`.

r[platform.org-context.switch-route]
`POST /api/me/active-organization { organizationId }` answers 200 with a fresh `MeResponse` for a
listed org, and 404 with no context, for an unlisted org or for a body without `organizationId`.

**Acceptance (client):** the account button, the account menu and the switch are specified by
S80 — Account menu as its own component, and a top bar that fits narrow screens, which carries
their rules.

The account button's and menu's previews are S80's `AccountMenu` variants, rendered in light and
dark.

- **Boundary:** **OSS** (core server seam, shared contract, client). The superset's provider is
  ET7.

### S57 — Account screen: change your name

- **Status:** done
- **Depends on:** S1, S36, S53
- **Linear:** ALI-484
- **Delivers:** identity.account.rename-self, identity.account.email-read-only

The designer's screen hand-back, Account half (`docs/design/templates/account-settings.md`): a
signed-in user sees who they are and changes their name. The domain stores no profile; the name is
BetterAuth's (`identity.account.rename-self`). Organization settings is S58.

- **Contract.** `src/shared/contracts.ts`: `UpdateMeRequest { name }`.
- **Route.** `PATCH /api/me` (session required, behind the origin guard): the body's `name` is
  trimmed; a missing or non-string name, an empty one after trimming, or one longer than 100
  characters answers 400 `{ error }` without calling BetterAuth. Otherwise it calls
  `auth.api.updateUser` for the caller's session, updates the request's own `user` to match and
  answers 200 with a fresh `MeResponse` (in a superset, carrying the organization context).
- **Account menu.** A new **Account** item, always present (OSS included), after the header rows
  and before the separator above Colour theme, opens the screen.
- **Account screen.** A new in-memory view `account` (at `/account` since S59) in `AppShell`
  (`src/client/screens/AccountScreen.tsx`), no sidebar row selected: a single column capped at
  about 40rem, title "Account", sub "Your profile.", and a **Profile** card — avatar (the top bar's
  initials fallback), name and email at the top, a **Name** field with **Save**, and the email shown
  read-only below. Below `sm` the field and Save wrap onto two lines.
- **Saving.** On 200 `AppShell` takes the response as its user and toasts "Name saved"; on failure
  the toast reads "Couldn't save your name".

**Acceptance (route)**, in `src/server/me.test.ts`:

r[platform.account.rename-route]
`PATCH /api/me { name }` takes no user id. A missing or non-string name, an empty one after
trimming, or one longer than 100 characters answers 400 `{ error }` without calling BetterAuth;
otherwise it answers 200 with a fresh `MeResponse`.

**Acceptance (client):** in Chromium, with `/api/me` and `PATCH /api/me` mocked, the Account item
opens the screen with and without an org context, showing the "Account" title, the name in the
field and the email read-only, and:

r[platform.account.save-name+2]
The Account screen's Save stays disabled until the trimmed name is not empty and differs from the
saved one. A save shows the new name in the top bar and toasts "Name saved". A failed save keeps
the typed name and changes nothing else.

- **Boundary:** **OSS** (shared contract, BFF route, client screen).

### S58 — Organization settings screen and its administration seam

- **Status:** done
- **Depends on:** S36, S53, S57
- **Linear:** ALI-485
- **Delivers:** identity.org-admin.oss-absent, identity.org-admin.active-org-only,
  identity.org-admin.owner-or-admin, identity.org-admin.invite-domain

The designer's screen hand-back, Organization settings half
(`docs/design/templates/account-settings.md`): the people in the active organization, and for an
owner or admin, renaming it, inviting people and revoking pending invitations. Organizations exist
only in a superset, so like S53 the data arrives through a core seam whose OSS default is *absent*
(`identity.org-admin.oss-absent`), and core decides which org a route acts on
(`identity.org-admin.active-org-only`), who may administer it (`identity.org-admin.owner-or-admin`)
and which addresses may be invited (`identity.org-admin.invite-domain`). The superset's provider is
ET4 — Org administration UI (host). Remove member is not built: it waits for ET8 — Org membership:
invitations, removal and domain policy.

- **Contract.** `src/shared/contracts.ts`: `OrgMember { id, name, email, role }`,
  `OrgInvitation { id, email, sentAt }`, `OrganizationSettings { id, name, owner { name, email },
  role, members, invitations?, inviteDomains? }`, `RenameOrganizationRequest { name }`,
  `InviteRequest { email }`.
- **Seam.** `src/server/org-admin.ts`: the `OrganizationAdministration` port — `read(c, orgId)`
  gives the org's name, members, pending invitations and invite domains; `rename`, `invite` and
  `revoke` (false: no such pending invitation) carry out a change core has allowed — and its OSS
  default `noOrganizationAdministration`, never called. `createApp` takes it as its last injected
  dependency, beside the organization context. Every method gets the org id core resolved.
- **Routes** (session required; the state changes behind the origin guard). Each resolves the org
  context first: none, or the default provider → 404. The org is the context's `activeId`; the
  role is the one the context lists for it.
  - `GET /api/organization` → 200 `OrganizationSettings`: the owner is the earliest-joined owner,
    members are owners first then by joined date (the provider's order within a role), and
    `invitations` and `inviteDomains` are included only for `owner`/`admin`.
  - `PATCH /api/organization { name }` → member 403; a name empty after trimming or over 100
    characters 400; else `rename`, then 200 with fresh settings.
  - `POST /api/organization/invitations { email }` → member 403; the email trimmed and lower-cased,
    then 400 `{ error: "invalid-email" | "outside-domains" }` or 409
    `{ error: "already-member" | "already-invited" }` from `admitInvite` over `read`; else `invite`,
    then 201 with fresh settings.
  - `DELETE /api/organization/invitations/:id` → member 403; `revoke` false 404; else 200 with
    fresh settings.
- **Account menu.** With an org context, **Organization settings** follows S57's Account item.
- **Organization settings screen.** A new in-memory view `organization` (at `/organization` since
  S59) in `AppShell` (`src/client/screens/OrganizationSettings.tsx`): a single column capped at
  about 48rem, title
  "Organization settings", sub the active org's name; a **General** card (owner/admin: an
  **Organization name** field with **Save**; member: a read-only Name row and the note "Only owners
  can rename the organization or invite and remove members. Ask {owner} if something needs
  changing."; both: Owner and Your role rows); and **Members · N**, with **Invite people** on the
  right, over one card of rows (`MemberList`): avatar, name ("(you)" on your own), email and role
  `Badge`, then for owner/admin each pending invitation with a "Pending" badge, the sent date and a
  revoke icon button labelled "Revoke invitation to {email}".
- **Rename.** As S57's Save name: on 200 "Organization renamed" toasts and `/api/me` is re-fetched,
  so the top bar shows the new name.
- **Invite people** (`InviteDialog`): a `Dialog` explaining that invitees get an email asking them
  to sign up and join as Members, listing the allowed domains, with one Email field; **Send
  invite** is enabled only for a valid address at an invite domain (a convenience; the server
  decides). On 201 it closes, "Invitation sent to {email}" toasts and the Pending row appears; on a
  4xx it stays open with "{email} is already a member", "{email} already has a pending invitation"
  or "Only addresses at {domains} can be invited".
- **Revoke.** No confirm: the row goes and "Invitation to {email} revoked" toasts.
- **Failures.** A failed load shows an error state with **Try again**; a failed rename, invite or
  revoke toasts "Couldn't …" and changes nothing.
- **Previews.** `MemberList.preview.tsx` (owner, member, with pending invitations, none pending,
  narrow), `InviteDialog.preview.tsx` (default, a domain error, a server refusal, narrow), and
  `AccountMenu.preview.tsx` with the menu open on Organization settings.

**Acceptance (routes)**, in `src/server/org-admin.test.ts`, with `admitInvite`'s rule in
`src/domain/identity/invite.test.ts`:

r[platform.org-settings.routes]
Every `/api/organization` route answers 404 with no org context or under the default
administration, and ignores an org id in a request body. A `member`'s `PATCH`, invitation `POST`
or invitation `DELETE` answers 403; a refused invite answers 400
`{ error: "invalid-email" | "outside-domains" }` or 409
`{ error: "already-member" | "already-invited" }`.

**Acceptance (client):** in Chromium, with `/api/me` and the organization routes mocked:

r[platform.org-settings.role-controls+2]
The Organization settings screen offers only the controls the caller's role is allowed
(`identity.org-admin.owner-or-admin`): an owner or admin sees the editable organization name,
pending invitations with their revoke buttons and Invite people — the last only when the org has
invite domains, since an empty list admits no address (`identity.org-admin.invite-domain`). A
member sees the name, owner, role and member list read-only, with no Invite people, pending rows or
revoke buttons, plus the note naming the owner. Without an org context the account menu has no
Organization settings.

r[platform.org-settings.follows-active-org+2]
Organization settings shows the active org: opened after a switch, it shows the new org's name,
role, members and owner, and a response for the previous org that arrives later is dropped.

- **Boundary:** **OSS** (core server seam, shared contract, routes, client). The superset's
  provider is ET4.

### S59 — Every screen gets a real URL

- **Status:** done
- **Depends on:** S47, S57, S58
- **Linear:** ALI-495
- **Delivers:** hosting.access.no-existence-leak

The shell's screens leave memory for the address bar: each has a path, opening one pushes a
history entry, Back and Forward move between them and a reload shows the screen in the URL. Client
navigation only — no route, contract or authority is added, and the server's SPA fallback already
serves `index.html` for every path the BFF doesn't mount.

- **Paths** (`src/client/lib/route.ts`, pure). `parsePath` and its inverse `routePath`: Home `/`,
  Archive `/archive`, Account `/account`, Organization settings `/organization`, a collection page
  `/c/<id>` (the id URI-encoded). A trailing slash is accepted; the query string and hash are
  ignored; anything else — `/c/` with no id, extra segments, an unknown path — parses to nothing.

r[platform.navigation.paths]
Each shell screen has one path: Home `/`, Archive `/archive`, Account `/account`, Organization
settings `/organization` and a collection page `/c/<id>`. A path parses to at most one screen, and
a screen's path parses back to it.

- **History** (`src/client/lib/use-route.ts`). `useRoute` reads the path on mount, `pushState`s
  on navigation and applies `popstate`. `AppShell` takes its screen from the route; its openers
  keep their side effects (filters and query reset, the sidebar's ancestors expanded) and push one
  entry each, and re-opening the current screen pushes nothing. Back and Forward apply the same
  side effects without pushing. A collection archived while it is open goes Home with
  `replaceState`, so Back doesn't return to it. Sign-out still reloads at `/`.

r[platform.navigation.history]
Opening a screen pushes one history entry. Back and Forward move between screens, and a reload
shows the screen in the URL.

- **First load and fallback.** The route is resolved once the library's first load has answered
  (and `/api/me`, for Organization settings); until then the shell shows its loading state, so a
  reload on `/c/<id>` doesn't bounce off a collection that hasn't loaded yet. `resolveRoute`
  (pure) takes the collections the caller can open — their own and shared, active — and whether
  Organization settings is offered.

r[platform.navigation.fallback-home+2]
A path that names no screen the caller can open — an unknown path, a collection they can't see,
Organization settings where it isn't offered — shows Home and replaces the URL with `/`, the same
way whatever the reason.

- **Sign-in keeps the path** (`src/client/lib/return-to.ts`). `signInReturnTo` is `?returnTo=`
  when present, otherwise the current path when it isn't `/`, both through `safeReturnTo`. The auth
  screen uses it for Google's, the magic link's and sign-up's callbacks and the email + password
  redirect.

r[platform.navigation.sign-in-keeps-path]
Signing in from a screen's path, by any method, lands back on that path.

**Acceptance:** `src/client/lib/route.test.ts` and `return-to.test.ts`; in Chromium, the URL
follows Account and a collection page across a reload, Back and Forward walk Home → collection →
Account, `/c/<unknown>` and `/organization` without an org context land on Home at `/`, `/archive`
shows the Archive, and a signed-out visitor at `/account` gets `/account` as Google's callback.

- **Boundary:** **OSS** (client only).

### S61 — Back and Forward wait for the data a screen needs

- **Status:** done
- **Depends on:** S59
- **Linear:** ALI-503

Back and Forward wait for a screen's data the way the first load does (S59). A pop onto `/c/<id>`
before the library's first load has answered, or onto `/organization` before `/api/me` has, would
otherwise fall back to Home and replace the URL with `/`, losing the history entry for want of data
rather than of access.

- **Pending route** (`src/client/lib/use-route.ts`). The first load and a pop share one pending
  route, `{ target, via: "load" | "pop" }`. `ready` decides whether a route waits: a collection page
  until the library's collections have answered, Organization settings until `/api/me` has. A
  waiting route shows the shell's *Loading…* with the URL as the browser left it, and resolves
  through `resolveRoute` — `fallback-home` included — once it is ready. The last navigation wins: a
  later pop replaces the pending route (a path that needs nothing shows at once), and an open or a
  leave clears it. A failed load still answers, so a held route never waits forever; a load
  dropped as stale by an org switch's refresh doesn't answer, the refresh does
  (`src/client/lib/use-library.ts`).

r[platform.navigation.waits-for-data]
A screen whose path needs data that hasn't answered yet — a collection page before the library's
first load, Organization settings before `/api/me` — shows the loading state and resolves once that
data answers, whether the path came from the first load or from Back and Forward. It never falls
back to Home for want of that answer.

**Acceptance:** in Chromium, with the response held, Back and Forward onto a collection show
*Loading…* and then the collection at its path; a held pop onto another user's collection lands on
Home at `/` on release; Back onto `/organization` waits for `/api/me`; opening Account while a pop
is held keeps Account; a reload on `/c/<id>` waits for the library; and an org switch during that
wait keeps it waiting for the refreshed collections.

- **Boundary:** **OSS** (client only).

### S68 — Design docs in three layers: foundations, components, templates

- **Status:** done
- **Depends on:** S43
- **Linear:** ALI-565

`docs/design/` follows the design system's own three layers, each built only from the one before
it: **foundations** (a token family and its rules), **components** (a layout, a slotted frame, is
a kind of component) and **templates** (a built screen rendered with sample data). The README
holds the layers, the loop and the hand-back kinds; the blank forms sit in `hand-back-forms/`, so
`templates/` means what it means in the design system. The foundation files describe the values
in `src/client/app.css` and point at it; they never copy one. It touches no domain invariant.

r[platform.design.docs-tree]
`docs/design/` holds `README.md`, `foundations/` (`color.md`, `typography.md`, `layout.md`,
`icons.md`), `components/`, `templates/` (one spec per built screen) and `hand-back-forms/`
(`foundation-spec.md`, `component-spec.md`, `template-spec.md`); the README's hand-back table maps
exactly the kinds foundation, component and template to those folders; there is no `theme/`,
`rules/` or `screens/`.

**Acceptance:** `src/client/design/docs.test.ts` finds the tree and the table, and every file under
`docs/design/` passes the markdown lint.

- **Boundary:** **OSS** (documentation and its test). The hand-back skills that name the folders
  (`design-handback`, `/refine`, `/implement`) are cloud-only and follow in their own commit.

### S69 — App shell as a slotted layout component

- **Status:** done
- **Depends on:** S43
- **Linear:** ALI-566

The signed-in app's frame — the full-height row with the sidebar beside a column holding the sticky
top bar and the width-capped `main` — is a layout component of its own, so it has a preview, sits in
the design catalog and the Claude design sync, and a new screen is drawn inside it rather than
rebuilt from `TopBar` and `Sidebar`.

- **Layout component** (`src/client/lib/components/AppShell.tsx`). `AppShell({ sidebar, topBar,
  children })` renders the frame's markup and classes and nothing else: no user, route, fetch or
  dialog. The `Sidebar` slot brings its own `aside` and the `TopBar` slot its own sticky `header`,
  so the frame adds no element around them. An empty `sidebar` slot (`null` or `false`) is the frame
  with the sidebar closed.
- **The app composes it** (`src/client/AppShell.tsx`, which holds the state, data and dialogs and
  renders the dialogs beside the frame): `<AppShell sidebar={…} topBar={<TopBar …/>}>{screen}</AppShell>`.
- **Preview** (`AppShell.preview.tsx`): *Slots filled* (a labelled placeholder per slot) and
  *Narrow* (no sidebar, as on a phone), in the catalog's *App* group.

r[platform.shell.layout-slots]
The signed-in app's frame is `AppShell({ sidebar, topBar, children })` under
`src/client/lib/components/`: it places its three slots — the sidebar beside a column, the top bar
first in that column above `main`, the children inside `main` — and takes no other prop;
`src/client/AppShell.tsx` composes it with `Sidebar`, `TopBar` and the current screen.

**Acceptance:** rendered with three marked slots, the sidebar slot is the frame's first child, the
top bar slot comes before `main` in the column and the children sit inside `main`; the props type
is exactly `sidebar`, `topBar`, `children`; the wrapper, the column and `main` carry the frame's
classes; `src/client/AppShell.tsx` renders the frame through the layout component, with no `main` of
its own; the browser and e2e suites pass.

- **Boundary:** **OSS** (client only); `.design-sync/` follows the catalog change (ED4).

### S70 — Built screens in the design catalog

- **Status:** done
- **Depends on:** S43, S69
- **Linear:** ALI-568

Every built screen has a preview, so the design catalog shows each one whole — the real components,
in light and dark — and the design system's Templates layer can be a copy of the repo rather than a
redrawing of it.

- **Screen previews** (`src/client/screens/<Name>.preview.tsx`): `definePreview({ title, variants })`
  beside each screen, every variant fed from `src/client/design/fixtures.ts` alone. A signed-in
  screen renders inside `AppShell` (S69) with `Sidebar` and `TopBar`, through the catalog-only
  `src/client/design/ScreenFrame.tsx`, so the card is the whole screen; a screen the app shows
  before or outside the signed-in frame (`AuthScreen`, `SetPasswordScreen`, `OAuthConsentScreen`)
  renders on its own, as the app shows it. `OrganizationSettings` is a variant of the Account
  preview, so it is listed in the registry's `SCREENS_WITHOUT_PREVIEW` with that reason.
- **The catalog** (`src/client/design/registry.ts`): `previewGroup` puts a preview under
  `src/client/screens/` in the group *Templates*, shown after *App*; a standalone page's marker is
  `<!-- @dsCard group="Templates" -->` and its id is `screen-<name>` (`screen-home`).
- **Fixtures**: an invented library across kinds and access levels, a collection tree, views, and
  an organization with members and a pending invitation, which the fixture API answers on
  `GET /api/organization` and `GET /api/config`; it echoes the account and organization screens'
  writes without keeping state, and logs a call it doesn't answer as a console error, which the
  catalog's browser suite fails on.

r[platform.design.screen-previews]
Every screen under `src/client/screens/` has a sibling `*.preview.tsx` that renders it from fixtures
as the app frames it — a signed-in screen inside `AppShell` with `Sidebar` and `TopBar` — in the
catalog group *Templates*, except a name listed with a reason in the registry's
`SCREENS_WITHOUT_PREVIEW`; a screen preview makes no network request outside the fixture API.

**Acceptance:** a screen file with no sibling preview is reported, adding the preview passes, and a
name in `SCREENS_WITHOUT_PREVIEW` is skipped with its reason; a preview under `src/client/screens/`
is grouped *Templates* while a component preview keeps its group; every screen as it stands has its
preview; in Chromium each screen preview renders, in light and in dark, with no console error and
no request outside the fixture API; the export's stylesheet stays under its 300,000-byte cap.

- **Boundary:** **OSS** (client only). Each screen preview feeds its template card (ED7), so
  `.design-sync/` follows a screen preview's variants (ED4).

### S71 — OAuth consent screen previews its states

- **Status:** done
- **Depends on:** S63, S70
- **Linear:** ALI-571

The OAuth consent screen (S63) decides its state from the signed authorize request in the address
and the provider's prelogin answer, so a catalog page, which carries no signed request, could only
show it expired. Splitting the rendering from the flow lets its preview show every state from
fixtures without faking the address, which `AuthScreen` reads too.

- **The view** (`OAuthConsentView`, exported from `src/client/screens/OAuthConsentScreen.tsx`):
  the whole page — the centred `max-w-sm` column, the large `Logo` and one `Card` — rendered from
  props alone: a `ConsentState` (`loading`, `ready` with the client's name and the redirect URI's
  host, or `expired`), the account's email, a `busy` flag and the Allow and Deny handlers. It
  lives in the screen's file, since only this screen uses it.
- **The screen keeps the flow:** `OAuthConsentScreen` keeps the signed-query check, the prelogin
  call, the `/oauth2/consent` POST and the `busy` flag, and renders the view. Its behaviour in the
  app is unchanged, so `identity.mcp.consent-required` still holds: no state reaches Allow without
  the provider verifying the request.
- **The preview** (`OAuthConsentScreen.preview.tsx`) renders the view inside `PageFrame` from the
  fixtures' `viewer` and `consentRequest`, in three variants: Ready, Loading and Request expired.

r[platform.design.consent-preview-states]
The OAuth consent screen renders from its state alone: Loading shows "Loading…" and no button;
Ready names the client, the account's email and the redirect URI's host, with Allow above Deny,
both disabled while an answer posts; Expired has no Allow. Its preview shows Ready, Loading and
Request expired, in that order, from fixtures, with no signed query in the address.

**Acceptance:** the view renders Ready with the client, the email, the host and the grant, Allow
before Deny and neither disabled; Ready while busy disables both; Loading has "Loading…" and no
button; Expired has its heading and **Go to Home** and no Allow; in Chromium the consent screen's
preview page shows Ready, Loading and Request expired in that order, its Ready variant with an
enabled Allow.

- **Boundary:** **OSS** (client), plus the `.design-sync/` adapter for the screen's template card,
  whose variants change.

### S77 — Logo: the gem jar mark, a narrow form and an optional link

- **Status:** done
- **Depends on:** S43, S45, S49b
- **Linear:** ALI-618

The designer handed back the Logo component (`docs/design/components/logo.md`): the brand mark is
the gem jar, the top bar's logo narrows to its tile on small screens, and a screen can make the
whole logo one link to a destination it chooses. The logo decides nothing about where it goes, so
it is a product component that is a function of its props.

- **The mark** (`src/client/lib/components/Logo.tsx`): the gem jar, a 32×32 `viewBox` drawn only in
  `currentColor`, `aria-hidden`, on the `rounded-md bg-primary text-primary-foreground` tile. `md`
  is a size-7 tile, size-4 icon and `text-[15px]` name; `lg` a size-8 tile, size-4.5 icon and
  `text-lg` name.
- **The narrow form:** only `md`, the top bar's size, hides its name, while the top bar it sits in
  (`@container/top-bar`) is narrower than `sm` (40rem). The bar's own width decides, not the
  viewport's, since the sidebar can sit beside it. Outside a top bar the `md` name stays hidden.
  The hand-back's variant table narrows every logo, but its acceptance asks for no change on the
  auth screens but the mark, so `lg` always shows the name.
- **The destination:** `href`, `label` (the link's accessible name, "Artefactor" when unset) and
  `onNavigate`. A plain primary click calls `onNavigate` in place of the browser's navigation, so a
  client-side router can take it; a modified or middle click keeps the browser's default, so a new
  tab works. No screen passes a destination yet: the top bar's link to Home is the Top bar
  hand-back's.
- **The catalog** (`Logo.preview.tsx`): wide `md` as a link, wide `lg`, narrow `md` and not a
  link. Each `md` cell sits in a top-bar container, 40rem wide or (narrow) 20rem.
- **Non-text contrast** (`src/shared/contrast.ts`): `NON_TEXT_PAIRS` lists the token pairs drawn as
  shapes, rated by the same maths as the text pairs against `MIN_NON_TEXT_CONTRAST`.

r[platform.client.logo-link]
`Logo` given an `href` renders one `<a href>` named by its `label`, wrapping the mark and the name.
A plain click calls `onNavigate` instead of following it, and a modified or middle click keeps the
browser's default. Without an `href` it renders a non-focusable `role="img"` named "Artefactor".
The mark is `aria-hidden` either way.

r[platform.client.logo-narrow+2]
At `size="md"` the name "Artefactor" is hidden, with no gap left, unless the enclosing
`@container/top-bar` is at least `sm` (40rem) wide, and the accessible name doesn't change. At
`size="lg"` the name always shows.

r[platform.theme.non-text-contrast]
Every non-text token pair (`primary-foreground` on `primary`, `primary` on `background`) has a
WCAG 2 contrast ratio of at least 3:1, in light and in dark.

**Acceptance:** the plain logo is one `role="img"` named "Artefactor" with nothing focusable; with
`href` and `label` it is exactly one link so named, holding the tile and the name, ringed 3px in
`ring/50` on keyboard focus; a plain click on it calls `onNavigate` once and is default-prevented,
while a ⌘, Ctrl, Shift, Alt or middle click is neither; the `md` name carries the hidden class,
shown from the top bar's `sm` with its gap, and the logo no gap class, the `lg` name no hidden
class; `md` is a size-7 tile, size-4 icon and `text-[15px]` name, `lg` size-8, size-4.5 and
`text-lg`; every `NON_TEXT_PAIRS` pair is at least 3:1 in light and in dark, and a `primary` equal
to `background` fails the check.

**Out of scope:** the top bar's link to Home and the rest of its narrow layout beyond the logo's
own narrow form (the Top bar hand-back), the
Gemjar colour themes, the favicon, app icon and share images, the logo in emails or exports, and
any menu, tooltip or animation on the logo.

- **Boundary:** **OSS** (client), plus the `.design-sync/` adapter for the Logo card, whose
  variants change (ED4).

### S80 — Account menu as its own component, and a top bar that fits narrow screens

- **Status:** done
- **Depends on:** S53, S57, S58, S77
- **Linear:** ALI-616

The designer handed back two components that share one surface: the Account menu
(`docs/design/components/account-menu.md`) and a revised Top bar
(`docs/design/components/top-bar.md`). The account menu becomes a product component, the top bar
narrows to fit small screens with an organization context, its logo links to Home, and switching
organization lands on Home. No domain rule moves: the switch keeps S53's seam
(`identity.org-context.switch-own-membership`), OSS stays org-free
(`identity.org-context.oss-absent`), and the role stays read-only.

- **`AccountMenu`** (`src/client/lib/components/AccountMenu.tsx`): renders from the `user` it is
  given (`name`, `email`, optional `organizations`) and reports actions through
  `onSwitchOrganization(id)`, `onOpenAccount()`, `onOpenOrganization()` and `onSignOut()`; the
  theme stays with `useTheme()`. Two variants: **default**, an outline h-9 button with the size-6
  avatar, the active org's name (one line, truncated at `max-w-40`), a secondary role badge and a
  chevron (avatar and chevron only without an org context); **avatar**, a round ghost icon button
  holding the size-8 avatar. Both are named, by `aria-label` and `title`, "Account: {org}, {role}"
  with an org context and "Account" without one. `ROLE_LABEL` lives here.
- **The menu, in order:** the user label row (avatar, name falling back to email, muted email) ·
  with an org context, the org label row (name and role badge) · "Switch organization" (two or more
  memberships) · "Account" · "Organization settings" (org context only) · separator · "Colour
  theme" (Light / Dark / System) · separator · "Log out" (destructive). There is no Usage item
  until metering exists.
- **`TopBar`** mounts `AccountMenu`: the default variant at or above the bar's `sm`
  (`@min-[40rem]/top-bar`), the avatar variant below it. Only one is displayed, so the account
  button is one tab stop. The logo is `<Logo href={routePath(HOME)} label="Artefactor, go to Home"
  onNavigate={onGoHome} />`, which narrows to its tile below the bar's `sm` (S77); the row's gap and
  padding follow the bar's `sm` too. Tab order: sidebar toggle → logo → search → New artefact →
  account button.
- **Switching lands on Home.** On a successful switch `AppShell` takes the response as its user,
  goes to Home (a history entry), toasts "Switched to {org}", re-fetches the lists and moves focus
  to Home's main heading (`<h1>Home</h1>`, `tabIndex={-1}`). A failed switch stays on the page,
  toasts "Couldn’t switch organization" and moves focus to the account button. After a switch pick
  the closing menu leaves focus alone and the shell places it once the switch settles, reaching
  the displayed account button through `TopBar`'s `accountRef`. It does so only if focus is still
  where the pick left it (the page, an open menu or the account button). The page you were on
  belonged to the previous organization, so it isn't kept.
- **Previews.** `AccountMenu.preview.tsx`: owner of one organization, several organizations
  (switcher open), a 40-character organization name, the avatar variant, no organization (OSS) and
  the menu open. `TopBar.preview.tsx`: the search states, signed in wide, signed in narrow with an
  organization, and no organization.

**Acceptance (client):** in Chromium, with `/api/me` and the switch route mocked, and in
`src/client/lib/components/AccountMenu.test.ts`:

r[platform.top-bar.org-and-role+2]
With an org context the account button is named, by `aria-label` and `title`, "Account: {org},
{role}" ("Hidden Value", "Owner"; a member's badge reads "Member"); without one it is named
"Account". At or above `sm` it shows the avatar, the org name truncated at 10rem (`max-w-40`), the
role badge and a chevron; below `sm` it is a round icon button showing only the avatar, under the
same name. Exactly one account button is displayed.

r[platform.top-bar.switch-organization+3]
"Switch organization" appears only for two or more memberships, as a submenu listing each org with
its role, only the active one `aria-checked="true"`. Picking the other org switches it: the button
shows the new org and role, "Switched to {org}" toasts, the library lists are re-fetched, Home is
shown at Home's path and focus moves to its "Home" heading without passing through the account
button, however late the answer comes. A failed switch stays on the page, keeps the button, moves
focus to it and toasts the error. Picking the active org sends nothing.

r[platform.top-bar.account-menu+2]
The menu holds, in order, the user label row, the org label row, Switch organization, Account,
Organization settings, a separator, Colour theme, a separator and Log out, with no Usage item; the
header rows are labels (ArrowDown from the open menu lands on the first item). Without an org
context there is no org row, switcher or Organization settings. Colour theme is a submenu of three
`menuitemradio`s that applies and persists the theme; Log out signs out. Enter on the button opens
the menu on its first item, → opens a submenu and ← closes it, and Esc closes the menu with focus
back on the button.

r[platform.top-bar.logo-home]
The top bar's logo is one link named "Artefactor, go to Home" to Home's path. A plain click shows
Home without a full page load; a modified click keeps the browser's default.

r[platform.top-bar.narrow-fit+2]
At 390px and 480px, and at 640px and 660px with the sidebar open, with an organization context and
without, the top bar's row doesn't overflow (`scrollWidth` ≤ `clientWidth`), and the sidebar
toggle, the logo tile, New artefact and the account button are visible. Tab runs sidebar toggle →
logo → search → New artefact → account button.

The catalog preview test renders the `AccountMenu` and `TopBar` variants above, in light and dark.

**Out of scope:** the signed-out state (the Sign in button and the signed-out top bar, ALI-678),
the Usage item, changing roles or organizations, and the search and sidebar.

- **Boundary:** **OSS** (client), plus the `.design-sync/` adapter for the new `AccountMenu` card
  and the changed `TopBar` variants (ED4).
