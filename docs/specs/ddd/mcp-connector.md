# Bounded Context: MCP connector

The remote MCP server at `POST /mcp` that claude.ai and Claude design connect to as a custom
connector. The connector is a thin
adapter: every tool call runs an existing Artefact Hosting or Artefact Data command, attributed to
the OAuth token's Account (`identity.mcp.token-one-account`), so it adds no authority and no rule
of its own to those contexts. Their rules — the access matrix, ownership, the data entry and its
blob — are defined in `artefact-hosting.md` and `artefact-data.md`, and hold here unchanged.

This context owns no aggregate. What it owns is its **published language**: the tool contract
that agents outside the codebase depend on. The slices that build it are in
`docs/specs/fdd/slices/mcp-connector.md`; the OAuth provider in front of it is Identity & Access
(`identity-access.md`).

## Published language

**Tools.** Each takes JSON arguments and, but for `get_authoring_guide`'s text, returns JSON; an
artefact is named by its `id`.

| Tool | Arguments | Result |
| --- | --- | --- |
| `create_artefact` | `title`, `kind`, `html`, `visibility?` | the artefact's summary: id, slug, share URL, plus `appUrl` |
| `update_artefact` | `id`, `title?`, `kind?`, `html?` | the summary with `dataAuthorCount` |
| `list_artefacts` | `include_archived?` | `{ artefacts }`, the caller's own, most recently updated first |
| `get_artefact` | `id` | the summary with `dataAuthorCount` |
| `get_artefact_html` | `id` | `{ id, title, kind, html, dataAuthorCount }` |
| `get_artefact_data` | `id`, `author?` | `{ id, blob, bytes, updatedAt, dataAuthorCount, schema, currentPayloadVersion, authoredAgainstVersion }`, plus `author` when one was named |
| `list_artefact_data_authors` | `id` | `{ id, currentPayloadVersion, authors }` |
| `set_artefact_data` | `id`, `blob`, `if_unmodified_since?` | `{ id, bytes, updatedAt }` |
| `set_visibility` | `id`, `visibility` | the summary |
| `set_data_visibility` | `id`, `dataVisibility` | the summary |
| `archive_artefact`, `restore_artefact` | `id` | the summary |
| `list_collections` | — | `{ collections }`, the collections the caller may place an artefact into |
| `move_artefact` | `id`, `collection_id` (a collection id, or `null` for top level) | the summary with `dataAuthorCount` |
| `create_collection` | `name`, `parent_id?`, `visibility?`, `description?` | the collection's summary with its `path` |
| `update_collection` | `id`, `name?`, `description?` (a string sets it, `null` clears it) | the collection's summary with its `path` |
| `set_collection_visibility` | `id`, `visibility` | the collection's summary with its `path` |
| `archive_collection`, `restore_collection` | `id` | `{ collection, cascade: { collections, artefacts, evicted } }` |
| `get_authoring_guide` | — | the full authoring guide, as text |

Both writes replace whole: `update_artefact`'s `html` (`mcp.tools.update-replaces-html`) and
`set_artefact_data`'s `blob` (`mcp.data-write.round-trip`), so a key the agent leaves out is gone.
A refused call is an error result (`mcp.tools.refusal-is-error-result`). Every summary carries
`collectionId`: the collection the artefact sits in, `null` at top level.

**The authoring guide.** Connector-only clients such as Claude design cannot load the
`artefactor` Agent Skill, so the connector carries its authoring contract itself. Both channels
derive from the one skill file, `skills/artefactor/SKILL.md` (`src/server/mcp/authoring-guide.ts`;
the Dockerfile copies `skills/` into the runtime image).

An agent refused an over-cap read is pointed at the web app's "Download HTML" — a BFF route
built by S30 — Export artefact HTML (GUI download + MCP read-back tools), whose rules live in that
slice (`docs/specs/fdd/slices/mcp-connector.md`), not in this published language.

### Invariants — tools

r[mcp.tools.update-replaces-html]
`update_artefact` with `html` replaces the artefact's stored HTML whole with the given HTML — never
a patch or a merge.

r[mcp.tools.refusal-is-error-result]
A refused tool call — an unknown or unreachable artefact, an argument the domain rejects — returns
an error result whose text says what to do next; it never fails the MCP request.

r[mcp.tools.surface+4]
**Tools:** `create_artefact`, `update_artefact`, `list_artefacts`, `get_artefact`,
`get_artefact_html`, `get_artefact_data`, `list_artefact_data_authors`, `set_artefact_data`,
`set_visibility`, `set_data_visibility`, `archive_artefact`, `restore_artefact`,
`list_collections`, `move_artefact`, `create_collection`, `update_collection`,
`set_collection_visibility`, `archive_collection`, `restore_collection`, and
`get_authoring_guide`.

