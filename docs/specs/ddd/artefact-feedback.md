# Bounded Context: Artefact Feedback (comments)

Threaded **comments on an artefact**, readable and writable by the people who can view it, and
readable by the owner's agent through the MCP connector — so review feedback flows back into the
tool that generated the artefact without copy-paste.

**Threads live in host chrome, not in the payload.** Artefacts are trusted HTML that is replaced
wholesale on every edit (AH2/AH15). A comment is therefore attached to the **artefact as a
whole** and shown in the signed-in host shell (`.ae-tools`, beside the S12 data-context switcher
and the S21 viewer list); the served artefact is oblivious to it. A thread carries a **nullable
`anchor`** reserved for anchoring to content (FDD **S34b**); in S34 it is always `null`.

**Comments are untrusted text.** Unlike an `HtmlPayload`, a comment body is written by any
viewer and is **always rendered escaped**. Nothing in a comment is ever interpreted as markup.

## Aggregate: `CommentThread`

Aggregate root. One discussion on one artefact; owns its comments.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | ThreadId (uuid) | Identity. |
| `artefactId` | ArtefactId | Immutable. |
| `tenantId` | TenantId | The artefact's tenant (AH17). Immutable. |
| `anchor` | Anchor \| null | Reserved for S34b. Always `null` in S34. |
| `status` | `open` \| `resolved` | Created `open`. |
| `createdBy` | UserId | Author of the first comment. |
| `createdAt` | timestamp | |
| `resolvedBy` / `resolvedAt` | UserId \| null / timestamp \| null | Set on resolve, cleared on reopen. |
| `comments` | Comment[] | Ordered by `createdAt`; never empty. |

### Entity: `Comment`

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | CommentId (uuid) | Identity. |
| `authorId` | UserId | The Account that wrote it (via UI or MCP). Immutable. |
| `body` | CommentBody | Plain text. |
| `viaConnector` | boolean | `true` when written through the MCP connector (IA2 attribution still names the Account). Lets the UI show "via Claude". Immutable. |
| `createdAt` / `editedAt` | timestamp / timestamp \| null | |

### Value objects

- **`CommentBody`** — trimmed, non-empty, ≤ **10 000** characters. Plain text; rendered
  escaped. No markdown or HTML interpretation in v1.
- **`Anchor`** *(S34b; shape reserved)* — a W3C Web Annotation **TextQuoteSelector**
  (`exact`, `prefix`, `suffix`) plus the `payloadVersion` (content hash, AH15) it was made
  against, so a thread anchored to a superseded payload is detectably stale rather than
  silently misplaced.

## Invariants

1. **Bound to one artefact**: `artefactId` and `tenantId` are immutable; a thread never moves.
   A thread always has at least one comment — creating a thread *is* posting its first comment,
   and a thread whose last comment is deleted is removed. *(FB1)*
2. **Signed-in authors only**: every comment is attributed to an authenticated `authorId`.
   Anonymous viewers of a `public` artefact can neither read nor write threads (mirrors VT2 and
   AD3). *(FB2)*
3. **Access follows the artefact**: a signed-in user may **list threads, create a thread, and
   reply** exactly when they may **view** the artefact — the effective access matrix (AH20,
   AH18) and the link gate (AH22). A request the matrix denies is a uniform not-found (AH8).
   *(FB3)*
4. **Authority**: a comment's **author** may edit its body (sets `editedAt`) and delete it; the
   **artefact owner** may delete any comment on their artefact (moderation) but never edit one.
   The **artefact owner** or the **thread creator** may resolve or reopen a thread. Replying to
   a resolved thread is allowed and does not reopen it. *(FB4)*
5. **Inert when archived**: while the artefact is `archived`, thread reads and writes return
   not-found (AH7), for the owner too — as the data API does (AD6). Threads are retained and
   reappear on restore. *(FB5)*
6. **Lifecycle-bound**: threads have no existence independent of their artefact. Permanent
   delete (AH11, including the CL8 cascade) removes all of an artefact's threads and comments.
   *(FB6)*
7. **Anchor reserved**: in S34 every thread's `anchor` is `null`; a command carrying a non-null
   anchor is rejected until S34b defines anchoring. *(FB7)*

## BFF endpoints

`:ref` is the artefact's slug or id, resolved as for Artefact Data and Artefact Views.

| Method | Path | Purpose | Access |
| -------- | ------ | --------- | -------- |
| `GET` | `/api/artefacts/:ref/threads?status=open\|resolved\|all` | List threads with comments, author display identity, `viaConnector` | signed-in viewer (FB3) |
| `POST` | `/api/artefacts/:ref/threads` | Create a thread (first comment body) | signed-in viewer (FB3) |
| `POST` | `/api/threads/:id/comments` | Reply | signed-in viewer of the thread's artefact |
| `PATCH` | `/api/comments/:id` | Edit own comment | author (FB4) |
| `DELETE` | `/api/comments/:id` | Delete a comment | author or artefact owner (FB4) |
| `POST` | `/api/threads/:id/resolve` · `/reopen` | Change status | artefact owner or thread creator (FB4) |

Thread and comment ids are unguessable, but every id-addressed call still re-resolves the parent
artefact and applies FB3 — an id is never a capability. Display identity is enriched BFF-side via
the `UserDirectory`, as for the viewer list; the store holds opaque user ids only.

## MCP connector tools

Owner-only, like the other connector read tools (S18/S30): a non-owner, unknown, archived or
out-of-scope artefact is not found. Every write is attributed to the token's Account (IA2) with
`viaConnector = true`.

| Tool | Does |
| ------ | ------ |
| `list_feedback({ artefactId, status? })` | Returns threads (default `open`) with comments, author names, timestamps, `viaConnector` — the agent's review inbox. |
| `reply_to_feedback({ threadId, body })` | Posts a reply (e.g. "Fixed in this update"). |
| `resolve_feedback({ threadId })` | Resolves a thread. |

`get_artefact` additionally returns `openThreadCount`, so an agent updating an artefact sees
that unaddressed feedback exists. The connector `instructions` and `skills/artefactor/SKILL.md`
describe the loop (**list → update → reply → resolve**) and are kept in sync (no-drift rule).

## Relationship to Artefact Hosting

The `Artefact` aggregate is the access-control authority for its threads, as it is for data and
view entries: reads and writes follow its effective access and link gate, archiving makes threads
inert, and permanent delete removes them. Threads are a separate aggregate so feedback stays out
of the Hosting consistency boundary.

## Decided

- **Chrome threads first, anchors later (S34b)** — the `anchor` column exists from S34 so
  anchoring is a feature, not a migration.
- **Signed-in only** — no anonymous comments, consistent with views and data writes.
- **Plain text, escaped** — no markdown in v1.
- **Owner moderates by deleting, never by editing** someone else's words.

## Open questions

- **Notifications** (email on new thread / reply) and **mentions** — not in OSS, which has no
  transactional email. A superset may add them by observing thread and comment events; the
  store needs no change.
