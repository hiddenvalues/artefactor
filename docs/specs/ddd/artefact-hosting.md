# Bounded Context: Artefact Hosting (core)

The core domain: storing trusted HTML artefacts and serving them privately to owners or
publicly by slug.

## Aggregate: `Artefact`

Aggregate root. The consistency boundary for one hosted artefact.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | ArtefactId (uuid) | Identity. Immutable. |
| `ownerId` | UserId | The BetterAuth user id of the Owner. Immutable. |
| `title` | string | Human label. Required, non-empty. |
| `kind` | ArtefactKind | `prototype` \| `slide-deck` \| `form` \| `interactive-doc` \| `other`. Metadata; drives browse grouping. |
| `htmlPayload` | HtmlPayload | Trusted HTML, stored as-is on the **filesystem**. Non-empty, ≤ `MAX_PAYLOAD_BYTES` (= **100 MB**). Row holds a reference + byte size + content hash. |
| `visibility` | Visibility | `private` \| `selected` \| `authenticated` \| `public`. |
| `sharedWith` | Set\<UserId\> | The specific users granted view access (used only while `visibility = selected`). A set — no duplicates; the owner is never a member (they always have access). Retained across tier changes. |
| `publicSlug` | Slug \| null | Minted the first time visibility leaves `private` (including for `selected`); thereafter retained. |
| `status` | Status | `active` \| `archived`. |
| `createdAt` | timestamp | Set on create. |
| `updatedAt` | timestamp | Bumped on any mutation. |
| `archivedAt` | timestamp \| null | Set on archive, cleared on restore. |

### Value objects

- **`ArtefactKind`** — closed enum (see above). Pure metadata; used to group/distinguish
  artefacts when browsing.
- **`HtmlPayload`** — trusted HTML string. Invariant: non-empty and ≤ `MAX_PAYLOAD_BYTES`
  (**100 MB**). **No sanitization** — payloads are trusted. **Stored on the filesystem**
  (see Persistence note), not inline in SQLite.
- **`Visibility`** — `private` | `selected` | `authenticated` | `public` (see access matrix below).
  `selected` shares the artefact with an explicit set of registered users (`sharedWith`) —
  a "shared" tier (it mints/retains a slug like the others), but gated by membership of the
  set rather than by login-state.
- **`AccessList`** (`sharedWith`) — the set of `UserId`s granted view access under the
  `selected` tier. Set semantics (no duplicates); the owner is implicit and never a member.
- **`Slug`** — short random URL-safe token. Immutable once minted. Globally unique across
  all artefacts.
- **`Status`** — `active` | `archived`.

## Invariants

1. **Ownership**: `ownerId` is always present and immutable; it references a valid Account.
2. **Payload**: `htmlPayload` is non-empty and ≤ `MAX_PAYLOAD_BYTES` (100 MB).
3. **Title**: non-empty.
4. **Shared ⟹ slug**: if `visibility ∈ {selected, authenticated, public}` then `publicSlug`
   is non-null. (A `private` artefact may also carry a slug if it was ever shared.)
5. **Slug permanence**: a slug is minted the first time visibility leaves `private`, and is
   thereafter immutable and **retained** for the life of the artefact — including across
   `unshare`/`share` cycles. Re-sharing reuses the same slug.
6. **Slug uniqueness**: slugs are globally unique.
7. **Archived is inert**: an `archived` artefact is **not served** (a signed-in view/slug
   request returns 404; an unauthenticated one is redirected to sign-in like any other miss —
   still never served, see the matrix), is hidden from default listings, and cannot be edited
   or have its visibility changed until restored. Its data entries are likewise inert.
8. **Access by visibility** *(active artefacts; see matrix below)*: `private` → owner only;
   `selected` → owner + any user in `sharedWith`; `authenticated` → any signed-in user;
   `public` → anyone, no auth.
9. **Owner authority**: only a request authenticated as `ownerId` may edit, change
   visibility, archive, or restore an artefact — at any visibility tier.
10. **Ingestion parity**: artefacts created by **API push** satisfy the exact same
    invariants as **manual upload**; there is no privileged path that bypasses them.
11. **Delete is archived-only**: an artefact may be permanently deleted only while
    `archived`, only by its owner; deletion also removes its payload file, all its data
    entries, all its view entries (Artefact Views, `artefact-views.md` VT5), all its
    comment threads (`artefact-feedback.md` FB6), and its thumbnail files (AH25–AH27
    amendment).
