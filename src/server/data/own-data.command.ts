import { randomUUID } from "node:crypto";
import type { AccessPolicy } from "../../domain/artefact/access";
import type { Artefact } from "../../domain/artefact/artefact";
import { ArtefactNotFound, LinkGateChallenge } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { authorizeRead } from "../link-gate/authorize";
import type { PassLookup } from "../link-gate/passes";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import {
  upsertDataEntry,
  type DataEntry,
} from "../../domain/data/data-entry";
import type { DataRepository } from "../../domain/data/data-repository";
import { DataConflict } from "../../domain/data/errors";

// Application commands for S11 — read/write the caller's own data blob. Data is
// addressed by an artefact **reference** that is either its slug (the public
// served-artefact handle) or its id (the owner-preview handle for a never-shared
// artefact that has no slug). Access follows the Artefact access matrix: an
// archived artefact, or one the caller cannot view, surfaces as not-found
// (data.read.follows-artefact-access, data.lifecycle.archived-inert, hosting.lifecycle.archived-data-inert, hosting.access.matrix).
// What `resolveViewableArtefact` needs: the artefact itself plus the collection
// tree its effective tier comes from. Narrower than a data request's deps so the
// S30 export path can inherit the same resolve without carrying a data repo.
export interface ArtefactResolveDeps {
  artefactRepo: ArtefactRepository;
  // hosting.access.effective-from-tree-root — access is decided on the *effective* tier, so
  // resolving an artefact in a collection needs its tree root.
  collectionRepo: CollectionRepository;
  // S22 (hosting.access.policy-decided) — the slug resolve below is tenant-global
  // (hosting.slug.globally-unique), so the per-tier tenant decision is the
  // policy's. Default = the OSS matrix.
  accessPolicy?: AccessPolicy;
}

// The repos a data request needs to resolve + access-check an artefact. Shared
// by the own-data (S11) and author-data (S12) commands.
export interface DataAccessDeps extends ArtefactResolveDeps {
  dataRepo: DataRepository;
}

export interface OwnDataDeps extends DataAccessDeps {
  newId?: () => string;
  now?: () => Date;
}

// Resolve the artefact a data request targets — by slug, falling back to id — then authorize the
// read (S32a, the hosting.link-gate.* requirements): the access matrix on the effective tier, then
// the link gate against the request's passes. Missing / archived / not-viewable / expired all →
// not-found; a gate asking for its password → `LinkGateChallenge`, on the slug and the id alias
// alike. (Slugs are base64url tokens and ids are uuids, so the slug→id fallback cannot
// mis-resolve.)
// r[impl hosting.lifecycle.archived-data-inert]
// r[impl data.lifecycle.archived-inert]
// r[impl data.read.follows-artefact-access]
export async function resolveViewableArtefact(
  deps: ArtefactResolveDeps,
  ref: string,
  viewerId: string | null,
  scope: TenantScope,
  passes?: PassLookup,
) {
  // The slug form is a global capability (hosting.slug.globally-unique); the id
  // fallback is tenant-scoped (S22), so an out-of-scope artefact can't be
  // reached by guessing its id.
  const artefact =
    (await deps.artefactRepo.findBySlug(ref)) ??
    (await deps.artefactRepo.findById(ref, scope));
  return authorizeResolved(deps, artefact, ref, viewerId, passes);
}

// S44 — the anonymous form of the resolve above: by slug only (the capability
// an owner hands out; an id is an internal, tenant-scoped key) and with no
// viewer, then the same authorization.
export async function resolveViewableArtefactBySlug(
  deps: ArtefactResolveDeps,
  slug: string,
  passes?: PassLookup,
) {
  return authorizeResolved(deps, await deps.artefactRepo.findBySlug(slug), slug, null, passes);
}

async function authorizeResolved(
  deps: ArtefactResolveDeps,
  artefact: Artefact | null,
  ref: string,
  viewerId: string | null,
  passes?: PassLookup,
): Promise<Artefact> {
  if (!artefact) throw new ArtefactNotFound(ref);
  const verdict = await authorizeRead(deps, artefact, viewerId, { passes });
  // r[impl hosting.link-gate.api-challenge]
  if (verdict === "challenge") throw new LinkGateChallenge(ref);
  if (verdict !== "granted") throw new ArtefactNotFound(ref);
  return artefact;
}

export interface OwnDataRef {
  ref: string; // artefact slug or id
  authorId: string; // the authenticated caller
  scope: TenantScope; // the caller's tenant scope (S22, hosting.tenant.invisible-to-oss)
  passes?: PassLookup; // S32a — the request's link passes (none over MCP)
}

// GET own entry — returns the caller's entry, or null if they have none yet.
export async function getOwnDataEntry(
  ref: OwnDataRef,
  deps: OwnDataDeps,
): Promise<DataEntry | null> {
  const artefact = await resolveViewableArtefact(
    deps,
    ref.ref,
    ref.authorId,
    ref.scope,
    ref.passes,
  );
  return deps.dataRepo.findByArtefactAndAuthor(artefact.id, ref.authorId);
}

export interface PutOwnDataOptions {
  // S31 — optimistic pin. `undefined` writes unconditionally (the `PUT
  // …/data/me` behaviour). A Date refuses the write if the stored entry was
  // updated after it; `null` means "I read no entry" and refuses if one now
  // exists. A best-effort check (read-then-save), not a transaction.
  ifUnmodifiedSince?: Date | null;
}

// PUT own entry — validate + upsert the caller's blob (data.entry.one-per-pair,
// data.blob.bounded-opaque-json), pinned to the payload it was written against.
// r[impl data.write.author-is-caller]
export async function putOwnDataEntry(
  ref: OwnDataRef,
  blob: string,
  deps: OwnDataDeps,
  options: PutOwnDataOptions = {},
): Promise<DataEntry> {
  const artefact = await resolveViewableArtefact(
    deps,
    ref.ref,
    ref.authorId,
    ref.scope,
    ref.passes,
  );
  const existing = await deps.dataRepo.findByArtefactAndAuthor(
    artefact.id,
    ref.authorId,
  );
  // r[impl data.write.stale-pin-refused]
  const pin = options.ifUnmodifiedSince;
  if (
    pin !== undefined &&
    existing &&
    (pin === null || existing.updatedAt.getTime() > pin.getTime())
  ) {
    throw new DataConflict(
      `Your saved data for this artefact changed at ${existing.updatedAt.toISOString()}, after the version you read${pin ? ` (${pin.toISOString()})` : " (no entry)"}. Nothing was written.`,
    );
  }
  const entry = upsertDataEntry({
    id: (deps.newId ?? randomUUID)(),
    artefactId: artefact.id,
    authorId: ref.authorId,
    blob,
    // r[impl data.pin.stamped-on-write]
    // Stamped here, so `PUT …/data/me` and `set_artefact_data` pin
    // identically. Advisory: nothing above reads it.
    authoredAgainstVersion: artefact.payloadHash,
    existing,
    now: (deps.now ?? (() => new Date()))(),
  });
  await deps.dataRepo.save(entry);
  return entry;
}

// DELETE own entry — remove the caller's entry (no-op if none).
export async function deleteOwnDataEntry(
  ref: OwnDataRef,
  deps: OwnDataDeps,
): Promise<void> {
  const artefact = await resolveViewableArtefact(
    deps,
    ref.ref,
    ref.authorId,
    ref.scope,
    ref.passes,
  );
  await deps.dataRepo.deleteByArtefactAndAuthor(artefact.id, ref.authorId);
}
