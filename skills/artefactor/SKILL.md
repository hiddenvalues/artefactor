---
name: artefactor
description: Use when building, publishing, or updating an HTML artefact for Artefactor — prototypes, forms, slide decks, interactive documents, trackers, and similar self-contained HTML deliverables. Covers two things: (1) publishing/updating/sharing artefacts via the Artefactor MCP connector, and (2) writing the HTML so its data persists correctly (Artefactor hijacks localStorage to a server-side store). Trigger whenever the user asks to publish/host/share an artefact on Artefactor, OR when an HTML artefact needs to remember data — i.e. you reach for localStorage, IndexedDB, cookies, or "save"/"export"/"remember my answers" behaviour in a standalone HTML file.
---

# Building and publishing artefacts for Artefactor

**Artefactor** hosts self-contained HTML artefacts (prototypes, forms, slide decks,
interactive docs) and serves them to viewers. This skill covers the two things you need to get
right when you make one:

1. **Publishing** it — via the Artefactor MCP connector (create / update / share / manage).
2. **Persistence** — writing the HTML so any data it saves survives, because Artefactor gives
   standalone artefacts **server-side persistence for free** *if* you save data the right way.

You can do either independently: write a persistent artefact for manual upload, or publish via
the connector. When you do both, write the HTML following the persistence rules, then publish.

## Publishing & managing artefacts (the MCP connector)

If the user has connected the **Artefactor MCP connector** (in claude.ai / Claude design), you
can publish and manage artefacts directly — no manual upload. The connector authenticates **as
the user** (OAuth), so everything you create is owned by them. Tools:

- **`create_artefact`** `{ title, kind, html, visibility? }` — publish a self-contained HTML
  document. `kind` is one of `prototype | slide-deck | form | interactive-doc | other`.
  `visibility` is `private` (default) | `authenticated` | `public` | `selected`. Returns the
  artefact id, slug, and share URL (when shared).
- **`update_artefact`** `{ id, title?, kind?, html? }` — replace fields on an artefact you own.
  `html` is a **full replacement**, not a patch — send the whole document.
- **`list_artefacts`** `{ include_archived? }` / **`get_artefact`** `{ id }` — find what the user
  already has (use these before creating a duplicate; update in place when iterating). Archived
  artefacts are hidden from the list unless you ask for them. `get_artefact` returns
  **`dataAuthorCount`** — how many users have saved data in this artefact.
- **`get_artefact_html`** `{ id }` — the artefact's **stored HTML**, exactly as served, plus
  `dataAuthorCount`. Use it to derive a new artefact from an existing one, or to re-read an
  artefact before updating it when you no longer have the source (`update_artefact` replaces the
  HTML wholesale, so you need the current document to change it safely).
- **`get_artefact_data`** `{ id }` — **your own** saved data for the artefact, verbatim, plus
  the shape the artefact **declares** for itself. Read it before any change to the data shape.
  Returns `blob` (your entry, `null` if you have none), `bytes`, `updatedAt`, `schema` (the
  declared block below, or `null`), `dataAuthorCount`, and the version pin pair
  `currentPayloadVersion` / `authoredAgainstVersion`.
- **`set_artefact_data`** `{ id, blob, if_unmodified_since? }` — **replace** your own saved data
  for the artefact. **Whole-blob replacement: not a patch, nothing is merged — any key you leave
  out is deleted.** Returns `{ id, bytes, updatedAt }`. See "Editing the user's saved data" below
  before using it.
- **`set_visibility`** `{ id, visibility }` / **`archive_artefact`** / **`restore_artefact`** —
  manage sharing and lifecycle. An artefact the user has filed in a collection takes its
  visibility from that collection, so `set_visibility` refuses it — say so rather than retrying.
- **`get_authoring_guide`** — returns this guide. If you're working through the connector
  without this skill loaded (e.g. in Claude design), call it before writing artefact HTML to
  get the persistence contract, template, and checklist below.

Every tool works on the user's **own** artefacts only — an unknown id and someone else's
artefact both come back as "not found", and the data tools reach no author's entry but the
user's. An **archived** artefact is out of reach the same way: `restore_artefact` brings it back;
every other tool refuses it until you do.

Both read-back tools **refuse** a result too large for a tool call (roughly 1 MB of HTML,
256 KB of data) rather than truncating it — truncated HTML can't be edited and truncated JSON
can't be parsed. When that happens, the user can get the file from the Artefactor web app:
**"Download HTML"** in an artefact's ⋯ menu returns the stored document byte-for-byte, so
download → edit → re-upload round-trips.