12. **Selected ⟹ slug**: `selected` is a shared tier — it mints a slug on the first share
    and retains it exactly like `authenticated`/`public` (subsumed by AH4/AH5). The slug
    link is live only for the owner and members; a signed-in non-member gets a flat 404, and
    an unauthenticated visitor is redirected to sign-in (see the matrix).
13. **Access-list retention**: `sharedWith` is retained verbatim across every visibility
    transition (including `unshare` to `private`) and across `archive`/`restore`. It is only
    *consulted* while `visibility = selected`; an empty `sharedWith` under `selected` means
    owner-only (it behaves like `private` until members are added).
14. **Access-list authority & shape**: only the owner may grant/revoke members (AH9 applies).
    `sharedWith` is a set (granting an existing member is a no-op; revoking a non-member is a
    no-op). The owner cannot be added (they always have access). The list cannot be changed
    while `archived` (AH7). Granting a member does not change the visibility tier.

## Access matrix (active artefacts)

| visibility | owner | member (in `sharedWith`) | other signed-in user | unauthenticated |
| ------------ | ------- | -------------------------- | ---------------------- | ----------------- |
| `private` | view + edit | — | 404 | → sign-in |
| `selected` | view + edit | view | 404 | → sign-in |
| `authenticated` | view + edit | view | view | → sign-in |
| `public` | view + edit | view | view | view |

**`→ sign-in`** = the unauthenticated visitor is redirected (`302` to `/?returnTo=<artefact
path>`), not shown the artefact. After they authenticate they are re-evaluated against this
matrix and bounced back to the artefact — so e.g. an org member who has not yet created their
account can open a `Members` (`authenticated`) link instead of hitting a dead 404. A
**signed-in** viewer who is denied still gets a flat `404`.

**No existence leak (AH8 holds):** the sign-in redirect is **uniform across every
unauthenticated miss** — unknown slug, `private`, `selected`, `authenticated`, and archived all
redirect identically — so an anonymous probe still cannot tell an existing artefact from a
missing one. Authenticated denials are a flat `404` for the same reason.

Archived artefacts are never served: a signed-in viewer (the owner included) gets `404`, an
unauthenticated one is redirected to sign-in like any other miss. The owner reaches an archived
artefact only via the "Your artefacts" archived filter to restore it.

## State / transitions

States are the product of `visibility × status`. Allowed transitions:

| Transition | From | To | Guard |
| ------------ | ------ | ---- | ------- |
| **create** | — | `active` / `private` | valid owner, valid payload + title |
| **edit** | `active` | `active` (fields updated) | owner; not archived |
| **share** | `active` / `private` | `active` / `selected`, `authenticated` or `public` | owner; mint slug if none, else reuse retained slug |
| **unshare** | `active` / `selected`\|`authenticated`\|`public` | `active` / `private` | owner; retain slug (link 404s while private) and `sharedWith` |
| **change tier** | `active` / any shared tier ⇄ any shared tier | (same status) | owner |
| **grant access** | `active` (any tier) | (same; `sharedWith` += user) | owner; not the owner themselves; consulted only under `selected` |
| **revoke access** | `active` (any tier) | (same; `sharedWith` −= user) | owner |
| **archive** | `active` | `archived` | owner |
| **restore** | `archived` | `active` | owner; restores prior `visibility` |
| **delete** | `archived` | — (removed) | owner; **only an archived artefact** may be permanently deleted |

> **Permanent delete** removes an artefact for good and is allowed **only from `archived`**
> (an active artefact must be archived first). Deletion removes the aggregate row, its
> **payload file**, **all its data entries** (the data context is owned by the artefact — see
> Relationship to Artefact Data), and **all its view entries** (Artefact Views, see
> `artefact-views.md`). It is irreversible; the UI gates it behind an explicit confirmation.
> Soft-delete (archive) remains the default lifecycle.

## Serving model

- Payloads are **trusted**: served as-is, no sanitization or script stripping (interactive
  prototypes keep their JS).
- The slug route serves the raw HTML for an `active` artefact subject to the access matrix.
- The host shell embeds the payload in a **sandboxed** iframe, and that iframe **is the security
  boundary** (AH28, S36): trusted means "served as-is", not "trusted with the viewer's session".
  The artefact runs in an opaque origin, so its JS can't read the session cookie, read any
  `/api` response, or make a state change the API accepts (IA6).
- Forms still persist, with no code change: the served `localStorage` shim posts each change to
  the host shell, which writes it to the backend store under the viewer's session (see
  `artefact-data.md` AD10).
