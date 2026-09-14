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
    entries, all its view entries (Artefact Views, `artefact-views.md` VT5), and all its
    comment threads (`artefact-feedback.md` FB6).
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
- The in-app viewer may embed the payload in an iframe for layout containment — a UI
  concern, not a security boundary.
- Because artefacts are served **same-origin**, their JS can call the backend store (see
  `artefact-data.md`) carrying the viewer's session — this is how forms persist data.
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

## Amendment (post-v0.2) — link gate: password + expiry

> **Status:** DDD amendment (FDD slice **S32**). Adds an owner-set **link gate** that narrows
> access *after* the access matrix grants it. Never widens access.

**Problem.** Once shared, an artefact is reachable for as long as its tier grants it, by anyone
the tier admits. Owners need the two controls every competing host offers: a **password** on
the link and an **expiry** after which the link stops working — without inventing a fifth tier.

**Value object.** `Artefact` (and `Collection`, consulted on roots only — CL4) gains:

| Field | Type | Notes |
| ------- | ------ | ------- |
| `linkGate.passwordHash` | string \| null | scrypt hash of the owner-set password; never returned by any read. `null` = no password. |
| `linkGate.expiresAt` | timestamp \| null | After this instant non-owners are denied. `null` = never expires. |
| `linkGate.version` | integer | Bumped whenever the password is set, changed or cleared. Invalidates every outstanding pass. |

A pure `evaluateLinkGate(gate, now, pass)` returns `open` | `expired` | `challenge`.

**AH22 — the gate narrows, after the matrix, for non-owners only.** The gate is consulted only
when the access matrix (AH8, under the effective access of AH20 and the `AccessPolicy` of AH18)
has already **granted** view to a **non-owner**. The owner is never gated. It applies to
**every** non-owner read of the artefact regardless of how it is addressed (slug or id alias):
the host shell and frame, the data reads (AD4) and writes, the HTML download (S30), the viewer
list (VT4), and comment threads (`artefact-feedback.md`). A gate on an artefact whose effective
access comes from a collection is **dormant** — the **tree root's** gate applies instead,
exactly as the root's `(visibility, sharedWith)` does (AH20/CL4).

**AH23 — expiry is evaluated at read time and never mutates state.** An expired gate makes the
artefact behave **exactly as `private`** for non-owners (unauthenticated → sign-in redirect,
signed-in → 404; archived and unknown slugs are indistinguishable). Nothing is unshared: the
tier, `sharedWith` and the slug (AH5) are retained, so clearing or extending `expiresAt`
restores access at the **same URL**. A newly set `expiresAt` must lie in the future. An expired
root hides its whole tree from non-owners (it drops out of "Shared with you").

**AH24 — AH8 holds under the gate.** Because the gate is evaluated only after a grant (AH22),
the password challenge is shown only to a viewer the matrix already admits — for an
unauthenticated visitor that means only a `public` artefact. No probe the matrix denies can
distinguish a gated artefact from a missing one.

**Passes.** A correct password yields a **pass**: an HMAC-signed, httpOnly cookie scoped to the
gate's holder (the artefact, or the collection root) carrying `linkGate.version`, valid for at
most 7 days and never beyond `expiresAt`. A pass with a stale `version` is void — changing or
clearing the password revokes every link already sent. Unlock attempts are rate-limited per
holder and client.

**Authority & guards.** Only the owner sets or clears a gate (AH9); not while archived (AH7);
only on a top-level artefact or a collection root (a contained artefact's gate is dormant and
cannot be edited, like its tier). Password length ≥ 8. Setting a gate does not change the tier.
