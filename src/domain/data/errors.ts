export class DataError extends Error {}

// The blob is not valid JSON (AD8). The store never interprets the contents
// beyond confirming they parse.
export class InvalidBlob extends DataError {}

// The blob exceeds MAX_BLOB_BYTES (AD8). The runtime shim surfaces this to the
// artefact as a QuotaExceededError (S13); the API rejects it.
export class BlobTooLarge extends DataError {}

// A pinned write found the entry modified since the writer read it (S31). The
// write is refused and nothing is stored; the writer must re-read and re-apply.
// Only the connector path pins — `PUT …/data/me` writes unconditionally.
export class DataConflict extends DataError {}
