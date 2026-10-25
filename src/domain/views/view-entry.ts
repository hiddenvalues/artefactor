// Artefact Views context. One record per (artefact, viewer) pair capturing the
// most recent time a signed-in viewer opened the artefact — latest view only, no
// per-visit history or count (views.entry.one-per-pair). A thin record:
// identity + timestamp, no blob.
export interface ViewEntry {
  id: string;
  artefactId: string;
  viewerId: string;
  viewedAt: Date;
}

export interface RecordViewInput {
  // Used only when creating the first entry for the pair; ignored on update.
  id: string;
  artefactId: string;
  viewerId: string;
  // The current entry for this (artefact, viewer), if one exists.
  existing?: ViewEntry | null;
  now?: Date;
}

// Upsert the single entry for a (artefact, viewer) pair. On the first view
// it creates the entry; thereafter it preserves identity and bumps `viewedAt` to
// the latest view. `viewerId` is the authenticated viewer — enforced by the
// caller (views.record.authenticated-only): anonymous opens never reach here.
// r[impl views.entry.one-per-pair]
export function recordView(input: RecordViewInput): ViewEntry {
  const now = input.now ?? new Date();
  if (input.existing) {
    return { ...input.existing, viewedAt: now };
  }
  return {
    id: input.id,
    artefactId: input.artefactId,
    viewerId: input.viewerId,
    viewedAt: now,
  };
}