**Typical flow:** write the HTML following the persistence rules below → `create_artefact` →
share via `set_visibility` (or by passing `visibility`). When the user says "update the X
artefact", prefer `list_artefacts`/`get_artefact` + `update_artefact` over creating a new one.

### Two publishing paths — and why raster images decide which

An artefact can reach Artefactor two ways, and **embedded raster images** (PNG/JPEG photos or
screenshots — whether as base64 `data:` URIs or binary) are the deciding factor:

- **Path A — publish via the connector** (`create_artefact` / `update_artefact`). You send the
  HTML directly through the tool call. This works **only for artefacts with no embedded raster
  images.** You **cannot reliably emit base64 image bytes through a tool argument** — even a few
  KB won't reproduce losslessly — so pushing an image-bearing artefact this way **truncates or
  corrupts it.** Everything authored as text is fine: HTML/CSS, **inline SVG**, CSS-drawn
  graphics, charts, diagrams. **Most artefacts qualify** (forms, prototypes, slide decks,
  interactive docs), so path A is the common case.
- **Path B — manual upload.** The human downloads the finished self-contained HTML file and
  uploads it through the Artefactor web app — open the **Upload** dialog and drag-drop (or pick)
  the single `.html` file, set its title and kind. (The same dialog also replaces the HTML of an
  existing artefact.) This is the path for artefacts that **must** contain real raster images.

**When an artefact needs images, do not silently push it via the connector.** Stop and give the
human an explicit choice:

1. **Recreate the visuals as SVG/CSS** — vector, sharp at any size, tiny, and fully
   text-authorable — so the artefact can be published via the connector (**path A**). Prefer this
   for chrome, diagrams, icons, logos, and UI frames.
2. **Keep the images as base64-embedded raster** (the artefact stays a single self-contained HTML
   file). Then it must go via **path B**: provide the finished HTML file for the human to download
   and upload manually. Use this when the real pixels matter (photographs, actual screenshots).

### Editing the user's saved data (`set_artefact_data`)

The per-user data blob is the artefact's own runtime state (what it reads/writes via
`localStorage`), and Artefactor keeps it **opaque** — the backend never reads, merges, or
migrates it. But **you** can change the user's own blob on their behalf ("add these six rows to
my tracker", "reset last quarter", "fix the typo in every entry"): read the whole blob, transform
it yourself, write the whole blob back. Only ever **your own** entry — other users' data is
never readable or writable through the connector. The blob is a JSON object mapping
`localStorage` keys to **string** values (e.g. `{"habit-tracker-v2": "{\"habits\":[…]}"}`).

The write is **destructive and irreversible** — there is no versioning and no undo. So:

1. **Read before write, always.** Call `get_artefact_data` first. Send back the **full**
   transformed blob — every key, not just the one you changed — and pass the `updatedAt` you
   read as `if_unmodified_since` (`null` if the read returned no entry). Having the artefact
   open in a browser is fine and expected — an open tab only saves when the user actually
   changes something in it. So a refused write means the user **really edited their data** in
   the moments between your read and your write: nothing was stored; re-read, re-apply your
   change to the new blob, and write again. Don't drop the pin to force it through — that would
   discard what they just did.
2. **Use the declared schema, then verify.** `schema` (and its `example`) is your orientation —
   and it is what makes a write possible at all when the user's blob is still empty, the common
   case for an artefact they've just been given. But a declaration can be stale: before writing
   a shape you took from the schema rather than one you have actually seen in a blob, confirm it
   against `get_artefact_html`. A blob the HTML can't parse leaves the user with a broken
   artefact.
3. **Check the pin before deciding the shape is current.** If `authoredAgainstVersion` differs
   from `currentPayloadVersion`, the blob you read was written against **older HTML** — transform
   it to the shape the live payload expects instead of writing it back in the shape you found.
   `null` means unknown: treat it as possibly stale and verify against the HTML.
4. **Keep the pre-write blob** in the conversation, so you can revert on request by writing it
   back.
5. **Say what will change before writing** — in plain terms ("adds 6 rows to Q3, leaves
   everything else as is"), not just an approval prompt for an opaque tool call.
6. **After writing, tell the user to reload** the artefact if they have it open. An open tab
   keeps showing the data it loaded; it won't overwrite your change (if they edit in it, its
   save is refused and Artefactor shows a "changed elsewhere — Reload" banner), but they only
   see your change after a reload.

To clear the data, write `{}`. The tool can't write a blob over 5 MB or one that isn't valid
JSON; both errors say why.

### Updating an artefact that already has saved data (breaking changes)

`update_artefact` replaces the HTML but **leaves existing data blobs untouched** — the backend
won't (and can't) migrate them; the data is opaque to it. So if your new HTML expects a
**different data shape** than the old one, returning users' saved data may be misread.

