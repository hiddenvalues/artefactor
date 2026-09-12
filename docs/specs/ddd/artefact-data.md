# Bounded Context: Artefact Data (backend store)

A simple per-artefact, per-user JSON store. It lets form / interactive artefacts persist
data **server-side** instead of (or alongside) browser `localStorage`. The motivating
example is an artefact that today does `localStorage.setItem(KEY, JSON.stringify({...}))`;
the backend store is a drop-in replacement that survives across browsers.

**The blob is opaque to the backend.** Each artefact decides the shape of its own payload —
the `{cards, sections}` object in the reference artefact is just one example. The store
validates that the body is *valid JSON within the size cap* and nothing more; it never
interprets or schema-checks the contents.

**The artefact sees exactly one dataset.** From inside the served artefact there is a single
set of data — the same mental model as plain `localStorage`. The artefact never reads across
users and never knows whose data it holds. Choosing *which* user's data is loaded is a
**host concern** handled by Artefactor's own UI *outside* the artefact container (see *Data
context*), and is opaque to the artefact.

## Aggregate: `DataEntry`

One entry per **(artefact, author)** pair. The whole stored object is a single opaque JSON
blob, mirroring how artefacts already keep one JSON object under one storage key.

| Field | Type | Notes |
|-------|------|-------|
| `id` | DataEntryId (uuid) | Identity. |
| `artefactId` | ArtefactId | The artefact this data belongs to. Immutable. |
| `authorId` | UserId | The Account that wrote it. Immutable. |
| `blob` | JSON | Opaque JSON value, shape owned by the artefact. ≤ `MAX_BLOB_BYTES` (= **5 MB**). |
| `createdAt` | timestamp | First write. |
| `updatedAt` | timestamp | Last write (upsert bumps it). |

## Invariants

1. **One per pair**: at most one `DataEntry` per `(artefactId, authorId)`. Writes **upsert**.
2. **Author = writer**: `authorId` is the authenticated user performing the write. A user
   may write **only their own** entry — never another user's.
3. **Writes require auth — no anonymous writes**: every write is attributed to an
   authenticated `authorId`. Unauthenticated viewers of a `public` artefact can *read*
   entries but can never create or modify one. (Decided: anonymous writes are not allowed.)
4. **Read follows artefact access**: which entries a viewer may *load* (through the host
   data-context switcher) is governed by the `Artefact` access matrix (`artefact-hosting.md`):
   - artefact `private` → only the owner (only their own entry exists anyway);
   - artefact `authenticated` → any signed-in user may load **any** author's entry;
   - artefact `public` → anyone (incl. unauthenticated) may load **any** author's entry.
   Under a **link gate** (`artefact-hosting.md` AH22, S32) non-owner reads *and* writes also
   require a valid pass for the gate's holder; an expired gate denies them as `private` (AH23).
5. **Write only your own context**: a viewer can write only when the loaded data context is
   their **own** entry. Loading another author's entry is **read-only** — the served artefact
   is in read-only mode and write attempts are rejected.
6. **Inert when archived**: if the artefact is `archived`, the data API returns 404 for both
   reads and writes (consistent with `artefact-hosting.md` invariant 7).
7. **Lifecycle-bound**: entries have no existence independent of their artefact.
8. **Blob bounds**: `blob` is valid JSON and ≤ `MAX_BLOB_BYTES` (5 MB). Contents are opaque
   — the artefact owns the shape; the backend does not interpret it.

## BFF endpoints (shape, to be finalized)

Consumed by **two different clients** — keep them distinct:

- **Host UI** (Artefactor's Svelte chrome around the iframe) drives the data-context
  switcher: list which authors have data, and load a chosen author's blob into the viewer.
- **Served artefact** never calls these directly; its persistence flows through the hijacked
  `localStorage`, which the BFF seeds and writes on its behalf.

`:ref` is the artefact's **public slug or its id** — the runtime resolves either (the id form
addresses a never-shared private artefact; see the S11 implementation notes).

| Method | Path | Purpose | Consumer / access |
|--------|------|---------|-------------------|
| `GET` | `/api/artefacts/:ref/data/authors` | List authors who have an entry (id + `updatedAt`) | host UI; per access matrix |
| `GET` | `/api/artefacts/:ref/data/:authorId` | Load one author's blob (for seeding/switching) | host UI; per access matrix |
| `GET` | `/api/artefacts/:ref/data/me` | The caller's own entry | host/runtime; authenticated |
| `PUT` | `/api/artefacts/:ref/data/me` | Upsert the caller's blob (full replace) | runtime (shim write-through); authenticated |
| `DELETE` | `/api/artefacts/:ref/data/me` | Remove the caller's entry | authenticated |

The author-listing and per-author endpoints exist **only** to power the host switcher; the
artefact itself stays opaque and single-dataset.