- **Export (S30).** Alongside the render there is a second read path: the **export**, which
  returns the **stored payload** — never the injected render. It is governed by the same
  matrix as the render (AH7/AH8/AH9, on the *effective* tier per AH20): unknown handle,
  not-viewable, and **archived** all surface as a flat 404, with **no owner carve-out** for an
  archived artefact (restore → export → re-archive is the escape hatch; AH7 keeps archived
  inert). The distinction from the render is the point: the render injects the localStorage
  bootstrap and wraps the artefact in the host shell, whereas the export is byte-identical to
  what was uploaded, so export → edit → re-upload round-trips through the same create/edit
  commands and yields the same artefact. A payload convention carried *inside* the HTML — such
  as the declared data schema in `artefact-data.md` — therefore travels with the export for
  free, with no extra plumbing.

## Relationship to Artefact Data

The `Artefact` aggregate is the access-control authority for its data entries: read access
to an artefact's data follows this context's access matrix, and archiving makes data inert.
The data entries themselves are modelled in `artefact-data.md`.

## Persistence note

- **Payloads live on the filesystem.** The SQLite row stores metadata plus a **reference**
  to the file (path/key), the **byte size**, and a **content hash**. SQLite never holds the
  100 MB payload inline. Filesystem layout and the on-disk root are an S0/S2 concern.
- **Unauthenticated access is by direct slug link only** — there is no public browse view.
  "Shared with you" (`authenticated`/`public` artefacts grouped by kind) is for signed-in
  users only.

## Decided

- **Slug = short random URL-safe token, collision-checked** at mint time (regenerate on the
  rare collision). Not derived from the title.

## Open questions

*None at the context level. Slice-local details are in the FDD spec.*

## Amendment (post-v0.2) — payload retention is a seam

> **Status:** DDD amendment (FDD slice **S19b — Payload-retention seam**). Introduces an
> extensibility **seam without
> changing OSS behaviour**. A superset can swap the policy to retain prior payloads and offer
> rollback; OSS keeps a single mutable payload.

**Problem.** `edit` replaces `htmlPayload` wholesale (a full replacement, not a patch). Today
the **superseded** payload file is **deleted immediately** after a successful save, so no
history can exist. That one deletion is all that stands between "single mutable payload" and
"rollback".

**Seam.** Disposal of a superseded payload is delegated to a **`PayloadRetentionPolicy`** port,
consulted whenever a newly-stored payload displaces the previous one (on **edit**, and on a
superset's **rollback**):

- `onPayloadSuperseded({ artefactId, superseded, replacement, by, at })` — given the displaced
  payload descriptor (ref + content hash + bytes), decides its fate.
- **OSS default = `DiscardSupersededPayload`**: deletes the file — **byte-identical to today**.
  OSS still has exactly one payload per artefact, so **this amendment does not introduce
  versioning into OSS** (the v0.2 "Versioning: none" decision stands). The seam is the single
  disposal point, so no other core code changes.
- A **retaining** implementation (closed superset) keeps the displaced payload and records it
  as a historical version (see the EE *Artefact History* context).

**AH15 — retention is invisible to the core.** Under any policy the `Artefact` aggregate is
unchanged: it has exactly one *current* `htmlPayload` (ref + hash + bytes) as its **head**.
Retained prior payloads, if any, live **outside** this aggregate and are never consulted by the
access matrix, serving, or listing. Permanent delete (AH11) must still erase everything — the
retention policy is responsible for purging any payloads it retained for the artefact.

**Content addressing.** `HtmlPayload` already carries a `sha256` content hash. That hash is the
natural, stable **version identity** a retaining policy uses, and it lets an identical payload
(e.g. a rollback re-applying an earlier version) **dedupe** to the same stored blob.

## Amendment (post-v0.2) — `usesStorage` flag

> **Status:** DDD amendment (FDD slice **S20**). Adds a derived metadata flag that drives **host
> chrome only** — never access or persistence behaviour.

**Problem.** The host data-context switcher (S12) renders a "Data context" picker in the chrome
around every served artefact. For an artefact that never persists anything (a static deck, a
prototype with no `localStorage`) the picker is meaningless.

**Field.** `Artefact` gains a derived boolean:

| Field | Type | Notes |
| --- | --- | --- |
| `usesStorage` | boolean | Whether the payload appears to use the persistence API. **Recomputed whenever the payload is set** (create / payload-replacing edit); title/kind-only edits leave it unchanged. |

**AH16 — `usesStorage` is a heuristic for chrome only.** It is detected by a pure scan of the
HTML for the `localStorage` API (a word-boundary match — so `sessionStorage`, which Artefactor
does **not** persist, does not count). It may have rare false negatives (e.g. dynamically
constructed `window['local'+'Storage']`); this is acceptable because it **only decides whether
host UI is shown** — it never gates access (AH8), serving, or the data API. The served artefact's
behaviour is identical regardless.

**Use (S12 chrome).** The switcher is shown only when the artefact **could** have multiple data
contexts to choose between: `usesStorage` is true **and** at least one *other* author has a data
entry. `usesStorage = false` lets the shell omit the picker (and skip the authors fetch) up
front; the "≥1 other author" rule additionally hides the useless single-context case and covers
legacy rows (so `usesStorage` may default to `true` with no backfill).

## Amendment (post-v0.2) — tenant scope + access-policy seam

> **Status:** DDD amendment (FDD slice **S22**; EE context `ee/docs/specs/ddd/tenancy.md`). Two thin
> seams that make the deployment **multi-tenant** in a superset, **behaviour-preserving in OSS**
> (one implicit tenant).

**Problem.** OSS is single-tenant *by being one deployment*: `authenticated` means **every** signed-in
user, and list/find queries are global. A multi-tenant superset needs artefacts scoped to an
**organization** and the `authenticated` tier reinterpreted as "within my org" — without forking the
access matrix or the repository.

**Seam (a) — tenant scope.**

- `Artefact` gains **`tenantId`** (immutable, set at create). OSS default = a single well-known
  tenant (`DEFAULT_TENANT`), so every row shares one tenant and behaviour is byte-identical.
- `ArtefactRepository` list/find operations become **scope-aware**: `findById`, `listByOwner`, and
  `listShared` take a **`TenantScope`** and never return rows outside it (subordinate data/view/version
  reads inherit the scope). **`findBySlug` is the deliberate exception — it stays tenant-global**,
  because a slug is a globally-unique capability (AH6): it is the cross-tenant address for public/link
  serving and the mint-time uniqueness check. The per-tier tenant decision for a slug-served artefact
  is the `AccessPolicy`'s (seam b), not the scope's. OSS passes the singleton scope (no behavioural
  change); a superset passes the caller's **active org** (a single tenant per request, not an
  org-set —
  it maps 1:1 onto the Postgres RLS `SET LOCAL app.tenant_id` backstop). The scope is resolved per
  request by an injected `TenantScopeResolver` (OSS default = the singleton), so a superset overrides
  *which* tenant a request sees without editing core route handlers.