Before a shape-changing update: check `dataAuthorCount`, and call **`get_artefact_data`** to
see the shape actually saved. Then pick one of three, in this order:

- **Migrate forward (preferred).** Ship migration code *in the new HTML*: read the old key,
  transform it, write the new one. This is the only place a migration **can** live — a
  server-side migration would mean parsing the blob, which the backend never does. Each user's
  data migrates on their next visit. Write it so it is:
  - **idempotent** — safe to run on every load, including when it already ran;
  - **run at load, before first render**, so nothing renders against the old shape;
  - **non-destructive** — leave the old key in place for one generation, and never `clear()`.
- **Bump the storage-key version** (`my-artefact-v1` → `my-artefact-v2`) **without** migrating.
  Old data is simply ignored — which means every user **silently loses** what they saved.
  Only do this when you know the saved data is disposable, and say so to the user.
- **Publish a new artefact** (`create_artefact`) — a clean "v2" with its own id, link, and
  data — when you want to keep the old one intact for existing users.

Non-breaking edits (copy, styling, bug fixes, additive fields your code already tolerates) are
safe to `update_artefact` in place.

**The snapshot is one blob, not the population.** `get_artefact_data` returns the data of the
user you are acting for; `dataAuthorCount` tells you how many *other* people also hold data,
and you never see theirs. Their blobs may sit on older key versions, be partial, or have been
written by HTML two revisions back. So write the migration to tolerate shapes you never saw —
absent, partial, or of an unknown version — and never assume the one blob you read is
representative.

**The pin is the per-user staleness signal.** `dataAuthorCount` says *some* users hold data;
comparing `authoredAgainstVersion` with `currentPayloadVersion` says whether *this* entry
predates the live payload:

- `null` ⇒ unknown — treat as possibly stale;
- ≠ `currentPayloadVersion` ⇒ definitely written against older HTML, migration owed;
- = `currentPayloadVersion` ⇒ matches what is currently deployed.

(The pin is backend-set and mechanical — "written against payload X". The `version` in the
declared schema below is author-set and semantic — "this HTML expects shape v2". They answer
different questions; keep both.)

### Declaring your data shape

Declare the shape your artefact saves, in an inert block in the HTML, so the shape is knowable
without reading all the code and without anyone's data being populated:

```html
<script type="application/artefactor-schema+json">
{ "key": "habit-tracker-v2",
  "version": 2,
  "description": "All tracker state under one key.",
  "example": { "habits": [ { "id": "h1", "name": "Run", "done": ["2026-09-01"] } ],
               "settings": { "week_start": "mon" } } }
</script>
```

The browser ignores an unknown script `type`, so the block does nothing at runtime, and it
lives in the HTML — so it travels with a download/re-upload automatically. `get_artefact_data`
returns it as `schema`.

- **The `example` is the centrepiece.** Someone facing an empty blob needs a populated
  exemplar, not a type list. Use **invented values only** — never real user data: the block
  ships inside an artefact that may be downloaded or made `public`. One or two items, a couple
  of KB at most.
- **`version` is what makes migrate-forward checkable** — compare the deployed artefact's
  declared version with the one you are about to publish to know whether a migration is owed.
- **Write the schema and the code in the same breath.** Nothing enforces that they agree, and a
  stale schema produces a *confident* wrong migration — worse than inference, which at least
  fails visibly. So: trust the schema for orientation, and **verify it against the HTML before
  any shape-changing write**. It also says nothing about the population — users on older
  versions are still out there, so the "tolerate shapes you never saw" rule stands regardless.

## Persisting data (localStorage)

When Artefactor serves your artefact, it **replaces `window.localStorage`** with a shim backed
by a store on the server. From your artefact's point of view there is exactly **one set of
data** — the same mental model as plain `localStorage`. You read it and write it; you never
manage who it belongs to.

- Reads are **synchronous and instant** — the server seeds the saved data into the page before
  your script runs, so `localStorage.getItem(...)` returns the saved value on first paint.
- Writes (`setItem`/`removeItem`/`clear`) save to the backend automatically, debounced, with a
  flush when the page is hidden/closed.
- Sometimes the loaded data is **read-only** and writes are rejected. That decision is made by
  Artefactor *outside* your artefact — your code must simply tolerate a failed write (see rule
  3). You never detect or control this yourself.
- Opened as a plain file (no Artefactor), the **native** `localStorage` is used — same code,
  still works.

**The golden rule: just use the standard `localStorage` API.** Don't write your own
`fetch`/network code to save data, and don't use other storage mechanisms — only
`localStorage` is hijacked. Get `localStorage` right and persistence is automatic.

