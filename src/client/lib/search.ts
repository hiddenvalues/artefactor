import type {
  ArtefactSummary,
  CollectionSummary,
  SharedArtefactSummary,
  SharedCollectionSummary,
} from "../../shared/contracts";
import type { ArtefactKind } from "../../domain/artefact/kind";
import { matchesQuery } from "./browse";

// S46 — the top bar's global search: everything the shell already loads (own
// artefacts and collections, others' shared artefacts and trees), matched by
// title, never a new query. Pure; the TopBar renders what it returns.

export const MAX_COLLECTION_HITS = 3;
export const MAX_ARTEFACT_HITS = 5;

interface HitBase {
  id: string;
  title: string;
  /** Where the hit lives, or who shared it. */
  meta: string;
  updatedAt: string;
}
export interface CollectionHit extends HitBase {
  kind: "collection";
  collection: CollectionSummary;
}
export interface ArtefactHit extends HitBase {
  kind: "artefact";
  artefactKind: ArtefactKind;
  artefact: ArtefactSummary;
  /** Set for another user's artefact, which opens by its slug link rather
   *  than the owner preview. */
  shared: SharedArtefactSummary | null;
}
export type Hit = CollectionHit | ArtefactHit;

export interface SearchResults {
  collections: CollectionHit[];
  artefacts: ArtefactHit[];
}

export interface SearchInput {
  owned: ArtefactSummary[];
  shared: SharedArtefactSummary[];
  collections: CollectionSummary[];
  sharedCollections: SharedCollectionSummary[];
  collectionById: Map<string, CollectionSummary>;
}

export const EMPTY_RESULTS: SearchResults = { collections: [], artefacts: [] };

const newestFirst = (a: HitBase, b: HitBase) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

export function searchLibrary(input: SearchInput, query: string): SearchResults {
  if (!query.trim()) return EMPTY_RESULTS;
  const nameOf = (id: string | null, fallback: string) => (id && input.collectionById.get(id)?.name) || fallback;

  const collections: CollectionHit[] = [
    ...input.collections.map((c) => ({ c, meta: nameOf(c.parentId, "Your collections") })),
    ...input.sharedCollections.map((c) => ({ c, meta: `Shared by ${c.owner.name || c.owner.email}` })),
  ]
    .filter(({ c }) => matchesQuery(c.name, query))
    .map(({ c, meta }) => ({ kind: "collection" as const, id: c.id, title: c.name, meta, updatedAt: c.updatedAt, collection: c }));

  const artefacts: ArtefactHit[] = [
    ...input.owned.map((a) => ({ a, meta: nameOf(a.collectionId, "Your artefacts"), shared: null })),
    ...input.shared.map((a) => ({ a, meta: `Shared by ${a.owner.name || a.owner.email}`, shared: a })),
  ]
    .filter(({ a }) => matchesQuery(a.title, query))
    .map(({ a, meta, shared }) => ({
      kind: "artefact" as const,
      id: a.id,
      title: a.title,
      meta,
      updatedAt: a.updatedAt,
      artefactKind: a.kind,
      artefact: a,
      shared,
    }));

  return {
    collections: collections.sort(newestFirst).slice(0, MAX_COLLECTION_HITS),
    artefacts: artefacts.sort(newestFirst).slice(0, MAX_ARTEFACT_HITS),
  };
}

/** `[before, match, after]` around the first case-insensitive match; the whole
 *  title first when there is none. */
export function highlight(title: string, query: string): [string, string, string] {
  const q = query.trim().toLowerCase();
  const at = q ? title.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [title, "", ""];
  return [title.slice(0, at), title.slice(at, at + q.length), title.slice(at + q.length)];
}