**Seam (b) — access policy.**

- The access-matrix decision (who may view an artefact) is delegated to an **`AccessPolicy`** port.
  OSS default = the matrix above. A superset overrides **only the `authenticated` tier** to mean
  "co-member of the artefact's tenant." AH8 (no existence leak / uniform redirect) and AH9 (owner
  authority) are **fixed under any policy**.
- The port asks exactly one question — `grantsAuthenticatedTier(viewerId, tenantId)` — and it is
  only ever asked for a **signed-in non-owner** requesting the `authenticated` tier. The anonymous
  denial, the owner's view of their own artefact, the `public`/`selected`/`private` semantics, and
  archived-is-inert (AH7) are decided by the fixed matrix *before* the policy is consulted, so no
  policy can alter them (fixed by construction, not by convention).
- The policy is consulted where the **slug capability crosses tenants** (serving and the
  slug-resolved data/viewers reads). Id-addressed reads and collection reads need no policy: they
  resolve through the tenant-scoped repository (seam a), and within a scope the viewer is a
  co-member by construction — collections additionally have no slugs and are signed-in only.

**AH17 — tenant scope is invisible to OSS.** Under the default singleton tenant + scope, the
aggregate and all behaviour are identical to today; `tenantId` is carried but never discriminates.
Permanent delete (AH11) and every per-artefact subordinate (data entries, view entries, retained
versions) are tenant-scoped in a superset.

**AH18 — access is policy-decided.** The matrix in this spec is the **OSS default policy**. Only the
`authenticated` tier's meaning is overridable (login-wide ↔ org-wide); `private`/`selected`/`public`
semantics and the AH8 uniformity are not. Migration adds `tenant_id` defaulting to `DEFAULT_TENANT`.

## Amendment (post-v0.2) — collection membership + effective access

> **Status:** DDD amendment (FDD slices **S25–S27**; context `ddd/artefact-collections.md`).
> Adds folder organization whose access the contained artefacts inherit.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `collectionId` | CollectionId \| null | The collection the artefact lives in; `null` = top-level. Mutable (move), owner-only, blocked while archived (AH7). The collection must have the same `ownerId`/`tenantId` (CL1). |

