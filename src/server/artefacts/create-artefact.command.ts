import { randomUUID } from "node:crypto";
import {
  createArtefact,
  MAX_PAYLOAD_BYTES,
  type Artefact,
} from "../../domain/artefact/artefact";
import { isArtefactKind } from "../../domain/artefact/kind";
import { payloadUsesStorage } from "../../domain/artefact/uses-storage";
import { InvariantViolation } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { PayloadStore } from "../../domain/artefact/ports";
import { enqueueThumbnail, type ThumbnailQueue } from "../thumbnails/thumbnail-service";

// Application command for S2 — Create artefact. Orchestrates the two ports the
// pure domain factory cannot touch (the filesystem payload store and the
// repository) around `createArtefact`, which remains the single authority for
// the AH invariants. Depends only on ports, so it is unit-tested with in-memory
// doubles.
export interface CreateArtefactInput {
  // The authenticated principal creating it — the session user (manual upload) or the token's
  // account (connector); never a value taken from the request.
  ownerId: string;
  title: string;
  kind: string; // unvalidated; checked against the closed kind enum here
  payload: Uint8Array; // raw trusted HTML bytes
  // S22, hosting.tenant.invisible-to-oss — the owning tenant. Omitted by OSS callers (the factory
  // defaults to DEFAULT_TENANT, byte-identical); a multi-tenant superset passes the creator's
  // active org, resolved through the tenant scope seam, so the artefact is stamped with its tenant.
  tenantId?: string;
}

export interface CreateArtefactDeps {
  repo: ArtefactRepository;
  payloadStore: PayloadStore;
  newId?: () => string;
  now?: () => Date;
  // S35 — renders the thumbnail after the save; absent = none.
  thumbnails?: ThumbnailQueue;
}

// r[impl hosting.ingestion.parity]
// r[impl hosting.create.owner-is-creator]
export async function createArtefactCommand(
  input: CreateArtefactInput,
  deps: CreateArtefactDeps,
): Promise<Artefact> {
  // Cheap pre-validation before touching the filesystem: reject unknown kinds and
  // obviously-bad payloads so we never write an empty/oversize file. The domain
  // factory below re-checks these as the invariant authority
  // (hosting.payload.size-bounds, hosting.artefact.title-required).
  if (!isArtefactKind(input.kind)) {
    throw new InvariantViolation(`unknown artefact kind: ${input.kind}`);
  }
  if (input.payload.byteLength === 0) {
    throw new InvariantViolation("payload must not be empty"); // hosting.payload.size-bounds
  }
  if (input.payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new InvariantViolation("payload exceeds the 100 MB cap"); // hosting.payload.size-bounds
  }

  const stored = await deps.payloadStore.put(input.payload);
  let artefact: Artefact;
  try {
    artefact = createArtefact({
      id: (deps.newId ?? randomUUID)(),
      ownerId: input.ownerId,
      title: input.title,
      kind: input.kind,
      payload: stored,
      // undefined ⇒ DEFAULT_TENANT in OSS (hosting.tenant.invisible-to-oss)
      tenantId: input.tenantId,
      // r[impl hosting.uses-storage.computed-at-create]
      usesStorage: payloadUsesStorage(input.payload), // hosting.uses-storage.chrome-only
      now: (deps.now ?? (() => new Date()))(),
    });
    // A fresh id at revision 0: a conflict here is a bug, so it surfaces (S60).
    artefact = await deps.repo.save(artefact);
  } catch (err) {
    // Don't leak an orphaned payload file if the aggregate is rejected
    // (e.g. empty title) or persistence fails.
    await deps.payloadStore.delete(stored.ref).catch(() => {});
    throw err;
  }
  // Outside the rollback: a thumbnail never blocks or fails the create
  // (hosting.thumbnail.never-blocks-command).
  // r[impl hosting.thumbnail.create-enqueues-once]
  enqueueThumbnail(deps.thumbnails, artefact);
  return artefact;
}
