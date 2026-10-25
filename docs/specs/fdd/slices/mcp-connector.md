# MCP connector

## Slices

### S18 — MCP connector (remote MCP server + OAuth)

- **Status:** done
- **Depends on:** S2, S3, S4, S5, S7, S10
- **Delivers:** hosting.ingestion.parity, identity.mcp.token-one-account,
  identity.mcp.bearer-required, hosting.authority.owner-only, data.entry.survives-payload-edit,
  mcp.tools.surface, mcp.tools.data-author-count, mcp.tools.save-conflict, mcp.tools.scope-refusal,
  mcp.tools.update-replaces-html, mcp.tools.refusal-is-error-result,
  mcp.guide.instructions-summary, mcp.guide.full-guide-tool

S18's tools wrap the existing Hosting commands, including the S4 single-artefact read and the
S10 owner list. The tool contract is the published language of `ddd/mcp-connector.md`.

- Artefactor exposes a **remote MCP server** at `POST /mcp` (Streamable HTTP) that Claude (claude.ai
  / Claude design) connects to as a custom connector. *(`identity.mcp.token-one-account`)*
- **OAuth 2.1** via `@better-auth/mcp` (S63): discovery (`.well-known/oauth-*`), dynamic client
  registration, authorization-code + consent, bearer-token access. A request without a valid bearer
  → `401` with the protected-resource descriptor. *(`identity.mcp.token-one-account`,
  `identity.mcp.bearer-required`)*

- Every tool call is attributed to the token's Account and enforces the same domain invariants
  as the UI — the MCP layer is a thin adapter over the existing Hosting commands, adding no new
  authority. *(`identity.mcp.token-one-account`, `hosting.authority.owner-only`)*
- The tools (`mcp.tools.surface`) return `dataAuthorCount` (`mcp.tools.data-author-count`) and
  turn a save conflict or a refused tenant scope into an error result (`mcp.tools.save-conflict`,
  `mcp.tools.scope-refusal`). `update_artefact` replaces only the HTML payload and leaves every
  data entry in place (`data.entry.survives-payload-edit`). S18 shipped no data-write tool; S31 —
  Agent edits data: `set_artefact_data` MCP tool adds the owner's whole-blob write of their own
  entry.
- The connector self-describes its authoring contract through the server's `instructions` and
  the `get_authoring_guide` tool (`mcp.guide.instructions-summary`, `mcp.guide.full-guide-tool`).

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
- **Delivers:** hosting.export.byte-identical, hosting.export.no-injected-render,
  hosting.export.archived-not-exported, hosting.access.matrix, hosting.access.no-existence-leak,
  data.blob.bounded-opaque-json, data.read.follows-artefact-access, mcp.read.html-exact,
  mcp.read.over-cap-refused, mcp.read.own-entry-default, mcp.read.owner-scoped,
  mcp.read.schema-best-effort, mcp.read.version-pair

(`hosting.lifecycle.archived-not-served`, `hosting.access.matrix`, `hosting.authority.owner-only`
for the export read path; `data.write.author-is-caller`, `data.read.follows-artefact-access` and
`data.blob.bounded-opaque-json` for the data snapshot.) Artefactor could take HTML in but
never give it back: the client had no download affordance, and an agent on the connector could
`create`/`update` an artefact but never *read* one — so it could neither derive a new artefact from
an existing one (A) nor safely update one in place after losing the original from context (B). (B)
is a correctness problem: `update_artefact` replaces the HTML and leaves every per-user data blob
untouched, and the backend treats blobs as opaque (`data.blob.bounded-opaque-json`), so it cannot
migrate them.

- **Domain** — `extractDeclaredSchema(html)`: a pure, best-effort lift of the artefact's
  **declared data schema** block (below) from its trusted HTML. Absent/malformed/non-object
  → `null`, never an error. A payload *convention*, never enforced.
