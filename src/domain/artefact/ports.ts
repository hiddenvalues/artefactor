// A payload stored outside the aggregate (filesystem in production).
export interface StoredPayload {
  ref: string;
  bytes: number;
  hash: string;
}

// Port: persistence for trusted HTML payloads. Implemented in infra/storage.
// Every `put` returns a fresh ref, identical bytes included — never a content-addressed key — so
// edit and permanent delete can drop an artefact's old ref (hosting.payload.ref-owned-by-one-artefact).
export interface PayloadStore {
  put(content: Uint8Array): Promise<StoredPayload>;
  get(ref: string): Promise<Uint8Array>;
  delete(ref: string): Promise<void>;
}

// S35 (hosting.thumbnail.stored-beside-payloads) — port: persistence for rendered
// thumbnails, one WebP per (artefact, payload hash). Implemented in infra/storage,
// beside — never inside — the payload store.
export interface ThumbnailStore {
  put(artefactId: string, payloadHash: string, bytes: Uint8Array): Promise<void>;
  // null when no thumbnail was stored for that hash.
  get(artefactId: string, payloadHash: string): Promise<Uint8Array | null>;
  // Remove one render — the one whose compare-and-set lost
  // (hosting.thumbnail.lost-render-removed).
  delete(artefactId: string, payloadHash: string): Promise<void>;
  // Remove every render of the artefact except `keepHash` (superseded files).
  deleteAllExcept(artefactId: string, keepHash: string): Promise<void>;
  // Remove every render of the artefact (permanent delete, hosting.delete.removes-everything).
  deleteAll(artefactId: string): Promise<void>;
}

// S35 (hosting.thumbnail.pristine) — port: renders a pristine thumbnail (WebP bytes) from the stored
// HTML payload alone. Implemented in infra/render. Throws
// `ThumbnailRendererUnavailable` when no renderer can run at all.
export interface ThumbnailRenderer {
  render(html: Uint8Array): Promise<Uint8Array>;
}