**AH20 — effective access.** An artefact with `collectionId = null` behaves exactly as
specified above. An artefact inside a collection is governed by its collection **tree root's**
`(visibility, sharedWith)` (CL4/CL5): its own `visibility`/`sharedWith` lie **dormant** —
retained verbatim, consulted again once moved back to top level. The dormant *tier* cannot be
changed while contained (`set visibility` rejects); the access list may still be curated at
any tier per AH14, it is simply not consulted. The access matrix (AH8) is unchanged; read
paths resolve the effective
`(visibility, sharedWith)` first (`effectiveViewable`, see `artefact-collections.md`) and feed
it to the same matrix. AH8's no-leak uniformity and AH9's owner authority hold under either
source. "Shared with you" (S14) lists **effectively** shared artefacts.

**AH21 — slug on effective share** (extends AH4/AH5). A slug is minted the first time an
artefact's **effective** visibility leaves `private` — whether by its own share (AH4), by
being moved into a shared tree, or by its tree root's access changing to a shared tier (CL6).
Minting stays eager (at the transition, collision-checked, then retained per AH5), so every
effectively-shared artefact is addressable by link.

Archive/restore cascades and permanent-delete cascades from a collection apply this context's
own transitions per artefact (AH7/AH11) — see CL7/CL8.

## Amendment (post-v0.2) — payload-size policy seam

> **Status:** DDD amendment (FDD slice **S23**; EE context `ee/docs/specs/ddd/usage-quota.md`).
> Behaviour-preserving in OSS.

**Problem.** The per-artefact cap `MAX_PAYLOAD_BYTES` (**100 MB**, AH2) is a hardcoded constant. The
EE *Large Artefacts* add-on needs a tighter default (**10 MB**) liftable to 100 MB per entitlement —
without OSS losing its flat 100 MB.

**Seam.** Extract the cap into a **payload-size policy** consulted by `createArtefact`/`editArtefact`
when validating `HtmlPayload`. **OSS default keeps 100 MB** (AH2 unchanged). A superset drives the
cap from plan entitlements (10 MB default, 100 MB with *Large Artefacts*).

**AH19 — size cap is policy-decided, 100 MB in OSS.** The HtmlPayload invariant (AH2: non-empty,
≤ cap) holds; only the *cap value* is supplied by the policy. The OSS policy returns the constant
100 MB, so OSS is byte-identical.

## Amendment (post-v0.2) — link gate on public artefacts: password + expiry

> **Status:** DDD amendment (FDD slices **S32a — Link controls on public artefacts: password +
> expiry** and **S32b — Link controls on public collections: password + expiry**). Adds an
> owner-set **link gate** that narrows the `public` tier's extra audience *after* the access
> matrix grants it. Never widens access and never changes the tier.

**Problem.** A `public` artefact is reachable by anyone with its slug (or id alias) for as long as
it stays public. Owners need the two controls every competing host offers on a public link: a
**password** and an **expiry** after which the link stops working — without inventing a fifth
tier, and without gating the teammates the `authenticated` tier already admits.

**Value object.** `Artefact` gains a `linkGate` (and, with S32b, a collection root):

| Field | Type | Notes |
| ------- | ------ | ------- |
| `linkGate.passwordHash` | string \| null | scrypt hash of the owner-set password; never leaves the repository layer into any summary, BFF or MCP result. `null` = no password. |
| `linkGate.expiresAt` | timestamp \| null | After this instant the gated audience is denied. `null` = never expires. |
| `linkGate.version` | integer | `0` at create. Bumped whenever the password is set, changed or cleared, and whenever the tier leaves `public`. Invalidates every outstanding pass. |

A pure `evaluateLinkGate(gate, now, pass)` returns `open` | `expired` | `challenge`: `expired`
once `now ≥ expiresAt` (even with a valid pass), else `challenge` when a password is set and the
pass is absent or carries another `version`, else `open`.

**AH22 — the gate narrows the public cell's extra audience only.** It is consulted only after
the matrix (AH8, on the effective tier of AH20, under the `AccessPolicy` of AH18) has granted
view, only when the **effective tier is `public`**, and only for a viewer admitted **solely** by
the public cell: not the owner, and not a signed-in viewer the `authenticated` tier would admit
under the `AccessPolicy`. In OSS that is exactly the anonymous visitor; in a multi-tenant
superset also a signed-in user of another organization. It applies to every such read whichever
ref form is used (slug or id alias): the host shell and its frame (a frame token is minted only
after the gate, and its redeem re-runs the gate), the data reads (AD4) and writes, the HTML
download (S30), the viewer list (VT4) and the thumbnail (S35). A contained artefact's own gate is
dormant, like its own tier (AH20).

