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
list is a list of *people*. This parallels "no anonymous writes" in Artefact Data (AD3).

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

1. **One per pair (latest only)**: at most one `ViewEntry` per `(artefactId, viewerId)`.
   Recording a view **upserts** — it creates the entry on first view and bumps `viewedAt`
   thereafter. No history, no count. *(VT1)*
2. **Authenticated views only**: a view is recorded only for an authenticated `viewerId`.
   Anonymous opens of a `public` artefact are **not** recorded. *(VT2)*
3. **Recorded on serve, per access**: a view is recorded when the host shell for the artefact
   is served to a viewer who passes the `Artefact` access matrix (`artefact-hosting.md`). A
   denied or archived request serves nothing, so it records nothing. The owner-preview path is
   not a "view" (it only ever records the owner viewing their own artefact, who is excluded
   from the list anyway). *(VT3)*
4. **Read follows artefact access; excludes self**: the viewer list is readable by any
   **signed-in** viewer who may view the artefact (the `Artefact` access matrix — same gate as
   `…/data/authors`, AD4). The **requesting viewer is excluded** from the list they receive
   ("who *else* has viewed this"). The list is surfaced only in the signed-in host chrome;
   anonymous viewers never see it. *(VT4)*
5. **Lifecycle-bound**: entries have no existence independent of their artefact. Permanent
   delete of the artefact (`artefact-hosting.md` AH11) removes all its view entries, alongside
   its payload and data entries. *(VT5)*

## BFF endpoints

`:ref` is the artefact's **public slug or its id** — the runtime resolves either, exactly as
the Artefact Data endpoints do.

| Method | Path | Purpose | Consumer / access |
| --- | --- | --- | --- |
| `GET` | `/api/artefacts/:ref/viewers` | List viewers who have opened the artefact (id + name/email + `viewedAt`), **excluding the caller** | host UI; signed-in; per access matrix |

There is **no view-record endpoint**: a view is recorded server-side as a side effect of
serving the host shell (VT3), not by a client call, so it cannot be spoofed or skipped. The
viewer-listing endpoint is enriched BFF-side with display identity from the Identity context
(the same `UserDirectory.lookup` that labels the S12 data-context switcher); the Artefact
Views store itself holds only opaque viewer ids.

## Realized in the host shell (S21)

The "viewed by" list is surfaced as a toolbar widget in the **signed-in-only** host-tools
wrapper (`.ae-tools`), a sibling of the S12 data-context switcher. Clicking it opens a
pop-over listing the other viewers and when each last opened the artefact. Like the
data-context switcher this is a **host-UI** concern outside the artefact container; the served
artefact is oblivious to it.

## Decided

- **Latest view only, single upserted record per `(artefact, viewer)`** — no per-visit log,
  no visit count. (Keep the store minimal; a fuller analytics history is out of scope.)
- **Authenticated views only.** Anonymous public-link opens are not tracked.
- **Recorded on the shared-link shell serve** (`/a/:slug`), not on the owner-preview path —
  the recording point is server-side and access-gated, so it can't be spoofed.
- **Viewer list is access-matrix gated and excludes the caller** — any signed-in viewer who
  may see the artefact may see who else has viewed it (consistent with the host tools being
  signed-in-only and `…/data/authors` being access-gated, not owner-only).

## Relationship to Artefact Hosting

The `Artefact` aggregate is the access-control authority for its view entries, exactly as it
is for its data entries: reading the viewer list follows this context's access matrix, an
archived artefact is never served (so never recorded), and permanent delete removes the
entries. The entries themselves are a separate aggregate so the view-tracking concern stays
out of the Hosting consistency boundary.
