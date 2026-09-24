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
| ------- | ------ | ------- |
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
   **Narrowed by AD11** (S41): under the owner's `own` data visibility a non-owner loads only
   their own entry.
   Under a **link gate** on a `public` artefact (`artefact-hosting.md` AH22, S32a) the reads
   *and* writes of the gated audience — a viewer admitted only by the public cell — also require
   a valid pass for the gate's holder; an expired gate denies them as `private` (AH23).
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
| -------- | ------ | --------- | ------------------- |
| `GET` | `/api/artefacts/:ref/data/authors` | List authors who have an entry (id + `updatedAt`) | host UI; per access matrix |
| `GET` | `/api/artefacts/:ref/data/:authorId` | Load one author's blob (for seeding/switching) | host UI; per access matrix |
| `GET` | `/api/artefacts/:ref/data/me` | The caller's own entry | host/runtime; authenticated |
| `PUT` | `/api/artefacts/:ref/data/me` | Upsert the caller's blob (full replace); optionally conditional (`If-Match` / `If-None-Match: *` → 412, S31) | runtime (shim write-through); authenticated |
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

### Snapshot read (S30, widened by S40)

An agent on the MCP connector may read a **snapshot** of the data — `get_artefact_data`. This
adds no authority and no interpretation:

- By default it returns the **caller's own entry** (AD2/AD4), the same one `GET …/data/me`
  returns, and **verbatim** (AD8). There is deliberately **no** server-side summarising and no
  key/type digest: passing bytes through is transport, but *describing* their structure would
  be the backend interpreting the blob.
- **The owner may read any author's entry (S40).** AD4 already lets the owner load any author's
  entry through the host switcher; the owner's connector gets the same read.
  `list_artefact_data_authors` lists who holds an entry (identity, stored byte length,
  `updatedAt`, version pin — never the blob), and `get_artefact_data { author }` returns one
  author's entry verbatim. The reach is **narrower** than AD4: owner-only, on the owner's
  active artefacts, like every connector tool. It is **read-only** — no tool writes another
  author's entry (AD2/AD5). An `author` that names no one with an entry is refused with one
  message whether or not such a user exists, so the tool is no email-existence probe.
- **Each read is one blob, not the population.** `dataAuthorCount` says how many authors hold
  data; each entry may sit on an older key version, be partial, or have been written by HTML
  two revisions back (compare its `authoredAgainstVersion`, AD9). Any migration or aggregate
  written from these reads must therefore tolerate shapes its author never saw, and any
  aggregation happens agent-side, one entry at a time — never on the server (AD8).
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
| -- | ------ | -------- |
| `authoredAgainstVersion` (AD9) | this blob was written against payload hash X | the **backend**, on every write |
| schema `version` | this HTML expects shape v2 | the **authoring agent**, by hand |

