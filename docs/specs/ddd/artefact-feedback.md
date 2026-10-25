# Bounded Context: Artefact Feedback (comments)

Threaded **comments on an artefact**, readable and writable by the people who can view it, and
readable by the owner's agent through the MCP connector — so review feedback flows back into the
tool that generated the artefact without copy-paste.

**Threads live in host chrome, not in the payload.** Artefacts are trusted HTML that is replaced
wholesale on every edit (`hosting.payload.size-bounds`, `hosting.retention.invisible-to-core`). A
comment is therefore attached to the **artefact as a whole** and shown in the signed-in host shell
(`.ae-tools`, beside the S12 data-context switcher and the S21 viewer list); the served artefact is
oblivious to it. A thread carries a **nullable `anchor`** reserved for anchoring to content (FDD
**S34b**); in S34 it is always `null`.

**Comments are untrusted text.** Unlike an `HtmlPayload`, a comment body is written by any
viewer, so it is shown as text and never as markup (`feedback.comment.rendered-escaped`).

## Aggregate: `CommentThread`

Aggregate root. One discussion on one artefact; owns its comments.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | ThreadId (uuid) | Identity. |
| `artefactId` | ArtefactId | The artefact discussed. |
| `tenantId` | TenantId | The artefact's tenant (`hosting.tenant.invisible-to-oss`). |
| `anchor` | Anchor \| null | Reserved for S34b. |
| `status` | `open` \| `resolved` | Whether the discussion still needs attention. |
| `createdBy` | UserId | Author of the first comment. |
| `createdAt` | timestamp | |
| `resolvedBy` / `resolvedAt` | UserId \| null / timestamp \| null | Who resolved the thread and when. |
| `comments` | Comment[] | The discussion, oldest first. |

### Entity: `Comment`

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | CommentId (uuid) | Identity. |
| `authorId` | UserId | The Account that wrote it (via UI or MCP). |
| `body` | CommentBody | Plain text. |
| `viaConnector` | boolean | Whether it was written through the MCP connector. Lets the UI show "via Claude". |
| `createdAt` / `editedAt` | timestamp / timestamp \| null | |

### Value objects

- **`CommentBody`** — a comment's plain text, stored trimmed
  (`feedback.comment.body-trimmed`).
- **`Anchor`** *(S34b; shape reserved)* — a W3C Web Annotation **TextQuoteSelector** (`exact`,
  `prefix`, `suffix`) plus the `payloadVersion` (content hash,
  `hosting.retention.invisible-to-core`) it was made against, so a thread anchored to a superseded
  payload is detectably stale rather than silently misplaced.

### Invariants — `CommentThread`

r[feedback.thread.created-open]
A thread is created with `status` `open`.

r[feedback.thread.resolution-null-while-open]
`resolvedBy` and `resolvedAt` are `null` while a thread is open — when it is created and after it
is reopened — and resolving it sets both.

r[feedback.thread.comments-ordered]
A thread's comments are ordered by `createdAt`, oldest first.

r[feedback.comment.author-immutable]
A comment's `authorId` and `viaConnector` are immutable.

r[feedback.comment.body-bounds]
An empty or 10 001-char body is rejected.

r[feedback.comment.body-trimmed]
A comment body is trimmed before it is checked and stored, and the trimmed body is 1 to 10 000
characters long, so a whitespace-only body is rejected.

r[feedback.comment.rendered-escaped]
A comment body is untrusted text: no surface interprets it as markdown or HTML, and a surface that
displays it shows it as text.

## Invariants

r[feedback.thread.bound-to-one-artefact]
`artefactId` and `tenantId` are immutable; a thread never moves.

r[feedback.thread.never-empty]
A thread always has at least one comment — creating a thread *is* posting its first comment, and a
thread whose last comment is deleted is removed.

r[feedback.author.signed-in-only]
Every comment is attributed to an authenticated `authorId`. Anonymous viewers of a `public`
artefact can neither read nor write threads (mirrors `views.record.authenticated-only` and
`data.write.requires-auth`).

r[feedback.access.follows-artefact]
A signed-in user may **list threads, create a thread, and reply** exactly when they may **view**
the artefact — the effective access matrix (`hosting.access.effective-from-tree-root`,
`hosting.access.policy-decided`) and the link gate (`hosting.link-gate.narrows-public-audience`). A
request the matrix denies is a uniform not-found (`hosting.access.no-existence-leak`).