> **The blob stays opaque — the backend never parses or merges it.** There is deliberately no
> partial-update (merge-patch) endpoint: a merge would require the backend to interpret the
> blob's structure, breaking opacity. Writes are whole-blob `PUT`s. When an artefact's data
> *shape* changes (e.g. the MCP connector replaces its HTML), the backend cannot and does not
> migrate existing blobs — compatibility is the **artefact's** responsibility (versioned
> `localStorage` keys; see `skills/artefactor`). A breaking change is therefore best handled by
> a **forward migration shipped in the artefact's own HTML** (read the old key, transform,
> write the new one), which is the only place such a migration *can* live; publishing a
> separate **new artefact** keeps the old one intact for existing users.

### Snapshot read (S30)

An agent on the MCP connector may read a **snapshot** of the data — `get_artefact_data`. This
adds no authority and no interpretation:

- It returns the **caller's own entry only** (AD2/AD4), the same one `GET …/data/me` returns,
  and **verbatim** (AD8). There is deliberately **no** server-side summarising and no key/type
  digest: passing bytes through is transport, but *describing* their structure would be the
  backend interpreting the blob.
- It is **one blob, not the population.** `dataAuthorCount` says how many other authors hold
  data; their entries are never returned, and they may sit on older key versions, be partial,
  or have been written by HTML two revisions back. Any migration written from a snapshot must
  therefore tolerate shapes its author never saw.
- It refuses an over-cap result rather than truncating (a truncated blob is unparseable JSON,
  which invites acting on a fragment as though it were whole).

### Declared data schema — a payload convention (S30)

An artefact may declare its own data shape in an inert block inside its **HTML**:

```html
<script type="application/artefactor-schema+json">
{ "key": "habit-tracker-v2", "version": 2, "description": "…",
  "example": { "habits": [ { "id": "h1", "name": "Run" } ] } }
</script>
```

This is a **payload convention**, not a domain rule. The backend **may forward** the block (the
snapshot read returns it as parsed JSON, or `null` when it is absent, malformed, or not a JSON
object — never an error) but **never interprets or enforces it**: a blob is never validated
against a declared schema, because enforcing a schema would make the backend interpret the blob
and collapse AD8. An unknown script `type` is ignored by browsers, so the block is inert, and
because it lives in the trusted HTML it travels with an export automatically (see the export
read path in `artefact-hosting.md`).

It is best-effort by nature — a *second* representation of a truth that actually lives in the
JS, with nothing enforcing agreement — so a stale declaration produces a **confident** wrong
migration, which is worse than inference (inference fails visibly). The authoring rule is
therefore: schema and code are written in the same breath; a reader trusts the schema for
orientation and **verifies it against the HTML before any shape-changing write**. The block also
says nothing about the population, so the "tolerate shapes you never saw" rule above stands
regardless.

**Two version notions, reconciled.** The schema's `version` and AD9's `authoredAgainstVersion`
answer different questions and must not be conflated:

| | Says | Set by |
|--|------|--------|
| `authoredAgainstVersion` (AD9) | this blob was written against payload hash X | the **backend**, on every write |
| schema `version` | this HTML expects shape v2 | the **authoring agent**, by hand |

They are complementary: the pin is *mechanical* and per-entry (is this user's data stale?), the
declared version is *semantic* and per-payload (what shape does this HTML expect?). Keep both.

## Artefact runtime contract

**Design principle: the artefact only knows about `localStorage`.** Artefacts are written to
persist with the standard `localStorage` API (as the reference artefact does). Artefactor
**hijacks `localStorage`** on serve so that this persistence transparently flows to the
backend store — with **no changes to the artefact's code**. The artefact sees one dataset and
nothing else; there is no cross-user API inside the artefact.

### 1. localStorage hijack (transparent, zero-change)

On serving an artefact, Artefactor injects a bootstrap **before any artefact script runs**
that replaces `window.localStorage` with a backend-backed shim:

- The shim presents the full synchronous `localStorage` API (`getItem`, `setItem`,
  `removeItem`, `clear`, `key`, `length`).
- The artefact's entire localStorage keyspace is modelled as **one JSON object**
  (`{ [key]: stringValue }`) — and *that object is the `DataEntry.blob`*. This is exactly the
  "one JSON object under one key" pattern artefacts already use.
- **Reads are synchronous** because the shim is **seeded server-side**: the BFF looks up the
  viewer's `DataEntry` while serving and inlines it into the bootstrap, so the in-memory map
  is populated before the artefact runs. No client round-trip on first read.
- **Writes are write-through + debounced**: `setItem`/`removeItem`/`clear` update the
  in-memory map synchronously, then schedule a debounced `PUT …/data/me` of the whole blob.
  A flush on `pagehide`/`visibilitychange` (via `navigator.sendBeacon`) avoids losing the
  last edit.
- **Quota maps to the cap**: a write that would push the blob over `MAX_BLOB_BYTES` (5 MB)
  throws `QuotaExceededError`, mirroring native `localStorage` (and 5 MB is itself a typical
  localStorage budget, so artefacts already tolerate it).
- **Read-only contexts throw on write.** When the seeded data is read-only — an
  unauthenticated viewer of a `public` artefact, or a viewer who has loaded *another* user's
  data via the host switcher — writes are no-ops that throw like a full/read-only store.
  Seeded reads still work. The artefact cannot tell why; it just tolerates the failure.

The shim surface is finalized in slice **S13**. No `window.ARTEFACTOR` helper is exposed to
the artefact — persistence is `localStorage` only.

### 2. Data context (host-level, outside the artefact)

Which `DataEntry` is seeded into the artefact is the **data context**, chosen by Artefactor's
host UI, not the artefact:

- Default context = the **viewer's own** entry (read-write).
- A signed-in viewer with read access (per the access matrix) can use a host **user-picker
  widget** to load **another** author's entry. That re-seeds the artefact (e.g. iframe
  reload) with the selected blob in **read-only** mode.
