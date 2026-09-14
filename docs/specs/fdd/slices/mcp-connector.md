# MCP connector

### S18 — MCP connector (remote MCP server + OAuth)
- **Status:** done
- **Depends on:** S2, S3, S4, S5, S7, S10

S18's tools wrap the existing Hosting commands, including the S4 single-artefact read and the
S10 owner list.
- Artefactor exposes a **remote MCP server** at `POST /mcp` (Streamable HTTP) that Claude
  (claude.ai / Claude design) connects to as a custom connector. *(IA 2)*
- **OAuth 2.1** via BetterAuth's `mcp` plugin: discovery (`.well-known/oauth-*`), dynamic
  client registration, authorization-code + consent, bearer-token access. A request without a
  valid bearer → `401` with the protected-resource descriptor. *(IA 2, 3)*
- Every tool call is **attributed to the token's Account** and enforces the *same* domain
  invariants as the UI (access matrix, ownership) — the MCP layer is a thin adapter over the
  existing Hosting commands, adding no new authority. *(AH 9)*
- **Tools:** `create_artefact`, `update_artefact`, `list_artefacts`, `get_artefact`,
  `set_visibility`, `archive_artefact`, `restore_artefact`, and `get_authoring_guide`. There is
  **no data-write tool** (opacity, above). `get_artefact` / `update_artefact` return
  **`dataAuthorCount`** so the model can warn before a breaking data-shape change and suggest a
  versioned key or a new artefact. Update never deletes data blobs; it only replaces the HTML
  payload.
- **The connector self-describes its authoring contract**, because connector-only clients (e.g.
  Claude design) cannot load the `artefactor` Agent Skill. Two channels carry it: the MCP
  server's **`instructions`** (returned in `initialize` — ambient, present *before* any tool
  call, so the model has the persistence contract while it is still authoring the HTML) carry a
  compact summary, and the **`get_authoring_guide`** tool returns the full
  `skills/artefactor/SKILL.md` body on demand. Both derive from that one skill file
  (`src/server/mcp/authoring-guide.ts`; the Dockerfile copies `skills/` into the runtime image).
- **Two publishing paths, because a model cannot carry binary through a tool call.** *Path A* —
  push HTML via `create_artefact`/`update_artefact` — works only for artefacts with **no embedded
  raster images** (base64 image bytes can't be emitted reliably in a tool argument; they
  truncate/corrupt). This is the common case (forms, prototypes, slide decks, interactive docs;
  HTML/CSS/SVG are fine). *Path B* — the human downloads the self-contained HTML and uploads it
  via the **S2/S3 manual upload UI** (`UploadModal.svelte`) — is the path for artefacts that need
  real raster images. The `instructions` + skill tell the model to stop and offer the human a
  choice (recreate visuals as SVG/CSS → Path A, or keep base64 raster → Path B) rather than
  silently pushing a broken artefact. Both paths run the same create/edit commands, so invariants
  are identical.
- A companion **skill** (`skills/artefactor`) teaches Claude both to publish/update/share via
  the connector and to write HTML that persists through the localStorage hijack (keep in sync
  with `ddd/artefact-data.md`, the tools in `src/server/mcp/`, and the `instructions` summary in
  `src/server/mcp/authoring-guide.ts` — same no-drift rule as specs).

### S30 — Export artefact HTML (GUI download + MCP read-back tools)
- **Status:** done
- **Depends on:** S2, S4, S6, S11, S18
- **Optional:** S19a

(AH7/AH8/AH9 for the export read path; AD2/AD4/AD8 for the
data snapshot.) Artefactor could take HTML in but never give it back: the client had no
download affordance, and an agent on the connector could `create`/`update` an artefact but
never *read* one — so it could neither derive a new artefact from an existing one (A) nor
safely update one in place after losing the original from context (B). (B) is a correctness
problem: `update_artefact` replaces the HTML and leaves every per-user data blob untouched,
and the backend treats blobs as opaque (AD8), so it cannot migrate them.

- **Domain** — `extractDeclaredSchema(html)`: a pure, best-effort lift of the artefact's
  **declared data schema** block (below) from its trusted HTML. Absent/malformed/non-object
  → `null`, never an error. A payload *convention*, never enforced.
- **Shared** — `artefactFilename(title, fallback)` + `attachmentDisposition(filename)`: pure
  download-naming helpers (slugify, bound, ASCII-fold, RFC 5987), unit-tested on their own.
- **BFF** — `GET /api/artefacts/:ref/download` (`:ref` = slug **or** id). Resolution and
  access reuse `resolveViewableArtefact`, so effective-tier resolution through a collection
  root (AH20) and the `AccessPolicy` cell (AH18) are **inherited, not re-implemented**. Body
  = `PayloadStore.get(payloadRef)` **verbatim** — no S13 bootstrap, no S12 host shell, so the
  download round-trips (download → edit → re-upload / `update_artefact` yields the same
  artefact). `Content-Type: text/html; charset=UTF-8`; `Content-Disposition: attachment` with
  both `filename` and `filename*`; `Content-Length` = `payloadBytes`. Unknown ref /
  not-viewable / **archived** → flat 404.