r[mcp.tools.data-author-count]
`get_artefact` / `update_artefact` return **`dataAuthorCount`** so the model can warn before a
breaking data-shape change and suggest a versioned key or a new artefact.

r[mcp.tools.save-conflict]
A tool whose command fails with `ArtefactConflict` after its retries (S60 — Save concurrency: a
save never overwrites a newer artefact) returns an error result telling the model to read the
artefact again with `get_artefact` and retry.

r[mcp.tools.create-app-url]
`create_artefact` returns **`appUrl`**, the web app's address where the owner opens their
artefacts, private ones included, beside `url` (the share link, `null` while the artefact is
private).

r[mcp.tools.scope-refusal]
The injected MCP scope resolver may refuse the token's Account with a message instead of resolving
its tenant scope. Every tool call on that request then returns an error result whose only text is
that message, and no tool body runs. The `initialize` handshake and `tools/list` answer as they
would otherwise. The OSS resolver never refuses: every Account gets the single tenant.

### Invariants — collections

r[mcp.collections.list-placeable]
`list_collections` lists exactly the active collections within the caller's tenant scope that they
may move an artefact into: their own, at any depth, and every node of a tree they contribute to
(`collections.contributor.on-root-access-list`). It never lists an archived collection or a tree
the caller can only view.

