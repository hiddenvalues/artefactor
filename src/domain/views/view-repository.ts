import type { ViewEntry } from "./view-entry";

// A projection of who has viewed an artefact, powering the S21 "viewed by" list
// (`…/viewers`). Identity + freshness only — the entry carries nothing else.
export interface ViewerRef {
  viewerId: string;
  viewedAt: Date;
}

// A projection of one viewer's own views, powering S47's Recent row and Last
// viewed sort (`/api/views/mine`, views.mine.own-visible-only). Which artefact, and when.
export interface OwnViewRef {
  artefactId: string;
  viewedAt: Date;
}

// Port: persistence for the ViewEntry aggregate. The Drizzle adapter (infra/db)
// and the in-memory test double both implement this. One entry per
// (artefactId, viewerId) pair (views.entry.one-per-pair) — `save` upserts on that pair.
export interface ViewRepository {
  findByArtefactAndViewer(
    artefactId: string,
    viewerId: string,
  ): Promise<ViewEntry | null>;
  save(entry: ViewEntry): Promise<void>;
  // Viewers who have an entry for this artefact, for the "viewed by" list.
  listViewersByArtefact(artefactId: string): Promise<ViewerRef[]>;
  // One viewer's own entries, newest first (S47). Unfiltered by access — the
  // caller keeps only what the viewer can open now (views.mine.own-visible-only).
  listByViewer(viewerId: string): Promise<OwnViewRef[]>;
  // Remove every entry for an artefact — used when the artefact is permanently
  // deleted (hosting.delete.removes-everything,
  // views.lifecycle.removed-with-artefact). A no-op if there are none.
  deleteByArtefact(artefactId: string): Promise<void>;
}
