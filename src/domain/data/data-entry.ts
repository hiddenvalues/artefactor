import { BlobTooLarge, InvalidBlob } from "./errors";

// The blob size cap (data.blob.bounded-opaque-json).
export const MAX_BLOB_BYTES = 5 * 1024 * 1024; // 5 MB

// One opaque JSON blob per (artefact, author) pair. The backend never interprets
// the blob — the artefact owns its shape; the store only checks it is valid JSON
// within the cap. `blob` is the raw JSON text, stored and returned verbatim.
export interface DataEntry {
  id: string;
  artefactId: string;
  authorId: string;
  blob: string;
  // data.pin.stamped-on-write — the artefact's payload content hash at the last write: which HTML this
  // blob was written against. `null` for an entry written before the pin
  // existed. Advisory only — it names a payload, never describes the blob, and
  // never gates a read or write.
  authoredAgainstVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// r[impl data.blob.bounded-opaque-json]
// The blob must be valid JSON and within the size cap. Size is checked
// first so an oversize payload is rejected without parsing megabytes of text.
export function assertBlobWithinBounds(blob: string): void {
  if (new TextEncoder().encode(blob).byteLength > MAX_BLOB_BYTES) {
    throw new BlobTooLarge(`blob exceeds the ${MAX_BLOB_BYTES} byte cap`);
  }
  try {
    JSON.parse(blob);
  } catch {
    throw new InvalidBlob("blob must be valid JSON");
  }
}

export interface UpsertDataEntryInput {
  // Used only when creating a new entry; ignored on update.
  id: string;
  artefactId: string;
  authorId: string;
  blob: string;
  // data.pin.stamped-on-write — the artefact's current payload hash. Required so no write path can
  // forget the stamp; `null` only for seeding an entry that predates the pin.
  authoredAgainstVersion: string | null;
  // The current entry for this (artefact, author), if one exists.
  existing?: DataEntry | null;
  now?: Date;
}

// Upsert the single entry for a (artefact, author) pair (data.entry.one-per-pair,
// decided by the repository's `save`). Validates the blob
// (data.blob.bounded-opaque-json); on update, preserves identity + createdAt and
// bumps updatedAt. Every write re-stamps the version pin (data.pin.stamped-on-write).
// `authorId` is the authenticated writer — enforced by the caller
// (data.write.author-is-caller, data.write.requires-auth).
// r[impl data.entry.identity-immutable+2]
export function upsertDataEntry(input: UpsertDataEntryInput): DataEntry {
  assertBlobWithinBounds(input.blob);
  const now = input.now ?? new Date();

  if (input.existing) {
    return {
      ...input.existing,
      blob: input.blob,
      authoredAgainstVersion: input.authoredAgainstVersion,
      updatedAt: now,
    };
  }
  return {
    id: input.id,
    artefactId: input.artefactId,
    authorId: input.authorId,
    blob: input.blob,
    authoredAgainstVersion: input.authoredAgainstVersion,
    createdAt: now,
    updatedAt: now,
  };
}
