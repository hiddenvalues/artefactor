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
  // S36 — the app origin the shim posts its changes to (the host shell's).
  targetOrigin: string;
  // S36 — this document's message channel, from its frame token; null for an
  // anonymous, token-less frame (read-only, so it never posts).
  channel: string | null;
}

// Produce the HTML for a served artefact (S13): its trusted payload with the
// localStorage bootstrap injected, seeded with a data context.
//
// Default context = the viewer's own entry: an authenticated viewer gets it
// read-write, an unauthenticated viewer gets an empty read-only one (no
// anonymous writes — data.write.requires-auth). Selecting another author (S12)
// seeds that author's blob read-only — only the viewer's *own* context is
// writable (data.write.own-context-only).
// S36 — the viewer and author come from the frame token, never a cookie. The
// payload itself is inserted as stored: never sanitized, scripts kept.
// r[impl hosting.serve.as-is]
export async function renderServedArtefact(
  artefact: Artefact,
  viewerId: string | null,
  deps: ServeRenderDeps,
  options: ServeRenderOptions,
): Promise<string> {
  const bytes = await deps.payloadStore.get(artefact.payloadRef);
  const html = new TextDecoder().decode(bytes);
  // r[impl data.context.host-chosen]
  // Which author's data to load: the requested one, else the viewer's own.
  const contextAuthorId = options.authorId ?? viewerId;
  // r[impl data.write.own-context-only]
  // Writable only when the viewer is signed in AND looking at their own data.
  const writable = viewerId !== null && contextAuthorId === viewerId;
  // r[impl data.shim.seeded-server-side]
  const entry = contextAuthorId
    ? await deps.dataRepo.findByArtefactAndAuthor(artefact.id, contextAuthorId)
    : null;
  return renderArtefactHtml(html, {
    // r[impl mcp.data-write.seeds-served-artefact]
    seedBlob: entry?.blob ?? "{}",
    writable,
    targetOrigin: options.targetOrigin,
    channel: options.channel,
    seedUpdatedAt: entry?.updatedAt.toISOString() ?? null,
    maxBytes: MAX_BLOB_BYTES,
  });
}

// S36 (data.frame-token.absent-invalid-expired) — what an expired frame token gets instead of the artefact: a page
// that seeds nothing and asks the host shell to mint a fresh frame URL (the shell
// accepts it only from its own frame's window). This is what keeps an in-artefact
// `location.reload()` working after the token's five minutes.
export function renderExpiredFramePage(targetOrigin: string): string {
  const origin = JSON.stringify(targetOrigin).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reloading…</title></head><body><script>
try { window.parent.postMessage({ type: "artefactor:frame-token-expired" }, ${origin}); } catch (e) {}
</script></body></html>`;
}
