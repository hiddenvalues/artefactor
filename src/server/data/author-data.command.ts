import type { DataEntry } from "../../domain/data/data-entry";
import type { DataAuthorRef } from "../../domain/data/data-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import { canLoadAuthorData } from "../../domain/artefact/access";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import {
  resolveViewableArtefact,
  type DataAccessDeps,
} from "./own-data.command";

// Application commands for S12 — the host data-context switcher. They power the
// cross-author *read* path: list which authors hold an entry, and load one
// author's blob so the host can re-seed the served artefact read-only.
//
// Read access follows the Artefact access matrix, not authorship: a viewer who
// may view the artefact (AD4) may load **any** author's entry — narrowed by the
// owner's data visibility (S41, AD11): under `own` a non-owner loads only their
// own, and the author list shows only what they may load. Crucially these
// are NOT auth-gated by the caller's identity — an unauthenticated viewer of a
// `public` artefact may read others' entries (they simply cannot write, AD5).
// Missing / archived / not-viewable artefact → not-found, exactly like own-data.

// List the authors who have a data entry for the referenced artefact.
export async function listDataAuthors(
  ref: string,
  viewerId: string | null,
  scope: TenantScope,
  deps: DataAccessDeps,
): Promise<DataAuthorRef[]> {
  const artefact = await resolveViewableArtefact(deps, ref, viewerId, scope);
  const authors = await deps.dataRepo.listAuthorsByArtefact(artefact.id);
  // AD11 — only the authors this viewer may load; never a refusal of the list.
  return authors.filter((a) => canLoadAuthorData(artefact, viewerId, a.authorId));
}

// Load one author's blob for seeding/switching. Returns null when that author
// has no entry (the host treats it as an empty read-only context).
export async function getAuthorDataEntry(
  ref: string,
  viewerId: string | null,
  authorId: string,
  scope: TenantScope,
  deps: DataAccessDeps,
): Promise<DataEntry | null> {
  const artefact = await resolveViewableArtefact(deps, ref, viewerId, scope);
  // AD11 — a refused author is a flat not-found, whether or not they hold an entry.
  if (!canLoadAuthorData(artefact, viewerId, authorId)) {
    throw new ArtefactNotFound(ref);
  }
  return deps.dataRepo.findByArtefactAndAuthor(artefact.id, authorId);
}
