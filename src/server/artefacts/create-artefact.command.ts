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
  ownerId: string;
  title: string;
  kind: string; // unvalidated; checked against the closed kind enum here
  payload: Uint8Array; // raw trusted HTML bytes
  // S22/AH17 — the owning tenant. Omitted by OSS callers (the factory defaults
  // to DEFAULT_TENANT, byte-identical); a multi-tenant superset passes the
  // creator's active org so the artefact is stamped with its tenant (ET2/T1).
  tenantId?: string;
}

export interface CreateArtefactDeps {
  repo: ArtefactRepository;
  payloadStore: PayloadStore;
  newId?: () => string;
  now?: () => Date;
  // S35 (AH25) — renders the thumbnail after the save; absent = none.
  thumbnails?: ThumbnailQueue;
}

export async function createArtefactCommand(
  input: CreateArtefactInput,
  deps: CreateArtefactDeps,
): Promise<Artefact> {
  // Cheap pre-validation before touching the filesystem: reject unknown kinds
  // and obviously-bad payloads so we never write an empty/oversize file. The
  // domain factory below re-checks these as the invariant authority (AH 2, 3).
  if (!isArtefactKind(input.kind)) {
    throw new InvariantViolation(`unknown artefact kind: ${input.kind}`);
  }
  if (input.payload.byteLength === 0) {
    throw new InvariantViolation("payload must not be empty"); // AH2
  }
  if (input.payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new InvariantViolation("payload exceeds the 100 MB cap"); // AH2
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
      tenantId: input.tenantId, // AH17 — undefined ⇒ DEFAULT_TENANT (OSS)
      usesStorage: payloadUsesStorage(input.payload), // AH16
      now: (deps.now ?? (() => new Date()))(),
    });
    await deps.repo.save(artefact);
  } catch (err) {
    // Don't leak an orphaned payload file if the aggregate is rejected
    // (e.g. empty title) or persistence fails.
    await deps.payloadStore.delete(stored.ref).catch(() => {});
    throw err;
  }
  // Outside the rollback: a thumbnail never blocks or fails the create (AH25).
  enqueueThumbnail(deps.thumbnails, artefact);
  return artefact;
}
