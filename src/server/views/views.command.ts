import { randomUUID } from "node:crypto";
import { canViewArtefact } from "../../domain/artefact/access";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { resolveEffectiveViewable } from "../collections/effective";
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
) {
  // Slug = global capability (AH6); id fallback is tenant-scoped (S22/T2).
  const artefact =
    (await deps.artefactRepo.findBySlug(ref)) ??
    (await deps.artefactRepo.findById(ref, scope));
  if (
    !artefact ||
    // The matrix decides on the effective tier (AH20/CL5).
    !canViewArtefact(
      await resolveEffectiveViewable(artefact, deps.collectionRepo),
      viewerId,
    )
  ) {
    throw new ArtefactNotFound(ref);
  }
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
): Promise<ViewerRef[]> {
  const artefact = await resolveViewableArtefact(deps, ref, viewerId, scope);
  const viewers = await deps.viewRepo.listViewersByArtefact(artefact.id);
  return viewers.filter((v) => v.viewerId !== viewerId);
}