- **Shared** — `artefactFilename(title, fallback)` + `attachmentDisposition(filename)`: pure
  download-naming helpers (slugify, bound, ASCII-fold, RFC 5987), unit-tested on their own.
- **BFF** — `GET /api/artefacts/:ref/download` (`:ref` = slug **or** id). Resolution and
  access reuse `resolveViewableArtefact`, so effective-tier resolution through a collection
  root (`hosting.access.effective-from-tree-root`) and the `AccessPolicy` cell
  (`hosting.access.policy-decided`) are **inherited, not re-implemented**. Body
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

**Acceptance:** the read-back tools are `mcp.read.*`, in `ddd/mcp-connector.md`; the download's
addressing, headers, filename and round trip are the `mcp.download.*` criteria below. What the
download returns, and to whom, is Artefact Hosting's: the owner's private artefact and a shared
one by slug follow the access matrix (`hosting.access.matrix`); a signed-in non-owner of a private
artefact gets the same 404 as an unknown ref (`hosting.access.no-existence-leak`), and the
download answers every refused ref — anonymous included — with that 404
(`mcp.download.not-found`), an archived one too, its owner included
(`hosting.export.archived-not-exported`); the body is the stored payload byte for byte
(`hosting.export.byte-identical`), with no bootstrap or shell (`hosting.export.no-injected-render`).
`get_artefact_data` never validates a blob against a declared schema
(`data.blob.bounded-opaque-json`).

r[mcp.download.owner-by-id]
The owner downloads their own artefact by its id, at any visibility tier, `private` included.

r[mcp.download.shared-by-slug+2]
The download's `:ref` takes the share slug as well as the id, so a viewer the access matrix admits
downloads a shared artefact by its slug — a signed-in viewer an `authenticated` one, an anonymous
caller a `public` one.

r[mcp.download.not-found]
The download answers every ref it does not return — an unknown ref, an artefact the caller may
not view, an archived one — with the same `404`, for an anonymous caller too: never a sign-in
redirect. A link-gated artefact answers its gated audience with the gate's challenge instead
(`hosting.link-gate.narrows-public-audience`).

r[mcp.download.headers+2]
The download is a `Content-Disposition: attachment` carrying both the ASCII-folded `filename` and
the UTF-8 `filename*`, with `Content-Length` equal to the artefact's `payloadBytes`.

r[mcp.download.filename+3]
The download's filename is the artefact's title lowercased, with every run of characters other
than letters and digits (in any script, so `åäö` stay) collapsed to one hyphen; a title with no
letters or digits falls back to the slug, else the id. The name is bounded to 100 code points —
a cut never splits a character — and always ends in `.html`. The legacy ASCII `filename` form
folds accents away (`å` → `a`) and, when no ASCII letter or digit remains (a Cyrillic or CJK
title), falls back to the slug, else the id; `filename*` carries the full name.

r[mcp.download.schema-round-trip+2]
A downloaded artefact re-uploads as the same artefact: its declared data schema block comes back
intact, and `extractDeclaredSchema` reads the same schema from it.

- **Archived stays inert (`hosting.lifecycle.archived-not-served`)** — no owner carve-out. Restore →
  download → re-archive is one click, which is not worth an exception in
  `hosting.lifecycle.archived-not-served` for an escape hatch.
- **On S19a — reserve, don't depend.** `get_artefact_data` returns the version-pin **pair** but S19a
  is **not** a hard dependency edge (only `Optional`), and the missing edge is deliberate, not an
  oversight: the pin (`data.pin.stamped-on-write`) is *advisory by spec* and never gates a read or
  write, so nothing here is incorrect while the pin is `null`; and the pin was first specced
  together with the unrelated `hosting.retention.invisible-to-core` `PayloadRetentionPolicy` port in
  the edit command (now S19b), which read-back has no business pulling in. `currentPayloadVersion`
  is free today (`payloadHash` is already on the aggregate). When S19a lands, the pin populates with
  **no tool-shape change and no doctrine rewrite** — the rule "pin present and ≠ current ⇒ that
  user's data predates this payload" is written now and becomes true then. *(Borne out: S19a shipped
  on its own, ahead of S19b, as a one-line change to this tool.)*
