import type { DataEntry } from "./data-entry";

// A projection of which authors hold an entry for an artefact, powering the S12
// host data-context switcher (`…/data/authors`) and the S40 connector listing.
// The blob itself is not loaded — only identity + freshness (AD §"BFF
// endpoints"), plus its stored size and version pin (S40).
export interface DataAuthorRef {
  authorId: string;
  updatedAt: Date;
  // S40 — UTF-8 byte length of the stored blob, computed by the store without
  // loading it. Transport metadata (like `payloadBytes`), not an interpretation.
  bytes: number;
  // S19a (AD9) — the payload hash at the entry's last write, as stored.
  authoredAgainstVersion: string | null;
}

// Port: persistence for the DataEntry aggregate. The Drizzle adapter (infra/db)
// and the in-memory test double both implement this. One entry per
// (artefactId, authorId) pair (AD1) — `save` upserts on that pair.
export interface DataRepository {
  findByArtefactAndAuthor(
    artefactId: string,
    authorId: string,
  ): Promise<DataEntry | null>;
  save(entry: DataEntry): Promise<void>;
  deleteByArtefactAndAuthor(
    artefactId: string,
    authorId: string,
  ): Promise<void>;
  // Remove every entry for an artefact (all authors) — used when the artefact is
  // permanently deleted (AH11). A no-op if there are none.
  deleteByArtefact(artefactId: string): Promise<void>;
  // S12 — authors who have an entry for this artefact, for the host switcher.
  listAuthorsByArtefact(artefactId: string): Promise<DataAuthorRef[]>;
}
