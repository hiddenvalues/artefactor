// A payload stored outside the aggregate (filesystem in production).
export interface StoredPayload {
  ref: string;
  bytes: number;
  hash: string;
}

// Port: persistence for trusted HTML payloads. Implemented in infra/storage.
export interface PayloadStore {
  put(content: Uint8Array): Promise<StoredPayload>;
  get(ref: string): Promise<Uint8Array>;
  delete(ref: string): Promise<void>;
}

// S35 (AH26) — port: persistence for rendered thumbnails, one WebP per
// (artefact, payload hash). Implemented in infra/storage, beside — never inside —
// the payload store.
export interface ThumbnailStore {
  put(artefactId: string, payloadHash: string, bytes: Uint8Array): Promise<void>;
  // null when no thumbnail was stored for that hash.
  get(artefactId: string, payloadHash: string): Promise<Uint8Array | null>;
  // Remove one render — the one whose compare-and-set lost (AH26).
  delete(artefactId: string, payloadHash: string): Promise<void>;
  // Remove every render of the artefact except `keepHash` (superseded files).
  deleteAllExcept(artefactId: string, keepHash: string): Promise<void>;
  // Remove every render of the artefact (permanent delete, AH11).
  deleteAll(artefactId: string): Promise<void>;
}

// S35 (AH26) — port: renders a pristine thumbnail (WebP bytes) from the stored
// HTML payload alone. Implemented in infra/render. Throws
// `ThumbnailRendererUnavailable` when no renderer can run at all.
export interface ThumbnailRenderer {
  render(html: Uint8Array): Promise<Uint8Array>;
}