- **Out of scope:** the `/a/:slug` shell toolbar (the endpoint already honours the matrix —
  widening is client-only); baking a data snapshot into the downloaded file; any data **write**
  tool (S31); a per-artefact "allow download" toggle (new field + invariant + migration, and
  defeated by view-source anyway).
- **Boundary:** **OSS**. No schema change.

### S31 — Agent edits data: `set_artefact_data` MCP tool

- **Status:** done
- **Depends on:** S11, S18, S30
- **Optional:** S19a
- **Linear:** ALI-268
- **Delivers:** data.shell.writes-pinned, data.entry.one-per-pair, data.entry.identity-immutable,
  data.write.author-is-caller, data.blob.bounded-opaque-json, data.write.stale-pin-refused,
  hosting.access.no-existence-leak, mcp.data-write.round-trip,
  mcp.data-write.no-pin-unconditional, mcp.data-write.owner-scoped,
  mcp.data-write.refusal-names-fix

(`data.entry.one-per-pair`, `data.write.author-is-caller`, `data.write.requires-auth`,
`data.lifecycle.archived-inert`, `data.blob.bounded-opaque-json`;
`hosting.lifecycle.archived-data-inert`.) A user's saved data could only
change by opening the artefact and editing by hand. With the S30 snapshot read, an agent can close
the loop: read the whole blob, transform it in the session ("add these six rows", "reset last
quarter"), write the whole blob back.

- **Not S17.** The dropped merge-patch put the merge in the backend (parsing the blob, breaking
  `data.blob.bounded-opaque-json`). S31 transforms **agent-side** and writes through the existing
  `putOwnDataEntry`, which parses only to enforce `data.blob.bounded-opaque-json` — the server still
  never interprets the blob. See "Connector write (S31)" in `ddd/artefact-data.md`.
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
  *(Amended by S36: all of this moved to the host shell — the pin, the dirty-only and
  no-overlap rules and the 412 handling. The shim only posts `artefactor:data-changed`.)*
- **Host shell (amends S12)** — a signed-in-only banner ("changed elsewhere … Reload") revealed
  by that message, accepted only from its own same-origin frame; Reload re-seeds the current
  data context.
  *(Amended by S36: the frame is sandboxed with no session, so the shell owns this whole
  discipline — the shim posts `artefactor:data-changed`, the shell pins and sends each `PUT`
  and detects the 412 itself; `artefactor:data-conflict` is gone.)*
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

**Acceptance:** the tool's contract is `mcp.data-write.*`, in `ddd/mcp-connector.md`; the BFF
route's conditional write is `mcp.data-write.http-conditional` below. The write is Artefact Data's
upsert: the round trip keeps `createdAt` and the entry id while `updatedAt` moves
(`data.entry.identity-immutable`); the first write creates and the second updates, never two
entries (`data.entry.one-per-pair`); another author's entry is untouched
(`data.write.author-is-caller`); invalid JSON and a blob over 5 MB are refused
(`data.blob.bounded-opaque-json`), and a stale pin, timestamp or `null`, is a conflict that writes
nothing (`data.write.stale-pin-refused`); each refusal names what to fix
(`mcp.data-write.refusal-names-fix`).

r[mcp.data-write.http-conditional]
HTTP `If-Match` current → 200, stale → 412 with nothing written, `If-None-Match: *` → 200 then
412, malformed → 400.

r[mcp.data-write.seeds-served-artefact]
A tool-written blob — including one built from the declared schema's `example` into an empty
entry — is what the served artefact's localStorage shim seeds.

The runtime criteria, superseded by S36 and so not requirements here: the shim sends nothing
from an idle tab (hide/close), doesn't re-send after a completed save, pins with
`If-Match`/`If-None-Match: *`, adopts its own save's `updatedAt`, serialises overlapping saves,
and on 412 stops writing + notifies the shell; the served frame inlines the entry's `updatedAt`
as the pin; the shell renders the banner for signed-in viewers only and accepts the message only
from its own frame. *(Amended by S36: the idle-tab, pin, adopt, serialise and 412 criteria now
hold for the host shell, not the shim; the pin is the shell's `seedUpdatedAt` (from its render
or a mint), not inlined in the frame; the shell detects the 412 itself rather than receiving a
message.)*