- The artefact is oblivious to all of this: it always just sees "the one dataset" via
  `localStorage`. Switching context is opaque to it.

This keeps cross-user viewing entirely in the host application (BFF + chrome), backed
by the `…/data/authors` and `…/data/:authorId` endpoints above.

**Realized in S12 as a server-rendered shell.** `/a/:slug` returns a thin host shell (a
toolbar that wraps an `<iframe>` loading the artefact from `/a/:slug/frame`; `?author=<id>`
chooses the context). The shell is server-rendered rather than part of the Svelte SPA because
`/a/:slug` is the shareable link and must also serve unauthenticated/public viewers, who never
load the SPA. The **host tools** — the data-context picker, and any future toolbar widgets —
live in a **signed-in-only** wrapper: an anonymous public viewer gets the title bar + artefact
only, never the switcher. (This is a host-UI choice, not an access rule: the `…/authors` /
`…/:authorId` endpoints stay **not** `requireAuth`-gated, so AD4 — anonymous *may* read a
`public` artefact's data — still holds at the API; the switcher just isn't surfaced to them.)
For a signed-in viewer the picker itself still only appears when there's another context to
switch to (S20). Only the viewer's *own* context is seeded writable; any other author is
read-only (AD5).

## Decided

- **`MAX_BLOB_BYTES` = 5 MB.**
- **Single mutable blob per (artefact, author), upsert** — no append log of submissions.
- **No anonymous writes.** A `public` artefact's data is read-for-all, write-for-signed-in.
  Consequence: public artefacts cannot collect submissions from logged-out visitors.
- **localStorage is hijacked** so artefacts persist to the backend with zero code changes;
  the shim is **seeded server-side** so reads stay synchronous. **No `ARTEFACTOR` helper is
  exposed to the artefact** — it sees one opaque dataset, `localStorage` only.
- **Cross-user viewing is a host feature**, not an artefact capability: a host user-picker
  loads another author's data **read-only** by re-seeding the artefact. The artefact never
  knows whose data it holds.
- **A snapshot may be read, never interpreted (S30).** The connector can return the caller's
  own blob verbatim and forward the artefact's declared schema block, but the backend neither
  summarises the blob nor validates it against that schema — AD8 is unchanged.

## Amendment (post-v0.2) — payload version pin

> **Status:** DDD amendment (FDD slice **S19**). A small **additive** field on `DataEntry` —
> harmless in OSS, and the hook a superset's rollback uses to judge data compatibility. It does
> not weaken opacity.

**Problem.** A `DataEntry.blob` is shaped by whatever artefact payload was live when it was
written. When the payload later changes shape — edited in place, or (in the superset) rolled
back — previously-saved data may no longer match. The backend can't fix this (the blob is
opaque, AD8), but it *can* record **which payload version the data was written against** so the
host can detect the mismatch.

**Field.** `DataEntry` gains:

| Field | Type | Notes |
|-------|------|-------|
| `authoredAgainstVersion` | ContentHash \| null | The artefact's **payload content hash** at the moment of the (upsert) write. `null` for entries written before this field existed. Opaque — it names a payload, never describes the blob. |

**AD9 — pin on write.** Every `PUT …/data/me` sets `authoredAgainstVersion` to the artefact's
*current* payload content hash. It is **advisory metadata only**: it never gates a read or write
(AD3–AD5 unchanged) and the backend still never interprets the blob (AD8 holds).

**Use.**
- **OSS:** even with a single mutable payload, the host can tell whether a viewer's saved data
  **predates the current payload** (pin ≠ current hash) — a sharper form of the `dataAuthorCount`
  breaking-change signal already exposed to the MCP connector. **S30 reserves this field
  without depending on it**: the snapshot read already returns the pair
  (`currentPayloadVersion`, `authoredAgainstVersion`), with the pin `null` until this slice
  lands. That is sound precisely because AD9 is advisory and gates nothing — when S19 ships,
  the pin populates with no change to the tool's shape and no rewrite of the doctrine written
  against it (`null` ⇒ unknown, treat as possibly stale; ≠ current ⇒ written against older
  HTML, migration owed; = current ⇒ matches what is deployed).

  Do not conflate this pin with the **declared schema's** `version` (see "Declared data schema"
  above): this one is mechanical and backend-set, that one semantic and author-set.
- **Superset (history / rollback):** before serving an old or rolled-back version, compare the
  seeded entry's pin to the target version to decide whether the data is compatible (seed it, or
  warn / seed cautiously). This is the **pin-for-compatibility** decision — there is deliberately
  **no co-snapshot of data and no data time-travel** (continuous per-write data is a different
  cadence from discrete payload versions; out of scope).
