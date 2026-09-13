import type { Artefact } from "../../domain/artefact/artefact";
import type { PayloadStore } from "../../domain/artefact/ports";
import { MAX_BLOB_BYTES } from "../../domain/data/data-entry";
import type { DataRepository } from "../../domain/data/data-repository";
import { renderArtefactHtml } from "./localstorage-bootstrap";

export interface ServeRenderDeps {
  payloadStore: PayloadStore;
  dataRepo: DataRepository;
}

export interface ServeRenderOptions {
  // S12 — the data context to seed. When set to another author's id, the
  // artefact is seeded with that author's blob in **read-only** mode (the host
  // data-context switcher). Defaults to the viewer's own entry.
  authorId?: string | null;
}

// Produce the HTML for a served artefact (S13): its trusted payload with the
// localStorage bootstrap injected, seeded with a data context. `ref` is the
// handle the shim writes back through (slug for public serving, id for owner
// preview).
//
// Default context = the viewer's own entry: an authenticated viewer gets it
// read-write, an unauthenticated viewer gets an empty read-only one (no
// anonymous writes — AD3/AD5). Selecting another author (S12) seeds that
// author's blob read-only — only the viewer's *own* context is writable (AD5).
export async function renderServedArtefact(
  artefact: Artefact,
  ref: string,
  viewerId: string | null,
  deps: ServeRenderDeps,
  options: ServeRenderOptions = {},
): Promise<string> {
  const bytes = await deps.payloadStore.get(artefact.payloadRef);
  const html = new TextDecoder().decode(bytes);
  // Which author's data to load: the requested one, else the viewer's own.
  const contextAuthorId = options.authorId ?? viewerId;
  // Writable only when the viewer is signed in AND looking at their own data.
  const writable = viewerId !== null && contextAuthorId === viewerId;
  const entry = contextAuthorId
    ? await deps.dataRepo.findByArtefactAndAuthor(artefact.id, contextAuthorId)
    : null;
  return renderArtefactHtml(html, {
    seedBlob: entry?.blob ?? "{}",
    // S31 — the shim's writes are conditioned on the entry it was seeded with.
    seedUpdatedAt: entry?.updatedAt.toISOString() ?? null,
    writable,
    endpoint: `/api/artefacts/${ref}/data/me`,
    maxBytes: MAX_BLOB_BYTES,
  });
}