- **On S19a — sharpener, not dependency** (as S30). The write path stamps the pin for free
  once S19a exists, because it is the same `putOwnDataEntry`; S19a's own tests assert it
  (`set_artefact_data` stamps exactly as `PUT …/data/me` does, and this tool needed no change).
  The doctrine holds either way.
- **Open question, decided: owner-scoped v1.** `putOwnDataEntry` already permits writing your
  own blob on any viewable artefact, but a write reaching further than the owner-scoped read
  would break read-modify-write exactly where the reach was wanted. Widening read + write
  together (addressed by slug or id) to non-owners is one deliberate follow-up. The owner's own
  read of **other** authors' entries is S40 — read-only, so it leaves this write unchanged.
- **Out of scope:** a delete tool (write `{}`); merge-patch (S17 stays dropped); writing another
  author's blob (a domain no, not a follow-up); any GUI equivalent.
- **Boundary:** **OSS**. No schema change.

### S40 — Owner reads every author's saved data over MCP

- **Status:** done
- **Depends on:** S11, S12, S18, S19a, S30
- **Linear:** ALI-366
- **Delivers:** data.read.follows-artefact-access, data.write.author-is-caller,
  mcp.authors.listing, mcp.authors.resolve-author, mcp.authors.no-email-probe,
  mcp.authors.over-cap-refused, mcp.authors.owner-scoped

(`data.write.author-is-caller`, `data.read.follows-artefact-access`, `data.write.own-context-only`,
`data.lifecycle.archived-inert`, `data.blob.bounded-opaque-json`, `data.pin.stamped-on-write`;
`hosting.lifecycle.archived-data-inert`.) The host data-context switcher
(S12) loads any author's entry for the owner, but the connector returned only the caller's own, so
an agent could not answer "get me everyone's answers" about a form its user owns. This exposes the
same `data.read.follows-artefact-access` read to the owner's connector — no new authority, and
narrower than it (owner-only). See
"Snapshot read (S30, widened by S40)" in `ddd/artefact-data.md`.

- **Port** — `DataAuthorRef` gains `bytes` (UTF-8 byte length of the stored blob) and
  `authoredAgainstVersion`. `listAuthorsByArtefact` computes `bytes` in SQL with
  `octet_length(blob)` — the same expression in SQLite (3.43+) and Postgres, which keeps the EE
  mirror in parity — so listing never loads a blob. Every
  adapter implements it: Drizzle, the in-memory double, the EE Postgres mirror.
  `GET …/data/authors` keeps its response shape (it maps fields explicitly).
- **MCP** — `list_artefact_data_authors { id }` →
  `{ id, currentPayloadVersion, authors: [{ authorId, name, email, bytes, updatedAt,
  authoredAgainstVersion }] }`, newest first, names/emails via `UserDirectory` (unknown user →
  `""`, as the host route). `McpToolDeps` gains `userDirectory`.
  `get_artefact_data { id, author? }`: absent → exactly the S30 result; present → resolved
  against the artefact's author list by exact id, else case-insensitive email, and returned
  verbatim with the S30 fields plus `author: { id, name, email }`. No match → one error text
  for an unknown id, a registered user without an entry and garbage alike (no email-existence
  probe), pointing at `list_artefact_data_authors`. Same `MAX_MCP_BLOB_BYTES` refusal. Both
  owner-scoped via `loadOwnActiveArtefact`. Another author's entry is **read-only**:
  `set_artefact_data` is unchanged.