**AH23 — expiry is read-time and never mutates.** Past `expiresAt` the gated audience sees the
artefact **exactly as `private`** (unauthenticated → sign-in redirect, signed-in → 404;
indistinguishable from an unknown or archived slug). Nothing is unshared: the tier, `sharedWith`
and the slug (AH5) are retained, so extending or clearing `expiresAt` restores access at the
**same URL**. A newly set `expiresAt` lies in the future.

**AH24 — AH8 holds under the gate.** Because the gate is evaluated only after a grant (AH22), a
password challenge is shown only to a viewer the matrix already admits — for an unauthenticated
visitor that means only a `public` artefact. No probe the matrix denies can tell a gated artefact
from a missing one.

**AH31 — the gate lives only on `public`.** A gate can be set only while the artefact's own tier
is `public` — atomically with the change to `public`, or later while public. Any change of the
tier **away** from `public` clears it and bumps `version`; `public → public` is a no-op that keeps
it. Only the owner sets or clears it (AH9; a non-owner is refused as not found, AH8), never while
archived (AH7), and only on a top-level artefact (a contained artefact's own tier and gate are
dormant, AH20). A password is 8–128 characters. Changing only the expiry leaves `version` as it
is. Setting or clearing a gate never changes the tier.

**Passes.** A correct password yields a **pass**: an HMAC-signed (`BETTER_AUTH_SECRET`),
httpOnly, SameSite=Lax cookie named for the gate's holder, carrying `{ holderId, version, exp }`
with `exp = min(now + 7 days, expiresAt)`. A pass with a stale `version` is void — changing or
clearing the password revokes every link already unlocked; changing only the expiry does not.
Unlock attempts are rate-limited per holder and client address (IA8).

## Amendment (post-v0.2) — Artefact thumbnails

> **Status:** DDD amendment (FDD slice **S35**; renderer isolation, AH29, **S37**). Adds a
> **derived** preview image per artefact
> that drives **host chrome only** (the dashboard and gallery cards) — never access, serving,
> listing or the data API.

**Problem.** Cards show only a kind placeholder, so many prototypes or decks look alike until
each is opened. The MCP connector (Path A) has no browser, so a preview must be rendered
server-side from what is stored.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `thumbnailHash` | string \| null | The `payloadHash` the recorded thumbnail was rendered from. `null` at create; untouched by edit; written **only** by the record compare-and-set (AH26). The artefact's thumbnail is **stale** while `thumbnailHash ≠ payloadHash`. |

**AH25 — the thumbnail is derived host chrome.** It never gates access (AH8), serving, listing
or the data API. A missing thumbnail always renders the kind placeholder. Rendering runs
**after** the create or edit is persisted and **never blocks or fails** the command: a
disabled, missing, failing or timed-out renderer leaves `thumbnailHash` untouched. The
disabled path is **no renderer configured or reachable** (AH29): no isolated renderer URL is
set, or the renderer stays unreachable past its retry budget.

**AH26 — pristine and payload-bound.** A thumbnail is rendered from the **stored payload
alone** — no S13 localStorage bootstrap, no S12 shell, no `DataEntry` — so it is a function of
`payloadHash` and can never leak anyone's saved data. A render is recorded **only** by a
compare-and-set against the artefact's current `payloadHash`: a render that finishes after a
newer edit is discarded. Recording does not change `updatedAt`. `thumbnailHash` is written
**only** by that compare-and-set, never by an aggregate save, so a concurrent edit cannot revert
a just-recorded thumbnail. The previous thumbnail stays served until a newer one is recorded;
the superseded file is deleted after that. A title/kind-only edit does not re-render.

**AH27 — thumbnail reads are signed-in and follow the export access matrix.**
`GET /api/artefacts/:ref/thumbnail` requires a session (anonymous → 401 for every ref, which
leaks nothing, AH8), then resolves exactly like the S30 download (`resolveViewableArtefact`:
slug or id, effective tier per AH20, `AccessPolicy` per AH18). Unknown, not viewable, archived
(owner too, AH7) and no thumbnail yet all return the same flat 404. The route adds no access
logic of its own — the matrix stays single-sourced (AH18).

**AH29 — untrusted payload HTML is rendered only by an isolated renderer** *(S37)*. To draw
an artefact, Chromium runs the uploader's JavaScript, so a render is treated as hostile code.
The renderer:

- runs **outside the app process and container**;
- holds **no secrets, no payload/thumbnail storage and no database access** — the app sends it
  the stored payload bytes (AH26) and stores what comes back;