r[mcp.collections.list-shape]
Each `list_collections` row carries `id`, `name`, `parentId`, `path` (the names from the tree root
down to the collection, as an array), `own` (`true` for the caller's own collection) and
`visibility` (the tree root's tier, the one an artefact placed there is served under). Own trees
come first, then contributed ones; within a tree, parents come before their children and siblings
are sorted by name.

r[mcp.collections.move-runs-command]
`move_artefact { id, collection_id }` runs the app's move command for the token's Account, so
placing, re-placing and `null` back to top level follow the same rules as
`PUT /api/artefacts/:id/collection` (`hosting.collection.move-into-own-or-contributed`,
`hosting.slug.minted-on-move-into-shared-tree`). It returns the summary with `dataAuthorCount`.

r[mcp.collections.target-refusal+2]
Every collection argument — `move_artefact`'s `collection_id`, `create_collection`'s `parent_id`
and the collection write tools' `id` — that is unknown, not the caller's, or out of scope gets one
refusal. For a write, "not the caller's" includes a node of a tree the caller only contributes to.
The refusal echoes only the id and points at `list_collections`, so it never tells whether the
collection exists.

r[mcp.collections.writes-run-commands]
`create_collection`, `update_collection` (name and description), `set_collection_visibility` (the
tier alone), `archive_collection` and `restore_collection` each run the app's collection command
for the token's Account. Ownership, tree shape, slug minting and back-fill, and the cascades
therefore follow the same rules as the `/api/collections` routes (`collections.authority.owner-only`,
`collections.tree.shape-fixed`, `collections.access.root-governs-tree`,
`collections.slug.minted-on-effective-share`, `collections.lifecycle.archive-cascades`).
`update_collection` with neither `name` nor `description` is refused, and so is `create_collection`
with both `parent_id` and `visibility`: a nested collection takes its root's tier
(`collections.access.set-on-root-only`). `restore_collection` on a collection under an archived
ancestor is refused and restores nothing: it names the topmost archived ancestor to restore
instead, so no active node is left inside an inert tree (`collections.lifecycle.archived-inert`).
Each write returns the collection's summary with its `path` (the names from the tree root down),
and its `visibility` is the tier the collection is served under — its tree root's, as in
`list_collections` (`collections.access.root-governs-tree`) — never a nested row's stored one.

r[mcp.collections.web-app-only]
No connector tool grants or revokes a collection's people or contributors, sets or clears its link
protection, or permanently deletes it. `set_collection_visibility` takes only a tier, so leaving
`public` clears the link protection as the command does, and nothing over the connector sets it.

r[mcp.collections.archive-reports-cascade]
`archive_collection` and `restore_collection` return `{ collection, cascade }`: the collection's
summary and the cascade's counts — `collections` (descendants), `artefacts` (the owner's own) and
`evicted` (other users' artefacts moved out to their top level).

### Invariants — authoring guide

r[mcp.guide.instructions-summary]
**The connector self-describes its authoring contract**, because connector-only clients (e.g.
Claude design) cannot load the `artefactor` Agent Skill. Two channels carry it: the MCP
server's **`instructions`** (returned in `initialize` — ambient, present *before* any tool
call, so the model has the persistence contract while it is still authoring the HTML) carry a
compact summary.

r[mcp.guide.full-guide-tool]
The **`get_authoring_guide`** tool returns the full `skills/artefactor/SKILL.md` body on
demand.

r[mcp.guide.verify-rendered]
The authoring contract, in both the `instructions` summary and the full guide, tells the agent
that a preview it shows the user is the artefact's own rendered HTML, never an illustration; that
it publishes private, has the rendered result seen — by itself or by the user — and compared with
what the user approved at desktop and phone widths before sharing it or calling it done; and that
it claims saved data persists only after a reload has shown it.

r[mcp.guide.share-on-request]
The authoring contract, in both channels, tells the agent to keep an artefact private unless the
user asked to share it — never to choose a shared tier on the user's behalf, nor to get a link —
to give the user `appUrl` for a private artefact, and to set `public` only when the user asked
for it.

r[mcp.guide.write-at-once]
The authoring contract, in both channels, tells the agent to write each change to `localStorage`
at once, and, if it debounces a write anyway, to flush it on `beforeunload` and on
`visibilitychange` to `hidden`, never relying on `pagehide`. It says the platform's flush on hide
or close covers only what is already in `localStorage`.

### Invariants — read-back

r[mcp.read.html-exact]
`get_artefact_html` returns the exact stored HTML with `dataAuthorCount`.

r[mcp.read.over-cap-refused+2]
`get_artefact_html` refuses an HTML payload over 1 MB, and `get_artefact_data` without `author`
the caller's own blob over 256 KB, with an error result naming the actual size and pointing at
the web app's download — never a truncated result.

r[mcp.read.own-entry-default]
`get_artefact_data` without `author` returns the caller's own entry's blob verbatim, and
`blob: null` when the caller has none — never another author's entry.

r[mcp.read.owner-scoped+2]
`get_artefact_html` and `get_artefact_data` reach only the caller's own active artefacts within
their tenant scope: another user's artefact, an archived one and one out of scope all answer not
found, as an unknown id does.

r[mcp.read.schema-best-effort+2]
`get_artefact_data`'s `schema` is the artefact's declared data schema block parsed as JSON when
present, and `null` when it is absent, malformed, not valid JSON or not a JSON object — never an
error result.

r[mcp.read.version-pair+2]
`get_artefact_data` returns the version pin pair: `currentPayloadVersion`, the artefact's
`payloadHash`, and `authoredAgainstVersion`, the entry's pin as stored — `null` when there is no
entry, and for an entry written before the pin.

### Invariants — data write

r[mcp.data-write.round-trip+2]
`set_artefact_data` stores the blob it is given as the whole entry, so a `get_artefact_data` →
transform → `set_artefact_data` → `get_artefact_data` round trip reads back the written blob
verbatim, with the `updatedAt` the write returned.

r[mcp.data-write.refusal-names-fix]
`set_artefact_data`'s refusals say what to fix, and each writes nothing: invalid JSON names the
parse failure, a blob over 5 MB its actual size against the cap, and a stale pin directs a
re-read with `get_artefact_data` and a write with the new `updatedAt`.

r[mcp.data-write.no-pin-unconditional+2]
`set_artefact_data` without `if_unmodified_since` writes unconditionally; with one, it passes the
timestamp — or `null`, "I read no entry" — on as the write's pin.

r[mcp.data-write.owner-scoped+2]
`set_artefact_data` reaches only the caller's own active artefacts within their tenant scope, as
the reads do: another user's artefact — even one shared with the caller — an archived one and one
out of scope all answer not found, as an unknown id does.

### Invariants — data authors

r[mcp.authors.listing+2]
`list_artefact_data_authors` lists one row per author holding an entry, newest first, each with
`authorId`, `name`, `email`, `bytes`, `updatedAt` and `authoredAgainstVersion` (`name` and
`email` are `""` for an unknown user); `authors` is `[]` when there are none, and
`currentPayloadVersion` is the artefact's `payloadHash`.

r[mcp.authors.resolve-author]
`author` by id, by email in another case, and by the caller's own id each return that entry.

r[mcp.authors.no-email-probe+2]
`get_artefact_data`'s `author` that matches no entry on the artefact — an id or email of a user
without an entry, registered or not, or garbage — gets the same refusal, which echoes only the
argument as given, so the argument cannot probe whether an email is registered.

r[mcp.authors.over-cap-refused+2]
`get_artefact_data { author }` refuses the named author's blob — another author's or the caller's
own — over 256 KB with an error result naming its size and the cap, never a truncated blob.

r[mcp.authors.owner-scoped+2]
`list_artefact_data_authors` and `get_artefact_data { author }` reach only the caller's own active
artefacts within their tenant scope: a viewer of another user's artefact, an archived artefact and
one out of scope all answer not found for both tools, as an unknown id does.