- **Doctrine** — `skills/artefactor/SKILL.md` + `PERSISTENCE_CONTRACT_SUMMARY`: "Reading other
  users' data (owner only)" — list, then fetch per author; verbatim and read-only; aggregate
  agent-side; shapes vary per author (check the pin); names, emails and answers are personal
  data the owner is reading, not something to republish into an artefact.

**Acceptance:**

r[mcp.authors.port-bytes]
`listAuthorsByArtefact` reports UTF-8 `bytes` (10, 300, `"åäö"` → 6) and each entry's pin, on
the in-memory double, Drizzle and the EE Postgres mirror.

r[mcp.authors.route-unchanged]
`/data/authors` unchanged.

The listing, the `author` lookup and its refusal, the over-cap refusal and the owner-only reach
are `mcp.authors.*`, in `ddd/mcp-connector.md`. The owner reading every author's entry is
`data.read.follows-artefact-access`; after reading another author's entry, `set_artefact_data`
still writes only the caller's own (`data.write.author-is-caller`).

- **Out of scope:** reads by non-owners who can view the artefact (the S31 follow-up); an
  all-authors-in-one-call tool (5 MB × N does not fit a result); writing or repairing another
  author's entry (a domain no); server-side aggregation (`data.blob.bounded-opaque-json`); host
  switcher / `/data/authors` changes.
- **Boundary:** **OSS**, with the EE Postgres mirror in `ee/`. No schema change.

### S63 — MCP connector on better-auth 1.7: OAuth provider with a consent screen

- **Status:** done
- **Depends on:** S18
- **Linear:** ALI-523
- **Delivers:** identity.mcp.consent-required, identity.mcp.token-audience,
  identity.mcp.bearer-required, identity.mcp.token-one-account, export.account.no-credentials

better-auth 1.7 removed the OIDC-based `mcp` plugin S18 was built on. The connector's
authorization server is now `@better-auth/mcp` over `@better-auth/oauth-provider`, with the `jwt`
plugin signing audience-bound access tokens. The tool surface and its authority are unchanged.

- **Provider** — `jwt()` + `mcp({ loginPage: "/", consentPage: "/oauth/consent", resource:
  "<BETTER_AUTH_URL>/mcp" })` with open, unauthenticated dynamic client registration at
  `/api/auth/oauth2/register`. Authorize, token and consent sit under `/api/auth/oauth2/*`. No
  client skips consent. *(`identity.mcp.consent-required`)* The boot-time env check holds
  `BETTER_AUTH_URL` to what the provider accepts as a resource: https, or plain http on a
  loopback host, with no credentials, query or fragment; a trailing slash is dropped.
- **Discovery** — the root serves the authorization-server metadata at
  `/.well-known/oauth-authorization-server` (and its issuer-path-suffixed form) and the RFC 9728
  protected-resource metadata at `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/mcp`; their `issuer`, `authorization_servers` and
  `resource` agree with the tokens. All four answer any origin (`Access-Control-Allow-Origin: *`,
  OPTIONS preflight included), since discovery is public metadata and a browser-based MCP client
  runs on an origin of its own; registration and the token endpoint don't.
- **Bearer check** — `verifyMcpBearer` verifies the JWT in-process against the deployment's own
  signing keys (no HTTP fetch of `/jwks`), checks issuer, audience and a required expiry,
  refuses a token bound to a client key (`cnf`, as DPoP binds one), then checks that the `sub`
  Account still exists; anything else is a `401` with the protected-resource pointer.
  *(`identity.mcp.token-audience`, `identity.mcp.bearer-required`,
  `identity.mcp.token-one-account`)*