- **MCP** — `get_artefact_html { id }` → `{ id, title, kind, html, dataAuthorCount }`;
  `get_artefact_data { id }` → `{ id, blob, bytes, updatedAt, dataAuthorCount, schema,
  currentPayloadVersion, authoredAgainstVersion }` — the caller's **own** entry only, verbatim
  via `getOwnDataEntry`, with no server-side summarising or key/type digest (that would be the
  backend interpreting the blob). Both owner-scoped via `loadOwnActiveArtefact`. Each
  hard-errors above its cap (`MAX_MCP_HTML_BYTES` ≈ 1 MB, `MAX_MCP_BLOB_BYTES` ≈ 256 KB),
  naming the real size and pointing at the GUI download — **no truncation**: truncated HTML is
  unusable for editing and truncated JSON unparseable, and either invites the agent to act on
  a fragment as though it were whole.
- **Doctrine** — `skills/artefactor/SKILL.md` + `PERSISTENCE_CONTRACT_SUMMARY`: **migrate
  forward** now leads the breaking-change guidance (read old key → transform → write new;
  idempotent, at load before first render, old key kept one generation, never `clear()`), the
  snapshot is one blob and not the population, and the schema block joins the template +
  checklist. Bumping the key without migrating is named for what it is — silent data loss.
- **Client** — "Download HTML" in `MoreMenu` (reaching `ArtefactRow` + `ArtefactCard`), owned
  artefacts only. A plain anchor: session-cookie auth needs no fetch/blob dance.
- **Acceptance:** owner downloads own artefact by id at any visibility, byte-identical to what
  was uploaded; viewer downloads a shared artefact by slug; anonymous downloads a `public` one;
  private-to-a-non-owner, **archived (including for the owner)**, and unknown ref all 404; both
  `Content-Disposition` forms present and `Content-Length` = `payloadBytes`; no bootstrap or
  shell in the body; filename helper covers ASCII / non-ASCII (åäö) / symbol-only (falls back
  to slug-or-id) / 300-char (bounded) / always `.html`. `get_artefact_html` returns the exact
  stored HTML with `dataAuthorCount`; `get_artefact_data` returns the caller's own blob
  verbatim, `blob: null` when they have none, never another author's; over-cap on either →
  error naming the actual size; non-owner / unknown / archived / out-of-scope → not found;
  `schema` is parsed JSON when present and `null` when absent, malformed, or not valid JSON —
  **never** an error; a blob is never validated against a declared schema (AD8 holds); an
  artefact with a declared schema survives export → re-upload intact; `currentPayloadVersion`
  equals `payloadHash`, and `authoredAgainstVersion` is present with its shape asserted (its
  value was `null` until **S19a — Data version pin**, whose own acceptance now covers the
  populated value).
- **Archived stays inert (AH7)** — no owner carve-out. Restore → download → re-archive is one
  click, which is not worth an exception in AH7 for an escape hatch.
- **On S19a/AD9 — reserve, don't depend.** `get_artefact_data` returns the version-pin **pair**
  but S19a is **not** a hard dependency edge (only `Optional`), and the missing edge is deliberate, not an oversight:
  AD9 is *advisory by spec* and never gates a read or write, so nothing here is incorrect while
  the pin is `null`; and the pin was first specced together with the unrelated AH15
  `PayloadRetentionPolicy` port in the edit command (now S19b), which read-back has no business
  pulling in. `currentPayloadVersion` is free
  today (`payloadHash` is already on the aggregate). When S19a lands, the pin populates with
  **no tool-shape change and no doctrine rewrite** — the rule "pin present and ≠ current ⇒ that
  user's data predates this payload" is written now and becomes true then. *(Borne out: S19a
  shipped on its own, ahead of S19b, as a one-line change to this tool.)*
- **Out of scope:** the download affordance for "shared with you" (`GalleryCard`/`GalleryRow`)
  and the `/a/:slug` shell toolbar (the endpoint already honours the matrix — widening is
  client-only); baking a data snapshot into the downloaded file; any data **write** tool (S31);
  a per-artefact "allow download" toggle (new field + invariant + migration, and defeated by
  view-source anyway).
- **Boundary:** **OSS**. No schema change.

### S31 — Agent edits data: `set_artefact_data` MCP tool
- **Status:** done
- **Depends on:** S11, S18, S30
- **Optional:** S19a
- **Linear:** ALI-268

