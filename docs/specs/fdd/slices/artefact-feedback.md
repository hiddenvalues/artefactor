# Artefact Feedback

### S34 — Comments + agent feedback loop (MCP)
- **Status:** specced
- **Depends on:** S12, S18, S21, S25, S32

The S32 edge is for its composed read authorization (gate composition). (New DDD bounded context: `ddd/artefact-feedback.md`, FB1–FB7; amends
`ddd/artefact-hosting.md` AH11.) Threaded comments in the host chrome, read and answered by the
owner's agent through the connector. (Market analysis gap #3 — the most differentiating slice.)
- **Domain** — `CommentThread` aggregate with `Comment` entities; pure `startThread`, `reply`,
  `editComment`, `deleteComment` (removes an emptied thread), `resolve` / `reopen`, each
  enforcing FB4 authority. `CommentBody` value object (FB, ≤ 10 000 chars). `anchor` field
  present and forced `null` (FB7). `ThreadRepository` port (`save`, `findById`,
  `listByArtefact(status)`, `countOpenByArtefacts`, `deleteByArtefact`).
- **Commands** — every command resolves the artefact by ref under `authorizeArtefactRead` (S32)
  for FB3, and checks `archived` for FB5. Permanent delete (S15) and the CL8 cascade call
  `deleteByArtefact` (FB6).
- **Persistence** — `comment_thread` (`id`, `artefact_id` FK cascade, `tenant_id`, `anchor`
  JSON null, `status`, `created_by`, `created_at`, `resolved_by`, `resolved_at`) and `comment`
  (`id`, `thread_id` FK cascade, `author_id` FK, `body`, `via_connector`, `created_at`,
  `edited_at`). Drizzle + in-memory repos.
- **BFF** — the endpoints in `artefact-feedback.md`. Owner summaries gain `openThreadCount`
  (batched via `countOpenByArtefacts`).
- **MCP** — `list_feedback`, `reply_to_feedback`, `resolve_feedback` (owner-only, `viaConnector
  = true`); `get_artefact` returns `openThreadCount`. Update the connector `instructions`,
  `authoring-guide.ts` and `skills/artefactor/SKILL.md` with the **list → update → reply →
  resolve** loop in the same change.
- **Shell (S12 chrome)** — a comments widget (speech-bubble + open count) in `.ae-tools` beside
  the viewer list, opening a side drawer: open / resolved tabs, new-thread box, replies, edit /
  delete / resolve per FB4, "via Claude" label on connector comments. Bodies rendered as text
  nodes only.
- **Client (SPA)** — owner dashboard cards show an open-thread badge.
- **Acceptance:** a signed-in viewer starts a thread and replies; a non-viewer gets 404 and an
  anonymous viewer of a `public` artefact sees no threads and cannot post (FB2/FB3); a
  password-gated artefact's threads need a pass (AH22); an author
  edits their own comment, the owner can delete but not edit it, a stranger can do neither;
  deleting a thread's last comment removes the thread; the owner or thread creator
  resolves/reopens, others cannot; archived → 404 for everyone, threads back on restore;
  permanent delete (and a collection delete cascade) removes threads; a body of `<img src=x
  onerror=alert(1)>` renders as literal text in the shell; an empty or 10 001-char body is
  rejected; a non-null anchor is rejected (FB7); `list_feedback` returns only open threads by
  default, is not-found for a non-owner token, and `reply_to_feedback` produces a comment with
  `viaConnector = true` attributed to the token's Account; `openThreadCount` matches.
- **Out of scope:** notifications and mentions (EE — OSS has no transactional email), markdown,
  anchoring (**S34b**).
- **Boundary:** **OSS**.

### S34b — Anchored comments
- **Status:** specced
- **Depends on:** S19a, S34

*Follow-on; not yet specced in detail.*

The S19a edge is for the payload version (content hash as version identity, advisory staleness).
Attach a thread to a text quote in the payload
(`Anchor` = TextQuoteSelector + `payloadVersion`, reserved in FB7) via an annotation layer
injected alongside the S13 runtime; threads whose `payloadVersion` ≠ the current payload hash
show as "on an earlier version" instead of mis-anchoring. Governing invariants to be written
before the slice starts.
