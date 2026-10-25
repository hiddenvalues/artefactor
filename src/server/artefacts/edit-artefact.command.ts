import {
  editArtefact,
  MAX_PAYLOAD_BYTES,
  type Artefact,
} from "../../domain/artefact/artefact";
import { InvariantViolation } from "../../domain/artefact/errors";
import { isArtefactKind } from "../../domain/artefact/kind";
import { payloadUsesStorage } from "../../domain/artefact/uses-storage";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { PayloadStore } from "../../domain/artefact/ports";
import { loadOwnActiveArtefact } from "./get-own-artefact";
import { loadedThenReload, mutateArtefact } from "./mutate-artefact";
import { enqueueThumbnail, type ThumbnailQueue } from "../thumbnails/thumbnail-service";

// Application command for S3 — Edit artefact. Loads the caller's own active
// artefact (archived/non-owner → not-found,
// hosting.lifecycle.archived-not-served, hosting.access.no-existence-leak),
// validates the kind and applies the change via the pure `editArtefact`. When the
// payload is replaced the new bytes are stored first; the previous payload file
// is deleted only after a successful save, and the new one is cleaned up if the
// edit is rejected — so the filesystem never leaks an orphan.
export interface EditArtefactInput {
  artefactId: string;
  requesterId: string;
  scope: TenantScope; // the caller's tenant scope (S22, hosting.tenant.invisible-to-oss)
  title?: string;
  kind?: string;
  payload?: Uint8Array; // raw HTML bytes, when replacing the payload
}

export interface EditArtefactDeps {
  repo: ArtefactRepository;
  payloadStore: PayloadStore;
  // S35 — re-renders the thumbnail after a payload replacement.
  thumbnails?: ThumbnailQueue;
}

export async function editArtefactCommand(
  input: EditArtefactInput,
  deps: EditArtefactDeps,
): Promise<Artefact> {
  const existing = await loadOwnActiveArtefact(deps.repo, {
    id: input.artefactId,
    ownerId: input.requesterId,
    scope: input.scope,
  });

  if (input.kind !== undefined && !isArtefactKind(input.kind)) {
    throw new InvariantViolation(`unknown artefact kind: ${input.kind}`);
  }
  if (input.payload !== undefined) {
    if (input.payload.byteLength === 0) {
      throw new InvariantViolation("payload must not be empty"); // hosting.payload.size-bounds
    }
    if (input.payload.byteLength > MAX_PAYLOAD_BYTES) {
      throw new InvariantViolation("payload exceeds the 100 MB cap"); // hosting.payload.size-bounds
    }
  }

  // A payload edit swaps only the artefact's payload ref: the command takes no
  // data repository, so every author's data entry stays as it was.
  // r[impl data.entry.survives-payload-edit]
  const stored =
    input.payload !== undefined
      ? await deps.payloadStore.put(input.payload)
      : undefined;

  try {
    // The payload is stored once, above. Every attempt re-applies the edit to the
    // freshly loaded aggregate with the same ref (S60,
    // hosting.save.reapply-on-conflict), so the payload superseded is the one on
    // the aggregate this edit finally saved over.
    let previousPayloadRef = existing.payloadRef;
    const edited = await mutateArtefact(deps.repo, {
      // The first attempt applies to the aggregate checked above; a retry reloads.
      load: loadedThenReload(existing, () =>
        loadOwnActiveArtefact(deps.repo, {
          id: input.artefactId,
          ownerId: input.requesterId,
          scope: input.scope,
        }),
      ),
      apply: (fresh) => {
        previousPayloadRef = fresh.payloadRef;
        return editArtefact(fresh, {
          title: input.title,
          kind: input.kind as Artefact["kind"] | undefined,
          payload: stored,
          // Recompute usesStorage from the new bytes when the payload is replaced
          // (hosting.uses-storage.chrome-only).
          // r[impl hosting.uses-storage.recomputed-with-payload]
          usesStorage:
            input.payload !== undefined
              ? payloadUsesStorage(input.payload)
              : undefined,
        });
      },
    });

    // Edit succeeded: drop the superseded payload file (if it was replaced).
    // A title/kind-only edit stores no payload, so it keeps its thumbnail.
    // r[impl hosting.thumbnail.title-edit-keeps]
    if (stored) {
      // Enqueue right after the save, before any further await: a newer edit's
      // job queued meanwhile must not be replaced by this older one (the queue
      // is latest-wins per artefact).
      // r[impl hosting.thumbnail.edit-enqueues-new-hash]
      enqueueThumbnail(deps.thumbnails, edited);
      await deps.payloadStore.delete(previousPayloadRef).catch(() => {});
    }
    return edited;
  } catch (err) {
    if (stored) {
      await deps.payloadStore.delete(stored.ref).catch(() => {});
    }
    throw err;
  }
}