(AD1/AD2/AD3/AD6/AD8; AH7.) A user's saved data could only change by
opening the artefact and editing by hand. With the S30 snapshot read, an agent can close the
loop: read the whole blob, transform it in the session ("add these six rows", "reset last
quarter"), write the whole blob back.

- **Not S17.** The dropped merge-patch put the merge in the backend (parsing the blob, breaking
  AD8). S31 transforms **agent-side** and writes through the existing `putOwnDataEntry`, which
  parses only to enforce AD8 — the server still never interprets the blob. See "Connector write
  (S31)" in `ddd/artefact-data.md`.
- **Domain / command** — `DataConflict` (new `DataError`). `putOwnDataEntry` gains an optional
  `{ ifUnmodifiedSince?: Date | null }`: a timestamp refuses the write if the stored entry's
  `updatedAt` is newer; `null` ("I read no entry") refuses if an entry now exists; absent writes
  unconditionally.
- **BFF** — `PUT …/data/me` optionally conditional: `If-Match: "<updatedAt ISO>"` → timestamp
  pin, `If-None-Match: *` → `null`; conflict → **412**; unparseable `If-Match` → 400 (never an
  unconditional write). No header → unconditional, as before.
- **Runtime (amends S13)** — the open tab is the likeliest concurrent writer and, unguarded,
  would silently revert an agent's write by saving its stale in-memory copy. The shim now
  writes **only when dirty** (an idle open tab never writes — hide/close sends nothing), pins
  every `PUT` to the `updatedAt` it was seeded with / last saved (`seedUpdatedAt` inlined by
  `render.ts`), never overlaps saves (except the forced `pagehide` flush), and on 412 stops
  writing and posts `artefactor:data-conflict` to the parent.
- **Host shell (amends S12)** — a signed-in-only banner ("changed elsewhere … Reload") revealed
  by that message, accepted only from its own same-origin frame; Reload re-seeds the current
  data context.
- **MCP** — `set_artefact_data { id, blob, if_unmodified_since? }` → `{ id, bytes, updatedAt }`.
  **Whole-blob replacement only**, stated outright in the description (a model assuming merge
  semantics would silently delete every key it didn't send). Owner-scoped via
  `loadOwnActiveArtefact`, matching the S30 reads. `InvalidBlob` → error carrying the JSON
  parser's message; `BlobTooLarge` → error naming the actual size against the 5 MB cap;
  `DataConflict` → error directing a re-read via `get_artefact_data`. All leave the entry
  untouched.
- **Doctrine** — `skills/artefactor/SKILL.md` + `PERSISTENCE_CONTRACT_SUMMARY`: read before
  write, always, pinned with the read's `updatedAt`; use the declared schema (its `example` is
  what makes a write into an empty blob possible) but verify an inferred shape against
  `get_artefact_html`; check the version pin (`≠ current` or `null` ⇒ transform to the live
  shape, don't write back as found); keep the pre-write blob to revert; say what will change
  before writing.
- **Acceptance:** round-trip get → transform → set → re-read returns the blob verbatim with
  `updatedAt` bumped and `createdAt` + entry id preserved; first write creates, second updates
  (never two entries); another author's entry untouched; invalid JSON → error naming the parse
  failure; over 5 MB → error naming the actual size; HTTP `If-Match` current → 200, stale → 412
  with nothing written, `If-None-Match: *` → 200 then 412, malformed → 400; the shim sends
  nothing from an idle tab (hide/close), doesn't re-send after a completed save, pins with
  `If-Match`/`If-None-Match: *`, adopts its own save's `updatedAt`, serialises overlapping
  saves, and on 412 stops writing + notifies the shell; the served frame inlines the entry's
  `updatedAt` as the pin; the shell renders the banner for signed-in viewers only and accepts
  the message only from its own frame; stale pin (timestamp or `null`) →
  conflict, nothing written, message directs a re-read; no pin → unconditional write, existing
  data tests green; non-owner (even on a shared artefact) / unknown / archived / out-of-scope →
  not found; a tool-written blob — including one built from the declared schema's `example`
  into an empty entry — is what the served artefact's localStorage shim seeds.
- **On S19a/AD9 — sharpener, not dependency** (as S30). The write path stamps the pin for free
  once S19a exists, because it is the same `putOwnDataEntry`; S19a's own tests assert it
  (`set_artefact_data` stamps exactly as `PUT …/data/me` does, and this tool needed no change).
  The doctrine holds either way.
- **Open question, decided: owner-scoped v1.** `putOwnDataEntry` already permits writing your
  own blob on any viewable artefact, but a write reaching further than the owner-scoped read
  would break read-modify-write exactly where the reach was wanted. Widening read + write
  together (addressed by slug or id) is one deliberate follow-up.
- **Out of scope:** a delete tool (write `{}`); merge-patch (S17 stays dropped); writing another
  author's blob (a domain no, not a follow-up); any GUI equivalent.
- **Boundary:** **OSS**. No schema change.