They are complementary: the pin is *mechanical* and per-entry (is this user's data stale?), the
declared version is *semantic* and per-payload (what shape does this HTML expect?). Keep both.

### Connector write (S31)

An agent on the MCP connector may **write** the caller's own blob — `set_artefact_data`. It is
the same whole-blob upsert as `PUT …/data/me`, through the same `putOwnDataEntry` command, so
AD1 (one per pair, upsert), AD2 (author = the token's user), AD3 (authenticated) and AD8 (valid
JSON ≤ 5 MB, parsed only to check) hold unchanged.

**Why this is not the dropped merge-patch.** A merge-patch put the merge *in the backend*: the
server would have had to parse the blob to fold a fragment into it, breaking AD8. Here the
transform happens **agent-side** — the agent reads the whole blob (the S30 snapshot read),
transforms it in its session, and writes the whole blob back. The server still never interprets
it and the artefact still owns its shape. There is no partial write: a key the agent leaves out
is gone.

**Hard boundary — own entry only.** The tool can only ever name the caller's own entry. Writing
another author's entry is forbidden by AD2/AD5; an owner curating other users' saved data is
**outside this domain**, not a missing permission.

**Owner-scoped (v1).** Like the snapshot read, the tool reaches only artefacts the caller owns
and that are active (unknown / not owned / archived / out of tenant scope → not found, AD6/AH7),
even though AD2/AD5 would allow writing one's own entry on any viewable artefact (as `PUT
…/data/me` does). A write reaching further than its read would break the read-modify-write loop
for exactly the artefacts the wider reach was for; widening **both** together is one deliberate
follow-up.

**Optimistic pin — `DataConflict`.** A data write is otherwise a blind overwrite of a single
mutable blob with no versioning or undo, and the user very likely has the artefact open in a
browser while talking to the agent. That open tab is a hazard in **both** directions: its
saves can race the agent's write, and — worse — its in-memory copy, written back on the next
save, would silently revert the agent's change. So **both writers pin** (the tab's side is
described under the runtime contract below), and `putOwnDataEntry` takes an optional
`ifUnmodifiedSince`:

| Pin | Stored entry | Result |
| ----- | -------------- | -------- |
| absent | any | write unconditionally (the `PUT …/data/me` behaviour, unchanged) |
| a timestamp | none, or `updatedAt` ≤ pin | write |
| a timestamp | `updatedAt` > pin | **`DataConflict`** — nothing written |
| `null` ("I read no entry") | none | write (create) |
| `null` | exists | **`DataConflict`** — nothing written |

The connector passes the `updatedAt` its snapshot read returned; on conflict the agent re-reads
and re-applies. `PUT …/data/me` maps `If-Match: "<updatedAt>"` → a timestamp pin and
`If-None-Match: *` → `null`, answers a conflict with **412**, rejects an unparseable
`If-Match` with 400 (never an unconditional write), and without either header writes
unconditionally as before. The served shim always sends one. The check is best-effort
(read-then-save, not a transaction) — it closes the realistic human-scale race, not a
same-millisecond one.

Because an idle open tab never writes, a conflict for the agent means the user **actually
saved** in the seconds between its read and its write — not merely that the artefact is open.
After a successful agent write, an open tab keeps showing the old data until reloaded; its
next save is refused and the host shell prompts the reload.

**AD9.** Because the tool goes through `putOwnDataEntry`, a connector write stamps
`authoredAgainstVersion` exactly as a shim write does (S19a) — no connector-specific path.

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
- **Writes are write-through + debounced, through the host shell (AD10, S36)**:
  `setItem`/`removeItem`/`clear` update the in-memory map synchronously, then the shim posts the
  whole blob to the host shell (`{ type: "artefactor:data-changed", blob }`, debounced, and
  again on `pagehide`/`visibilitychange: hidden` when a change is still unposted). The shim
  never calls the API: the sandboxed frame has no session (AH28). The **shell** sends the
  `PUT …/data/me`, under the viewer's session, with a `keepalive` flush on its own `pagehide`.
- **Only changes are written, and every write is pinned (S31).** Because the saved data can
  also be replaced from outside the tab (the connector's `set_artefact_data`), a tab must not
  act on a stale copy. The shell owns this discipline, and the pin never lives in the frame
  (AD10):
  - a flush sends **only when the artefact changed something** since the last save — an open,
    idle tab never writes (hiding or closing it sends nothing);
  - each `PUT` is conditioned on the `updatedAt` the tab last knew — `If-Match:
    "<updatedAt>"`, or `If-None-Match: *` when it was seeded with no entry — seeded
    server-side with the blob and advanced by each successful save's response;
  - saves never overlap (an edit made while one is in flight goes out after it, with the new
    pin), except the forced `pagehide` flush;
  - a **412** means the data was replaced since the tab loaded: the shell **stops writing** (the
    artefact keeps running on its in-memory copy, so it doesn't break) and shows a banner
    offering a reload, which mints a fresh frame URL and re-seeds the latest data. A tab can
    therefore never silently revert a newer write. The residual losses: a change still inside
    the shim's debounce window when the tab closes or the viewer switches data context (the
    shell is gone, or no longer in the viewer's own context, when it arrives), and unsaved
    edits when the tab is closed right after a conflicting write (the shell's keepalive
    response can't be acted on).
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
toolbar that wraps an `<iframe>` loading the artefact from `/a/:slug/frame`). Since S36 the
frame URL carries a short-lived **frame token** that names the context (AD10); the `?author=<id>`
query parameter is gone. Switching author asks the BFF for a new tokened frame URL, and an
expired token makes the frame ask the shell to mint a fresh one.
The shell is server-rendered rather than part of the Svelte SPA because `/a/:slug` is the
shareable link and must also serve unauthenticated/public viewers, who never
load the SPA. The **host tools** — the data-context picker, and any future toolbar widgets —
live in a **signed-in-only** wrapper: an anonymous public viewer gets the title bar + artefact
only, never the switcher. (This is a host-UI choice, not an access rule: the `…/authors` /
`…/:authorId` endpoints stay **not** `requireAuth`-gated, so AD4 — anonymous *may* read a
`public` artefact's data — still holds at the API; the switcher just isn't surfaced to them.)
For a signed-in viewer the picker itself still only appears when there's another context to
switch to (S20). The switcher lists only the authors AD11 lets the viewer load: under `own`, a
non-owner's list holds at most their own entry, so the picker stays hidden for them. Only the
viewer's *own* context is seeded writable; any other author is read-only (AD5).

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
- **The agent may write its own blob, whole (S31).** `set_artefact_data` is the same
  whole-blob upsert as `PUT …/data/me`, transformed agent-side, optionally pinned against a
  prior read (`DataConflict`). Merge-patch stays dropped; another author's entry is never
  writable.
- **The owner's agent may read any author's blob, never write it (S40).**
- **Owners choose whether viewers see each other's data; new artefacts default to own-only
  (S41).**

## Amendment (post-v0.2) — payload version pin

> **Status:** **implemented** (FDD slice **S19a — Data version pin**; the AH15 retention seam is
> the separate slice **S19b — Payload-retention seam**). A small **additive** field on `DataEntry` —
> harmless in OSS, and the hook a
> superset's rollback uses to judge data compatibility. It does not weaken opacity.

**Problem.** A `DataEntry.blob` is shaped by whatever artefact payload was live when it was
written. When the payload later changes shape — edited in place, or (in the superset) rolled
back — previously-saved data may no longer match. The backend can't fix this (the blob is
opaque, AD8), but it *can* record **which payload version the data was written against** so the
host can detect the mismatch.

**Field.** `DataEntry` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `authoredAgainstVersion` | ContentHash \| null | The artefact's **payload content hash** at the moment of the (upsert) write, re-stamped on every write. `null` for entries written before this field existed (no backfill — which payload they were written against is unknowable). Opaque — it names a payload, never describes the blob. |

**AD9 — pin on write.** Every write through `putOwnDataEntry` — `PUT …/data/me` (the served
shim) and, identically, the connector's `set_artefact_data` (S31) — sets
`authoredAgainstVersion` to the artefact's *current* payload content hash. There is no
connector-specific path. It is **advisory metadata only**: it never gates a read or write
(AD3–AD5 unchanged), and the backend still never interprets the blob (AD8 holds). Because it is
a **content** hash, an edit that restores byte-identical HTML makes an older pin current again.
That is correct, since the blob matches that HTML. The pin is not exposed on the BFF
`DataEntryResponse` or the S12 author list; today only the connector's snapshot read consumes it.

**Use.**

- **OSS:** even with a single mutable payload, the host can tell whether a viewer's saved data
  **predates the current payload** (pin ≠ current hash) — a sharper form of the `dataAuthorCount`
  breaking-change signal already exposed to the MCP connector. **S30 reserved this field
  without depending on it**: the snapshot read returned the pair (`currentPayloadVersion`,
  `authoredAgainstVersion`) with the pin `null` before this slice existed. That was sound
  precisely because AD9 is advisory and gates nothing. S19a populated the pin with no change to
  the tool's shape and no rewrite of the doctrine written against it (`null` ⇒ no entry, or one
  that predates the pin: unknown, so treat it as possibly stale; ≠ current ⇒ written against
  older HTML, migration owed; = current ⇒ matches what is deployed).

  Do not conflate this pin with the **declared schema's** `version` (see "Declared data schema"
  above): this one is mechanical and backend-set, that one semantic and author-set.
- **Superset (history / rollback):** before serving an old or rolled-back version, compare the
  seeded entry's pin to the target version to decide whether the data is compatible (seed it, or
  warn / seed cautiously). This is the **pin-for-compatibility** decision — there is deliberately
  **no co-snapshot of data and no data time-travel** (continuous per-write data is a different
  cadence from discrete payload versions; out of scope).

## Amendment (post-v0.2) — persistence through the host shell

> **Status:** DDD amendment (FDD slice **S36**; with Artefact Hosting AH28 and Identity & Access
> IA6). AD1–AD9 are unchanged: the shell's `PUT …/data/me` is the same `putOwnDataEntry`, so
> writes stay own-entry (AD2/AD5), authenticated (AD3), opaque (AD8), stamped (AD9) and pinned
> (S31).

**Problem.** The served shim wrote with `fetch(…, { credentials: "same-origin" })`, which only
works while the artefact runs in the app origin with the viewer's session — the very exposure
AH28 removes.

**AD10 — the served shim persists through the host shell, never the API; seeding is
authenticated by a frame token, never by cookies inside the frame.**

- **Frame → shell.** The shim keeps the synchronous seeded map, `QuotaExceededError` over
  `MAX_BLOB_BYTES` and throw-on-write in a read-only context. On a change (debounced) and on
  `pagehide` / `visibilitychange: hidden` with a change still unposted, it posts
  `{ type: "artefactor:data-changed", blob }` to `window.parent` with `targetOrigin` = the app
  origin. An idle tab posts nothing. It never calls `fetch`.
- **The shell decides.** It accepts a message only when `event.source === frame.contentWindow`
  (there is no origin to check: the frame's is `"null"`), only when the message carries the
  **channel** of the frame URL the shell loaded, and only while its context is the viewer's own
  (signed in, no author selected). The endpoint is fixed by the shell: a message
  never chooses the artefact, the author or the URL. The shell posts nothing to the frame, and
  the frame receives no data it wasn't already seeded with.
- **Channel — a message is bound to a document, not to a window.** `event.source` names the
  browsing context: a sandboxed frame may navigate itself, and whatever it navigates to keeps the
  same `WindowProxy`. So each frame token also derives a **channel** (HMAC under its own label),
  inlined in that document's shim config and returned to the shell with the frame URL that minted
  it. The shell saves a change only when the message carries the channel of the frame URL it
  loaded, so a page the frame navigated itself to cannot forge one: frame responses are
  `Referrer-Policy: no-referrer`, so neither the frame URL nor its token travels with the
  navigation. A re-mint (author switch, conflict reload, expiry) replaces the channel, so the
  previous document can no longer save. An anonymous, token-less frame has no channel; it is
  read-only and never posts.
- **Frame token.** A stateless HMAC-SHA256 token (key derived from `BETTER_AUTH_SECRET` under its
  own label, so it is never the session key), base64url, with claims `artefactId`, `route`
  (`slug` | `raw`), `viewerId` (or null), `authorId` (null = the viewer's own context), `exp`,
  and, on a `raw` token, the `tenantId` the owner-preview read was scoped to. It lives
  **5 minutes** and is reusable within them.
- **Mint.** The shell's server render (`/a/:slug`, `/api/artefacts/:id/raw`) embeds a first
  tokened frame URL for a signed-in viewer; an anonymous viewer gets a token-less one.
  `POST /api/artefacts/:ref/frame-token` (signed in; `:ref` = slug or id; body
  `{ author?: string }`) returns `{ frameUrl, channel, seedUpdatedAt }` for switching author or
  refreshing. A slug ref is gated by the access matrix like `…/data/authors` and mints a `slug`
  token; an id ref is the owner preview, gated like `/:id/raw` (own, active, in scope), and
  mints a `raw` token. Anything else is a flat 404 (AH8).
- **Redeem.** A frame route authenticates only from `?t=`. It verifies the signature and `exp`,
  that the token's `artefactId` and `route` match the URL, then re-runs the route's own access
  check for `viewerId` (the matrix for `slug`, own-active for `raw`), so a revocation is
  effective immediately. Seed = `authorId ?? viewerId`; writable = `viewerId !== null &&
  authorId === null`.
- **No token:** the slug frame serves the anonymous read-only view when the matrix admits an
  anonymous viewer, else 404; the raw frame is 404. **Invalid** (bad signature, wrong artefact or
  route): 404. **Expired:** a sandboxed page that seeds nothing and posts
  `{ type: "artefactor:frame-token-expired" }` to its parent; the shell (same `event.source` rule)
  mints a fresh URL for its current context and reloads the frame, which is what keeps an
  in-artefact `location.reload()` working after five minutes.

A token in a frame URL, and the channel derived from it, are readable by the artefact it seeds.
They grant nothing that artefact didn't already hold: the seeded data of that one context, for five
minutes, read-only unless it is the viewer's own — and writing its own entry is what the shim does
anyway.

## Amendment (post-v0.2) — Owner-set data visibility

> **Status:** DDD amendment (FDD slice **S41 — Owner-set data visibility: shared or own-only**;
> with Artefact Hosting AH30). Narrows AD4 only. AD2, AD3, AD5 and AD8 are unchanged: writes
> stay own-entry, authenticated and opaque.

**Problem.** Under AD4 anyone who may view an artefact may list every author holding data and
load any author's blob, including the anonymous on a `public` artefact. For a survey or form,
every respondent can read every other respondent's answers, and the owner cannot turn it off.

**AD11 — owner-set data visibility narrows AD4.** An artefact's `dataVisibility`
(`artefact-hosting.md` AH30) is `shared` or `own`:

- Under `shared`, AD4 holds unchanged.
- Under `own`, a viewer the matrix admits may load **another** author's entry only if they are
  the artefact's owner.
- A viewer's own entry, and the owner's reach, are identical under both settings.

One pure predicate decides it, beside the access matrix:

```text
canLoadAuthorData(artefact, viewerId, authorId) =
  (viewerId ≠ null ∧ authorId = viewerId) ∨ viewerId = artefact.ownerId ∨ artefact.dataVisibility = shared
```

`viewerId` is null for the anonymous, whose "own author" never exists. AD11 is evaluated **after**
the matrix admits the viewer — like the link gate (AH22) — so it only ever narrows AD4 and never
admits anyone the matrix denies. It is enforced at four points:

1. **`GET …/data/authors`** lists only the authors the predicate admits: under `own`, a non-owner
   gets their own entry or `[]`. It never refuses the list itself.
2. **`GET …/data/:authorId`** — a refused author is a 404.
3. **`POST …/frame-token { author }`** — a refused author is a 404.
4. **Frame redemption** (AD10) re-runs the predicate on the token's `authorId`: a refusal is a
   404, so a flip to `own` takes effect on the next frame load, even for a token minted before it.

A refusal is a flat 404 — the body of any other not-found — and it depends only on who is asking
about whom, never on whether that author holds an entry, so probing author ids reveals nothing
(AH8's no-leak spirit).