r[feedback.access.id-never-capability]
Every call addressed by a thread or comment id re-resolves the thread's parent artefact and applies
`feedback.access.follows-artefact` to it; an id is never a capability, however unguessable.

r[feedback.comment.owner-moderates-never-edits]
A comment's **author** may edit its body (sets `editedAt`) and delete it; the **artefact owner**
may delete any comment on their artefact (moderation) but never edit one.

r[feedback.thread.resolve-owner-or-creator]
The **artefact owner** or the **thread creator** may resolve or reopen a thread.

r[feedback.thread.reply-keeps-resolved]
Replying to a resolved thread is allowed and does not reopen it.

r[feedback.open-count.matches+2]
An artefact's `openThreadCount` equals the number of its threads whose `status` is `open`.

r[feedback.store.opaque-user-ids]
The thread store holds opaque user ids only; a display identity is never stored with a thread or
comment.

r[feedback.lifecycle.inert-when-archived]
While the artefact is `archived`, thread reads and writes return not-found
(`hosting.lifecycle.archived-not-served`), for the owner too — as the data API does
(`data.lifecycle.archived-inert`). Threads are retained and reappear on restore.

r[feedback.lifecycle.removed-with-artefact]
Threads have no existence independent of their artefact. Permanent delete
(`hosting.delete.removes-everything`, including the `collections.lifecycle.delete-cascades`
cascade) removes all of an artefact's threads and comments.

r[feedback.anchor.reserved-null]
In S34 every thread's `anchor` is `null`; a command carrying a non-null anchor is rejected until
S34b defines anchoring.

## BFF endpoints

The SPA's thread and comment endpoints are S34's, in
[`fdd/slices/artefact-feedback.md`](../fdd/slices/artefact-feedback.md).

## Published language

The MCP connector tools. Like the other connector tools (S18/S30) they are owner-only, and
every write is attributed to the token's Account.

| Tool | Does |
| ------ | ------ |
| `list_feedback({ artefactId, status? })` | Returns threads with comments, author names, timestamps, `viaConnector` — the agent's review inbox. |
| `reply_to_feedback({ threadId, body })` | Posts a reply (e.g. "Fixed in this update"). |
| `resolve_feedback({ threadId })` | Resolves a thread. |

`get_artefact` additionally returns `openThreadCount` (`feedback.open-count.matches`), so an
agent updating an artefact sees that unaddressed feedback exists. The connector `instructions` and
`skills/artefactor/SKILL.md` describe the loop (**list → update → reply → resolve**) and are kept
in sync (no-drift rule).

### Invariants — connector tools

r[feedback.mcp.list-open-by-default]
`list_feedback` returns only open threads by default.

r[feedback.mcp.owner-only]
`list_feedback` is not-found for a non-owner token.

r[feedback.mcp.tools-owner-only]
`list_feedback`, `reply_to_feedback` and `resolve_feedback` are owner-only: each answers not-found
when the artefact, or the thread's parent artefact, is not the token's Account's, is unknown, is
`archived` or is out of the token's scope.

r[feedback.mcp.reply-via-connector]
`reply_to_feedback` produces a comment with `viaConnector = true` attributed to the token's
Account.

r[feedback.comment.via-connector-flag]
A comment written through the MCP connector carries `viaConnector = true` and is attributed to the
token's Account (`identity.mcp.token-one-account`).

## Relationship to Artefact Hosting

The `Artefact` aggregate is the access-control authority for its threads, as it is for data and
view entries: reads and writes follow its effective access and link gate, archiving makes threads
inert, and permanent delete removes them. Threads are a separate aggregate so feedback stays out
of the Hosting consistency boundary.

## Decided

- **Chrome threads first, anchors later (S34b)** — the `anchor` column exists from S34 so
  anchoring is a feature, not a migration.
- **Signed-in only** — no anonymous comments, consistent with views and data writes.
- **Plain text, shown as text** — no markdown in v1.
- **Owner moderates by deleting, never by editing** someone else's words.

## Open questions

- **Notifications** (email on new thread / reply) and **mentions** — not in OSS, which has no
  transactional email. A superset may add them by observing thread and comment events; the
  store needs no change.
