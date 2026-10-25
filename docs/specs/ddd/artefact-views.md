# Bounded Context: Artefact Views (view tracking)

A small per-artefact, per-viewer record of **who has opened an artefact, and when**. It
gives the owner (and any viewer who can see the artefact) a lightweight "viewed by" list —
the same mental model as a document's "seen by" list.

**Latest view only — not an audit log.** The store keeps one record per `(artefact, viewer)`
and bumps its timestamp on each view. There is no per-visit history and no visit count; the
single timestamp answers "when did this person last open it". This mirrors how Artefact Data
keeps a single upserted entry per `(artefact, author)` rather than an append log.

**Authenticated views only.** A view is recorded only for a **signed-in** viewer. Anonymous
(public-link) opens are never recorded — there is no identity to attribute them to, and the
list is a list of *people*. This parallels "no anonymous writes" in Artefact Data (`data.write.requires-auth`).

## Aggregate: `ViewEntry`

One entry per **(artefact, viewer)** pair. A thin record — identity plus the last-viewed
timestamp; it carries no blob.

| Field | Type | Notes |
| ------- | ------ | ------- |
| `id` | ViewEntryId (uuid) | Identity. |
| `artefactId` | ArtefactId | The artefact that was viewed. Immutable. |
| `viewerId` | UserId | The signed-in Account that viewed it. Immutable. |
| `viewedAt` | timestamp | The most recent view (upsert bumps it). |

## Invariants

r[views.entry.one-per-pair]
**One per pair (latest only)**: at most one `ViewEntry` per `(artefactId, viewerId)`. Recording a
view **upserts** — it creates the entry on first view and bumps `viewedAt` thereafter. No history,
no count.

r[views.record.authenticated-only]
**Authenticated views only**: a view is recorded only for an authenticated `viewerId`. Anonymous
opens of a `public` artefact are **not** recorded.

<!-- Recorded on serve — split by the shell that records: the shared-link shell and the owner
preview. -->

r[views.record.on-shell-serve]
**Recorded on serve, per access**: a view is recorded when the host shell for the artefact is
served to a viewer who passes the `Artefact` access matrix (`artefact-hosting.md`). A denied or
archived request serves nothing, so it records nothing.

r[views.record.on-owner-preview]
The **owner-preview** host shell (`/api/artefacts/:id/raw`) served to its owner records a view too,
through the same best-effort side effect of serving; the frame it loads and the frame-token route
record nothing.

<!-- Read follows artefact access; excludes self — split by the site that decides each part. -->

r[views.viewers.follows-artefact-access]
**Read follows artefact access**: the viewer list is readable by any **signed-in** viewer who may
view the artefact (the `Artefact` access matrix — same gate as `…/data/authors`,
`data.read.follows-artefact-access`). The list is surfaced only in the signed-in host chrome;
anonymous viewers never see it.

r[views.viewers.excludes-caller]
**Excludes self**: the **requesting viewer is excluded** from the list they receive ("who *else*
has viewed this").

r[views.lifecycle.removed-with-artefact]
**Lifecycle-bound**: entries have no existence independent of their artefact. Permanent delete of
the artefact (`artefact-hosting.md` `hosting.delete.removes-everything`) removes all its view
entries, alongside its payload and data entries.

r[views.mine.own-visible-only]
**Own views, visible artefacts only**: a signed-in viewer reads only **their own** view entries,
and only for artefacts they can open right now — their own **active** artefacts, or artefacts
effectively shared with them (S14 — Shared with you, `artefact-hosting.md`
`hosting.access.matrix`, `hosting.access.effective-from-tree-root`). An entry for an artefact since
archived, unshared or deleted is withheld. The list is composed from the existing own and shared
list commands, so it adds no new access path.

## Recording without an endpoint

There is **no view-record endpoint**: a view is recorded server-side as a side effect of serving
the host shell (`views.record.on-shell-serve`, `views.record.on-owner-preview`), not by a client
call, so it cannot be spoofed or skipped. The viewer list is enriched BFF-side with display
identity from the Identity context (the same `UserDirectory.lookup` that labels the S12
data-context switcher); the Artefact Views store itself holds only opaque viewer ids. The BFF
endpoints are listed in the slices that build them: `GET /api/artefacts/:ref/viewers` in S21 —
Who has viewed, `GET /api/views/mine` in S47 — Home: one landing screen for own and shared
artefacts (`hosting.home.own-views`).

## Realized in the host shell (S21)

The "viewed by" list is surfaced as a toolbar widget in the **signed-in-only** host-tools
wrapper (`.ae-tools`), a sibling of the S12 data-context switcher. Clicking it opens a
pop-over listing the other viewers and when each last opened the artefact. Like the
data-context switcher this is a **host-UI** concern outside the artefact container; the served
artefact is oblivious to it.

Home (S47 — Home: one landing screen for own and shared artefacts) reads the caller's own views
(`GET /api/views/mine`, `views.mine.own-visible-only`) for its **Recent** row — ranked by the
latest of the viewer's own view and, for an artefact they own, its last edit. The **Last viewed**
sort on Home and collection pages (S82 — One sort menu for Home and collection pages) reads the
same views.

## Decided

- **Latest view only, single upserted record per `(artefact, viewer)`** — no per-visit log,
  no visit count. (Keep the store minimal; a fuller analytics history is out of scope.)
- **Authenticated views only.** Anonymous public-link opens are not tracked.
- **Recorded on the host shell serve** — the shared-link shell (`/a/:slug`) and, since S47, the
  owner-preview shell (`/api/artefacts/:id/raw`) — never on a frame or token route. The
  recording point is server-side and access-gated, so it can't be spoofed.
- **Viewer list is access-matrix gated and excludes the caller** — any signed-in viewer who
  may see the artefact may see who else has viewed it (consistent with the host tools being
  signed-in-only and `…/data/authors` being access-gated, not owner-only).

## Relationship to Artefact Hosting

The `Artefact` aggregate is the access-control authority for its view entries, exactly as it
is for its data entries: reading the viewer list follows this context's access matrix, an
archived artefact is never served (so never recorded), and permanent delete removes the
entries. The entries themselves are a separate aggregate so the view-tracking concern stays
out of the Hosting consistency boundary.