- **Consent screen** — `/oauth/consent` in the SPA names the client, the host its redirect URI
  sends the code to (from the signed query) and the Account, and offers
  Allow / Deny; a signed-out visit signs in first and resumes; an expired or tampered request
  shows an error state with no Allow, and so does the sign-in page once the pending request has
  expired. Sign-in on `/` resumes a pending authorize request
  (`oauthProviderClient()`); an emailed link carries it as its callback
  (`pendingAuthorizeURL`), so following the link re-enters authorize and lands on Consent.
  Design: `docs/design/templates/auth-flow.md` *Consent*.
- **Migration** — the old `oauthApplication` / `oauthAccessToken` / `oauthConsent` tables are
  dropped and the provider's `oauthClient`, `oauthResource`, `oauthClientResource`,
  `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion` and `jwks`
  created, on SQLite and the EE Postgres mirror. Existing connections end: an old bearer
  gets a `401` and the client reconnects once.
- **Export** — none of the new secret-bearing rows reach the bundle.
  *(`export.account.no-credentials`)*
- **Out of scope:** Client ID Metadata Documents; a connected-apps UI; finer MCP scopes; DPoP; a
  shorter access-token lifetime; migrating existing tokens or clients.
- **Boundary:** **OSS**, with the EE Postgres mirror and Renovate rule in `ee/`.

### S75 — Agent places an artefact in a collection: `move_artefact` and `list_collections` MCP tools

- **Status:** done
- **Depends on:** S18, S25, S29
- **Linear:** ALI-614
- **Delivers:** mcp.tools.surface, mcp.collections.list-placeable, mcp.collections.list-shape,
  mcp.collections.move-runs-command, mcp.collections.target-refusal

An agent could publish an artefact but not put it into a collection, nor find a collection's id.
Two tools close that, each a thin adapter over the app's existing command or reads.

- **`list_collections`** — no arguments; `{ collections }`. The query
  `listPlaceableCollections` (`src/server/collections/placeable-collections.query.ts`) composes
  `listOwnCollections` and `listSharedCollections`, keeps the active nodes the caller may place
  into (own, or `canContribute`), and builds each row's `path` and the tree order.
  *(`mcp.collections.list-placeable`, `mcp.collections.list-shape`)*
- **`move_artefact`** — `{ id, collection_id }`, `collection_id` required (`null` is top level, so
  an omitted argument is never read as one). Runs `moveArtefactCommand` with the token's Account
  and tenant scope, so a save conflict retries (S60) and a move into a shared tree mints the
  slug. *(`mcp.collections.move-runs-command`)*
- **Refusals** — the artefact unknown, another user's, archived or out of scope: the same
  not-found as `get_artefact`. `CollectionNotFound` (unknown, not the caller's to place into, or
  in another tenant, which the scoped lookup never finds): one refusal echoing only the id and
  naming `list_collections`. `CollectionInvariantViolation` (an archived target): the domain's
  message. *(`mcp.collections.target-refusal`, `mcp.tools.refusal-is-error-result`)*
- **Guide and skill** — `skills/artefactor/SKILL.md` documents both tools and warns that placing
  into a non-private tree shares the artefact; the instructions summary names both tools.
- **Out of scope:** managing collections over the connector (ALI-615); naming a target by path;
  placing at create time; ejecting another user's artefact; viewer-only collection reads.
- **Boundary:** **OSS**.

### S76 — Agent manages collections over MCP: create, update, set visibility, archive and restore

- **Status:** done
- **Depends on:** S75, S26, S44, S74
- **Linear:** ALI-615
- **Delivers:** mcp.tools.surface, mcp.collections.writes-run-commands,
  mcp.collections.web-app-only, mcp.collections.archive-reports-cascade,
  mcp.collections.target-refusal

After S75 an agent could place artefacts only into collections that already existed. Five tools let
it build and manage the tree, each a thin adapter over the app's existing command for the token's
Account (`registerCollectionWriteTools` in `src/server/mcp/tools.ts`).

