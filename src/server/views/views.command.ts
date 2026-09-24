import { randomUUID } from "node:crypto";
import type { AccessPolicy } from "../../domain/artefact/access";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { authorizeRead } from "../link-gate/authorize";
import type { PassLookup } from "../link-gate/passes";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { recordView } from "../../domain/views/view-entry";
import type {
  ViewerRef,
  ViewRepository,
} from "../../domain/views/view-repository";

// Application commands for S21 — Artefact Views. They record that a signed-in
// viewer opened an artefact (latest view only, VT1) and list who has viewed it.
// The list-path resolves the artefact by reference (slug or id) under the
// Artefact access matrix, exactly like the Artefact Data commands.

export interface RecordViewDeps {
  viewRepo: ViewRepository;
  newId?: () => string;
  now?: () => Date;
}

// Record a view for an already-resolved, already-access-checked artefact (VT3).
// Upserts the single (artefact, viewer) entry — first view creates it, later
// views bump `viewedAt`. The caller is the serving route, which has the artefact
// in hand and has passed the access matrix, so no re-resolution is needed.
export async function recordArtefactView(
  artefactId: string,
  viewerId: string,
  deps: RecordViewDeps,
): Promise<void> {
  const existing = await deps.viewRepo.findByArtefactAndViewer(
    artefactId,
    viewerId,
  );
  const entry = recordView({
    id: (deps.newId ?? randomUUID)(),
    artefactId,
    viewerId,
    existing,
    now: (deps.now ?? (() => new Date()))(),
  });
  await deps.viewRepo.save(entry);
}

export interface ListViewersDeps {
  artefactRepo: ArtefactRepository;
  // AH20 — the access decision needs the effective tier (collection tree root).
  collectionRepo: CollectionRepository;
  viewRepo: ViewRepository;
  // S22 (AH18) — the slug resolve is tenant-global (AH6), so the per-tier
  // tenant decision is the policy's. Default = the OSS matrix.
  accessPolicy?: AccessPolicy;
}

// Resolve the artefact a viewers request targets — by slug, falling back to id —
// then apply the access matrix against the viewer. Missing / archived /
// not-viewable all → not-found (mirrors `resolveViewableArtefact` in the data
// commands; kept local so Views does not depend on the Data module).
async function resolveViewableArtefact(
  deps: ListViewersDeps,
  ref: string,
  viewerId: string | null,
  scope: TenantScope,
  passes?: PassLookup,
) {
  // Slug = global capability (AH6); id fallback is tenant-scoped (S22/T2).
  const artefact =
    (await deps.artefactRepo.findBySlug(ref)) ??
    (await deps.artefactRepo.findById(ref, scope));
  if (!artefact) throw new ArtefactNotFound(ref);
  // The matrix on the effective tier (AH20/CL5), then the link gate (S32a).
  const verdict = await authorizeRead(deps, artefact, viewerId, { passes });
  if (verdict === "challenge") throw new LinkGateChallenge(ref);
  if (verdict !== "granted") throw new ArtefactNotFound(ref);
  return artefact;
}

// List the artefact's viewers, **excluding the requesting viewer** (VT4): the
// caller wants to know who *else* has viewed it. Access follows the artefact
// matrix — any signed-in viewer who may see the artefact may see its viewers.
export async function listArtefactViewers(
  ref: string,
  viewerId: string,
  scope: TenantScope,
  deps: ListViewersDeps,
  passes?: PassLookup,
): Promise<ViewerRef[]> {
  const artefact = await resolveViewableArtefact(deps, ref, viewerId, scope, passes);
  const viewers = await deps.viewRepo.listViewersByArtefact(artefact.id);
  return viewers.filter((v) => v.viewerId !== viewerId);
}