### Rules

1. **Persist only through `localStorage`.** Not IndexedDB, not cookies, not `sessionStorage`,
   not a backend you call yourself — none of those are backed by Artefactor's store.
   sessionStorage, IndexedDB and cookies are never saved, and in Artefactor's sandboxed frame
   they throw. Don't use them, even for temporary state; keep temporary state in memory.
   Beware libraries that silently use IndexedDB — Dexie, localForage, idb-keyval,
   y-indexeddb — they fail the same way. The artefact also can't navigate the top page: a link
   targeting it (`target="_top"`, `target="_parent"`) does nothing, so open links with
   `target="_blank"`.

2. **Keep one JSON object under one (versioned) key.** Serialize your whole state to a single
   object and store it as JSON. Version the key so you can migrate later.

   ```js
   var STORAGE_KEY = "my-artefact-v1";
   localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
   var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
   ```

   (Multiple keys also work — the whole localStorage namespace is saved — but one object is
   clearer and easier to version.)

3. **Always wrap storage access in try/catch and degrade to in-memory.** A save can fail and
   that must never break the artefact. Cases you must tolerate:
   - opened as a bare file with storage disabled / private mode;
   - Artefactor has loaded the data **read-only**, so writes are rejected;
   - the 5 MB budget is exceeded (throws `QuotaExceededError`).

   ```js
   function save(state) {
     try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
     catch (e) { /* keep working in memory; optionally show a subtle "not saved" hint */ }
   }
   ```

4. **Stay under 5 MB total.** That is the storage budget (and a normal localStorage budget).
   Don't stuff large base64 images/files into saved state — keep those in the HTML itself or
   reference them by URL.

5. **Debounce frequent writes.** For things like typing in a textarea, debounce ~300–500 ms
   before saving. It keeps the artefact snappy and avoids hammering the store.

6. **Don't depend on `storage` events or cross-tab sync.** The shim doesn't guarantee them.

### Recommended template

```html
<script type="application/artefactor-schema+json">
{ "key": "my-artefact-v1",
  "version": 1,
  "description": "What this artefact saves.",
  "example": { "items": [], "settings": {} } }
</script>
<script>
(function () {
  "use strict";
  var STORAGE_KEY = "my-artefact-v1";   // name-it + version it; keep in step
                                        // with the declared schema above
  var OLD_KEY = null;                   // set to the previous key when you bump

  migrate();                            // before anything renders
  var state = load() || defaultState();

  function defaultState() { return { /* your initial shape */ }; }

  // Idempotent forward migration: only runs when the new key is empty and the
  // old one has something. Never removes the old key -- one generation of
  // overlap costs nothing and makes a bad migration recoverable.
  function migrate() {
    if (!OLD_KEY) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;      // already migrated
      var old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
      if (!old) return;                                   // nothing to carry over
      localStorage.setItem(STORAGE_KEY, JSON.stringify(upgrade(old)));
    } catch (e) { /* unreadable/unwritable -> start fresh, never throw */ }
  }

  // Tolerate shapes you never saw: absent, partial, or an unknown version.
  function upgrade(old) { return old; /* map old fields onto the new shape */ }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (e) { return null; }                 // storage unavailable -> in-memory
  }

  var t = null;
  function saveSoon() {                         // debounce writes
    if (t) clearTimeout(t);
    t = setTimeout(save, 400);
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* read-only / quota / disabled -> keep working in memory */ }
  }

  // ... wire UI: on change -> mutate `state` -> saveSoon()
  // flush is handled by Artefactor on page hide; calling save() on submit is fine too.
})();
</script>
```

### Checklist before shipping an artefact

- [ ] All persistence goes through `localStorage` only.
- [ ] State is one JSON object under one **versioned** key.
- [ ] Every `getItem`/`setItem` is in try/catch with an in-memory fallback.
- [ ] The artefact still works when a save fails (file mode, read-only, quota).
- [ ] Saved state stays well under 5 MB (no big base64 blobs).
- [ ] Frequent writes are debounced.
- [ ] The artefact declares its data shape in an `application/artefactor-schema+json` block,
      with an invented (never real) `example`.
- [ ] The declared schema agrees with the code — same key, same version, same shape.
- [ ] If publishing via the connector: chose the right `kind` + `visibility`, and on a breaking
      data change read `get_artefact_data` first and shipped a forward migration (rather than
      silently bumping the key, which discards every user's saved data).
- [ ] If editing the user's data with `set_artefact_data`: read first, sent the **whole** blob
      pinned with the read's `updatedAt`, verified the shape against the HTML, kept the old blob,
      told the user what changes, and afterwards asked them to reload any open tab.