- **`create_collection`** — `{ name, parent_id?, visibility?, description? }`; runs
  `createCollectionCommand`. `parent_id` must be the caller's own collection; the domain refuses
  `visibility` with a `parent_id`, since a nested collection takes its root's tier
  (`collections.access.set-on-root-only`).
- **`update_collection`** — `{ id, name?, description? }` (a string sets the description, `null`
  clears it); runs `editCollectionCommand` with name and description only. Neither given is
  refused ("nothing to update").
- **`set_collection_visibility`** — `{ id, visibility }`; runs `editCollectionCommand` with the
  tier only, never a link gate. On a non-root the domain refuses: the root governs the tree.
- **`archive_collection`**, **`restore_collection`** — `{ id }`; run `archiveCollectionCommand` /
  `restoreCollectionCommand` and return `{ collection, cascade }`. The domain refuses a restore
  under an archived ancestor, naming the topmost archived ancestor to restore instead
  (`collections.lifecycle.restore-under-active-parent`); `restore_artefact` refuses an artefact
  inside an archived collection the same way.
- **Results** — every collection is the owner's `toCollectionSummary` (with `publicSlug` and
  `linkGate`) plus its `path`, with `visibility` the tier it is served under: its tree root's, so
  a nested collection under a public root reports `public`. *(`mcp.collections.writes-run-commands`,
  `mcp.collections.archive-reports-cascade`)*
- **Refusals** — `CollectionNotFound` from any collection argument (unknown, not the caller's,
  a contributed tree's node, out of scope): S75's uniform refusal, worded for every collection
  argument. Domain rejections (an empty name, an over-cap description, an archived collection, a
  tier on a non-root) carry the domain's message. *(`mcp.collections.target-refusal`)*
- **Guide and skill** — `skills/artefactor/SKILL.md` documents the five tools: say before a tier
  change that it shares or unshares the whole tree, confirm before an archive. People,
  contributors, link protection and permanent deletion stay in the web app; the instructions
  summary says so. *(`mcp.collections.web-app-only`)*
- **Out of scope:** permanent delete; granting or revoking people and contributors; link
  protection; listing archived collections; ejecting another user's artefact; bookmarks.
- **Boundary:** **OSS**.

### S78 — Agent keeps an artefact private and verifies it before calling it done

- **Status:** done
- **Depends on:** S18
- **Linear:** ALI-652
- **Delivers:** mcp.guide.verify-rendered, mcp.guide.share-on-request, mcp.tools.create-app-url

Agents on clients that can't render their own HTML showed the user a mockup, published something
else and called it done, or shared an artefact publicly because a private one gave them no link.
The connector's authoring contract now steers them, and a private artefact gets an address to
hand the user.

- **Two shared paragraphs** — *verify before you call an artefact done* and *keep an artefact
  private unless the user asked to share it* — carried word for word by `PERSISTENCE_CONTRACT_SUMMARY`
  (the `instructions`) and `skills/artefactor/SKILL.md` (`get_authoring_guide`), whose new *Verify
  and share — before calling it done* section elaborates them and whose shipping checklist gains
  four items. *(`mcp.guide.verify-rendered`, `mcp.guide.share-on-request`)*
- **`appUrl`** — `create_artefact`'s result adds the web app's address (`${BETTER_AUTH_URL}/`)
  beside `url`, the share link that stays `null` while private. Only `create_artefact` carries it.
  *(`mcp.tools.create-app-url`)*
- **Tool descriptions** — `create_artefact` and its `visibility` argument say to always create
  private, verify, then share with `set_visibility`, even when the user asked for a shared tier up
  front; `set_visibility` says to share only on the user's request; the argument and
  `set_visibility` say to set `public` only when they asked for it.
- **Out of scope:** a connector tool that renders the artefact for the agent; a deep link to one
  artefact in the web app (the SPA has no per-artefact route); any server-side enforcement.
- **Boundary:** **OSS**.