- runs Chromium with its **OS sandbox on**, never falling back to unsandboxed;
- **can't open connections** to the app, private or link-local networks;
- keeps **no state from one render to the next**.

If no such renderer is configured or reachable, AH25's disabled path applies. Inputs above
`MAX_RENDER_INPUT_BYTES` (10 MB) are never sent: the artefact keeps its placeholder. This is
isolation, not sanitisation — the locked decision "artefacts are trusted HTML, served as-is" is
untouched, and scanning uploaded HTML was rejected (exploits are ordinary, runtime-assembled JS
that no signature matches, while legitimate artefacts do exactly what a scanner would flag).
`docs/renderer-isolation.md` is the operator's view of the same layers.

> **Isolation evidence (S37 spike, not an invariant).** Measured with `playwright-core` 1.63 /
> `chromium-headless-shell` in `node:26-bookworm-slim`, as uid `node`, `read_only`, tmpfs `/tmp`
> and `$HOME`, `cap_drop: ALL`, `no-new-privileges`, no `SYS_ADMIN`, no `--privileged`
> (Docker Desktop 29.4, linuxkit 6.12, cgroup v2):
>
> - **Seccomp.** Docker's default profile refuses the sandboxed launch ("No usable sandbox"): it
>   allows `clone` with `CLONE_NEW*` flags, `unshare` and `chroot` only to a container holding
>   `CAP_SYS_ADMIN` / `CAP_SYS_CHROOT`. `deploy/chromium-seccomp.json` — Docker's default plus
>   one rule allowing exactly `clone`, `unshare` and `chroot` — launches it. The renderer
>   processes then run in their own user and pid namespaces under seccomp-bpf (`Seccomp: 2`). No
>   capability is added and nothing runs unconfined.
> - **AppArmor.** Docker Desktop has no AppArmor, and no stock Ubuntu 24.04 Docker host was
>   available, so `kernel.apparmor_restrict_unprivileged_userns` inside a container is
>   **unverified**; the renderer's `/health` answers `503` naming the launch failure if the host
>   blocks it, and `docs/renderer-isolation.md` gives the check and the fixes. On a bare GitHub
>   `ubuntu-latest` runner (24.04, restriction on) CI lifts the sysctl for the browser tests.
> - **`/dev/shm`.** Nothing needed: Playwright launches Chromium with
>   `--disable-dev-shm-usage`, so Docker's 64 MB default suffices.
> - **Restart backoff.** A container exiting `0` after ≥ 10 s of uptime restarts in ~90 ms
>   every time; one exiting after 2 s backs off 0.1 → 0.2 → 0.4 → … → 12.8 s. Hence the 10 s
>   minimum uptime before a disposable renderer exits.
> - **Cycle.** Container start → ready → one render → exit → restart measured on the compose
>   example: see *Cycle time* in `docs/renderer-isolation.md`.
> - **Coolify.** An *application*'s custom Docker options omit `--read-only`, `--tmpfs`,
>   `--pids-limit` and `--user`, so the renderer runs as a Docker Compose resource; that
>   Coolify keeps every hardening key is unverified until the deployment check passes.

**AH11 amendment.** Permanent delete — of the artefact, or of it through a collection's CL8
cascade — also removes the artefact's thumbnail files.

**AH22 amendment.** The link gate's list of gated reads gains **the thumbnail (S35)**. No
S35 code is needed for it: the thumbnail route reuses the download's resolver, so the gate is
inherited with S32a, and a card whose image fails to load falls back to the placeholder. A
thumbnail a non-owner reads of a gated artefact is served `no-store`, so a browser never keeps
showing it after the pass expires or is voided.

**AH17 note.** The render sweep that finds artefacts needing a thumbnail is a **system** read:
tenant-agnostic, internal, never exposed through any API, and returning only what the renderer
needs (`id`, `payloadRef`, `payloadHash`, `thumbnailHash`, and — for the AH29 input cap, S37 —
`payloadSize`).

**Storage.** Thumbnails are WebP files at `<thumbnailRoot>/<artefactId>/<payloadHash>.webp`,
a sibling of the payload root and never inside it (a payload-retention policy, the S19b seam,
must never have to tell them apart).

## Amendment (post-v0.2) — Isolated artefact serving

> **Status:** DDD amendment (FDD slice **S36**). A serving change, not sanitization: payloads
> stay trusted and byte-identical in storage and export (S30). With the Artefact Data AD10 and
> Identity & Access IA6 amendments.

