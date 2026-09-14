# Artefact Views

### S21 — Who has viewed
- **Status:** done
- **Depends on:** S6, S12, S15

Record when a signed-in viewer opens an artefact, and surface a "viewed by" list in the host
chrome. (New DDD bounded context: `ddd/artefact-views.md`, invariants VT1–VT5; amends
`ddd/artefact-hosting.md` AH11 — permanent delete also removes view entries.)
- **Domain** — new **Artefact Views** context: a `ViewEntry` aggregate (`id`, `artefactId`,
  `viewerId`, `viewedAt`) with a pure `recordView` factory that upserts (first view creates;
  later views bump `viewedAt`, preserving `id`), and a `ViewRepository` port
  (`findByArtefactAndViewer`, `save` (upsert on the pair), `listViewersByArtefact`,
  `deleteByArtefact`). One entry per `(artefact, viewer)`, latest view only. *(VT1)*
- **Commands** — `recordArtefactView(artefactId, viewerId)` upserts the entry (best-effort;
  the caller has already access-checked the artefact). `listArtefactViewers(ref, viewerId)`
  resolves the artefact by slug-or-id under the access matrix, lists its viewers, and
  **excludes the requesting viewer**. *(VT3, VT4)*
- **Persistence** — new `view_entry` table (migration): `id` pk, `artefact_id` FK
  (`ON DELETE CASCADE`), `viewer_id` FK to `user`, `viewed_at`; unique `(artefact_id,
  viewer_id)` so `save` upserts. Drizzle + in-memory repos. Permanent delete (S15) also calls
  `viewRepo.deleteByArtefact` (the cascade is a DB-level backstop). *(VT5)*
- **BFF** — `GET /api/artefacts/:ref/viewers` (signed-in; access-matrix gated): returns the
  other viewers enriched with name/email via the `UserDirectory`. A view is recorded as a
  **server-side side effect** of serving the shared-link host shell (`GET /a/:slug`) to a
  signed-in viewer — there is **no record endpoint**, so it can't be spoofed or skipped.
  Anonymous opens record nothing (VT2); the owner-preview path `/:id/raw` is not recorded. *(VT2, VT3)*
- **Shell (S12 chrome)** — a "viewed by" widget (eye icon + count) sits beside `.ae-switch`
  inside the signed-in-only `.ae-tools` wrapper. Clicking it opens a pop-over listing the
  other viewers and when each last opened the artefact (relative time). Both the shared-link
  shell and the owner preview pass a `viewersEndpoint`; anonymous viewers never get the
  wrapper, so never the widget.
- **Acceptance:** a signed-in `GET /a/:slug` records a view with the current timestamp; a
  second open by the same viewer bumps `viewedAt` and adds no second row; an anonymous open
  records nothing; `GET …/viewers` lists the other viewers (name/email + `viewedAt`) and never
  the caller; a viewer who can't see the artefact (private non-owner / archived) gets 404 from
  `…/viewers` and is never recorded; permanent delete removes the view entries. Access/serving
  behaviour is otherwise unchanged (AH8).
- **Boundary:** **OSS** (a general hosting feature; pure additive context + chrome). No `ee/`
  involvement.
