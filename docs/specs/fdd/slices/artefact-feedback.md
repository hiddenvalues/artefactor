# Artefact Feedback

## Slices

### S34 — Comments + agent feedback loop (MCP)

- **Status:** specced
- **Depends on:** S12, S18, S21, S25, S32b
- **Delivers:** feedback.thread.created-open, feedback.thread.resolution-null-while-open,
  feedback.thread.comments-ordered, feedback.comment.author-immutable,
  feedback.comment.body-bounds, feedback.comment.body-trimmed, feedback.comment.rendered-escaped,
  feedback.thread.bound-to-one-artefact, feedback.thread.never-empty,
  feedback.author.signed-in-only, feedback.access.follows-artefact,
  feedback.access.id-never-capability, feedback.comment.owner-moderates-never-edits,
  feedback.thread.resolve-owner-or-creator, feedback.thread.reply-keeps-resolved,
  feedback.open-count.matches, feedback.store.opaque-user-ids,
  feedback.lifecycle.inert-when-archived, feedback.lifecycle.removed-with-artefact,
  feedback.anchor.reserved-null, feedback.mcp.list-open-by-default, feedback.mcp.owner-only,
  feedback.mcp.tools-owner-only, feedback.mcp.reply-via-connector,
  feedback.comment.via-connector-flag

The S32b edge is for its composed read authorization (gate composition, including a collection
root's gate). (New DDD bounded context: `ddd/artefact-feedback.md`, the `feedback.*` invariants;
amends `ddd/artefact-hosting.md` `hosting.delete.removes-everything`.) Threaded comments in the host
chrome, read and answered by the owner's agent through the connector. (Market analysis gap #3 — the
most differentiating slice.)

- **Domain** — `CommentThread` aggregate with `Comment` entities; pure `startThread`, `reply`,
  `editComment`, `deleteComment` (removes an emptied thread), `resolve` / `reopen`, each
  enforcing the authority rules (`feedback.comment.owner-moderates-never-edits`,
  `feedback.thread.resolve-owner-or-creator`). `CommentBody` value object
  (`feedback.comment.body-trimmed`, `feedback.comment.body-bounds`).
  `anchor` field present and forced `null` (`feedback.anchor.reserved-null`). `ThreadRepository`
  port (`save`, `findById`, `listByArtefact(status)`, `countOpenByArtefacts`,
  `deleteByArtefact`).
- **Commands** — every command resolves the artefact by ref under `authorizeArtefactRead` (S32a)
  for `feedback.access.follows-artefact`, and checks `archived` for
  `feedback.lifecycle.inert-when-archived`. Permanent delete (S15) and the
  `collections.lifecycle.delete-cascades` cascade call `deleteByArtefact` (`feedback.lifecycle.removed-with-artefact`).
- **Persistence** — `comment_thread` (`id`, `artefact_id` FK cascade, `tenant_id`, `anchor`
  JSON null, `status`, `created_by`, `created_at`, `resolved_by`, `resolved_at`) and `comment`
  (`id`, `thread_id` FK cascade, `author_id` FK, `body`, `via_connector`, `created_at`,
  `edited_at`). Drizzle + in-memory repos.
- **BFF** — the endpoints below. Owner summaries gain `openThreadCount` (batched via
  `countOpenByArtefacts`).
- **MCP** — `list_feedback`, `reply_to_feedback`, `resolve_feedback` (owner-only, `viaConnector
  = true`); `get_artefact` returns `openThreadCount`. Update the connector `instructions`,
  `authoring-guide.ts` and `skills/artefactor/SKILL.md` with the **list → update → reply →
  resolve** loop in the same change.
- **Shell (S12 chrome)** — a comments widget (speech-bubble + open count) in `.ae-tools` beside
  the viewer list, opening a side drawer: open / resolved tabs, new-thread box, replies, edit /
  delete / resolve per the authority rules, "via Claude" label on connector comments. Bodies
  rendered as text nodes only.
- **Client (SPA)** — owner dashboard cards show an open-thread badge.

**BFF endpoints.** `:ref` is the artefact's slug or id, resolved as for Artefact Data and Artefact
Views. Every id-addressed call re-resolves the parent artefact
(`feedback.access.id-never-capability`). Display identity is enriched BFF-side via the
`UserDirectory`, as for the viewer list (`feedback.store.opaque-user-ids`).

| Method | Path | Purpose | Access |
| -------- | ------ | --------- | -------- |
| `GET` | `/api/artefacts/:ref/threads?status=open\|resolved\|all` | List threads with comments, author display identity, `viaConnector` | signed-in viewer (`feedback.access.follows-artefact`) |
| `POST` | `/api/artefacts/:ref/threads` | Create a thread (first comment body) | signed-in viewer (`feedback.access.follows-artefact`) |
| `POST` | `/api/threads/:id/comments` | Reply | signed-in viewer of the thread's artefact |
| `PATCH` | `/api/comments/:id` | Edit own comment | author (`feedback.comment.owner-moderates-never-edits`) |
| `DELETE` | `/api/comments/:id` | Delete a comment | author or artefact owner (`feedback.comment.owner-moderates-never-edits`) |
| `POST` | `/api/threads/:id/resolve` · `/reopen` | Change status | artefact owner or thread creator (`feedback.thread.resolve-owner-or-creator`) |

**Acceptance:** the DDD invariants listed under *Delivers* (viewer access, the 404s, the link
gate, authority, the emptied thread, archive and permanent delete, the anchor, the body bounds,
the open count and the connector tools), plus:

r[feedback.shell.body-rendered-as-text+2]
In the shell's comments drawer, a comment whose body is `<img src=x onerror=alert(1)>` shows as
that literal text: no image element is created and no handler runs.

- **Out of scope:** notifications and mentions (EE — OSS has no transactional email), markdown,
  anchoring (**S34b**).
- **Boundary:** **OSS**.

### S34b — Anchored comments

- **Status:** specced
- **Depends on:** S19a, S34

*Follow-on; not yet specced in detail.*

The S19a edge is for the payload version (content hash as version identity, advisory staleness).
Attach a thread to a text quote in the payload (`Anchor` = TextQuoteSelector + `payloadVersion`,
reserved by `feedback.anchor.reserved-null`) via an annotation layer injected alongside the S13
runtime; threads whose `payloadVersion` ≠ the current payload hash show as "on an earlier version"
instead of mis-anchoring. Governing invariants to be written before the slice starts.