**Problem.** The frame used to load same-origin with no `sandbox`, so any artefact a signed-in
viewer opened could call every `/api` endpoint as them: list and download private artefacts,
change visibility and access lists, archive and delete, write data.

**AH28 — served artefact HTML never runs in the app origin.**

- **Sandboxed frame.** The host shell's iframe carries `sandbox="allow-scripts allow-forms
  allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"` and
  `allow="clipboard-write; fullscreen"`. It never carries `allow-same-origin` or any
  `allow-top-navigation*`. The artefact therefore runs in an **opaque origin** (`"null"`).
- **The header travels with every frame response.** `GET /a/:slug/frame`,
  `GET /api/artefacts/:id/raw/frame` and the expired-token page all answer with
  `Content-Security-Policy: sandbox <the same flags>` and `Referrer-Policy: no-referrer`, so a
  frame URL opened top-level, or in a popup that escaped the sandbox, is still opaque. One
  constant is the single source of the attribute and the header. There are no other CSP
  directives, so CDN libraries and external APIs keep working.
- **Frames never read cookies.** A frame is authenticated **only** by its frame token (AD10), and
  the access matrix (AH8, on the effective tier of AH20, under the policy of AH18) is
  re-evaluated at every token redeem, so a revocation takes effect at once.
- **Optional content origin.** When `ARTEFACTOR_CONTENT_ORIGIN` is set, frames are served only
  on that origin, which must be a **separate registrable domain** from the app. Startup refuses
  the app host itself, a subdomain of it, and a parent domain of it; it compares **hosts, not
  registrable domains** (no public-suffix list), so a sibling under one registrable domain —
  `content.example.com` beside `app.example.com` — is *accepted*, and keeping them apart stays
  the operator's responsibility. That host answers only the
  two frame routes and `/health`, and the app host answers no frame route. Unset, frames are
  served on the app host, isolated by the sandbox alone.

**Isolation evidence (S36 spike, not an invariant).** A fixture in a sandboxed iframe (attribute
and header), against a canary server holding a `SameSite=Lax` cookie (BetterAuth's default), a
`SameSite=None; Secure` one and a script-readable one:

| Probe | Chromium 153 (headless shell) |
| --- | --- |
| `self.origin` | `"null"` |
| `document.cookie`, `sessionStorage`, `indexedDB.open` | throw `SecurityError` |
| `Object.defineProperty(window, "localStorage", …)` before any native access | succeeds; the shim round-trips |
| `parent.postMessage(msg, appOrigin)` | delivered, `event.source === frame.contentWindow`, `event.origin === "null"` |
| `fetch` / XHR `/api/me` with credentials | response unreadable (CORS); `Lax` cookie never sent |
| no-cors `POST`, form `POST`, `<img>`, `sendBeacon` | `Lax` cookie never sent; the `None` cookie is, always with `Origin: null` (none on `<img>`) and `Sec-Fetch-Site: cross-site`, so IA6 refuses any state change |
| `top.location = …`, `target="_top"` link | blocked; the shell stays put |
| `window.open` of the frame URL, frame URL top-level | still `"null"` (the header), cookies and storage throw |
| `target="_blank"` link | opens an unsandboxed popup (expected) |
| `alert`, blob download, clipboard on a click, a CDN script | work |

Firefox and WebKit were **not run**: their Playwright builds could not be downloaded in the spike
environment and Safari's WebDriver was not enabled. Re-run the matrix on them before relying on it
beyond Chromium.

## Amendment (post-v0.2) — owner-set data visibility

> **Status:** DDD amendment (FDD slice **S41 — Owner-set data visibility: shared or own-only**;
> with Artefact Data AD11). Adds an owner-set field that decides *whose data* a viewer sees —
> never *who may view*.

**Field.** `Artefact` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `dataVisibility` | `shared` \| `own` | Whether a viewer may load other authors' saved data (AD11). `own` on create; `shared` for rows that predate the field. |

**AH30 — `dataVisibility` is an owner-set field of `Artefact`.**

- Only the owner changes it (AH9); a non-owner is refused as not found (AH8). It cannot change
  while the artefact is archived (AH7). A change bumps `updatedAt`; setting the current value is
  a no-op.
- It is **per artefact** and never inherited from a collection: AH20's effective access governs
  *who may view*, while AD11 governs *whose data a viewer sees*, and that stays on the artefact
  itself. It is settable while the artefact is contained.
- It never gates viewing, serving or the viewer's own reads and writes; it only narrows which
  **other** authors' entries a non-owner may load (AD11).
- New artefacts get `own`, so data is private per viewer by default; rows that predate the field
  migrate to `shared`, so no live behaviour changes.
