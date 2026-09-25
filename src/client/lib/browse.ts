import type { ArtefactSummary } from "../../shared/contracts";
import type { ArtefactKind } from "../../domain/artefact/kind";
import { KIND_ORDER, KINDS, VIS, VIS_ORDER, type Visibility } from "./format";

export const SORTS = ["updated", "title", "size"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  updated: "Recently updated",
  title: "Title A–Z",
  size: "Largest first",
};
export const DENSITIES = ["grid", "list"] as const;
export type Density = (typeof DENSITIES)[number];
export type KindFilter = "all" | ArtefactKind;
export type AccessFilter = "all" | Visibility;

/** The filters a listing screen applies, all persisted but the query. */
export interface Filters {
  kind: KindFilter;
  access: AccessFilter;
  sort: Sort;
  query: string;
}

export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || title.toLowerCase().includes(q);
}

export function sortList<T extends ArtefactSummary>(list: T[], sort: Sort): T[] {
  const a = [...list];
  if (sort === "title") a.sort((x, y) => x.title.localeCompare(y.title));
  else if (sort === "size") a.sort((x, y) => y.payloadBytes - x.payloadBytes);
  else a.sort((x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime());
  return a;
}

/** Filter + sort a list. `withAccess: false` ignores the access filter (a
 *  collection page has one tier tree-wide). */
export function applyFilters<T extends ArtefactSummary>(list: T[], f: Filters, withAccess = true): T[] {
  return sortList(
    list
      .filter((a) => f.kind === "all" || a.kind === f.kind)
      .filter((a) => !withAccess || f.access === "all" || a.effectiveVisibility === f.access)
      .filter((a) => matchesQuery(a.title, f.query)),
    f.sort,
  );
}

export interface Chip<K extends string> {
  key: K;
  label: string;
  count: number;
}

// Kind chips with counts, from the screen's base list. Counts are per dimension
// (independent of the access filter) so toggling access never makes a type pill
// vanish; a zero-result combination is handled by the empty state.
export function kindChips(base: ArtefactSummary[]): Chip<KindFilter>[] {
  const chips: Chip<KindFilter>[] = [{ key: "all", label: "All types", count: base.length }];
  for (const k of KIND_ORDER) {
    const n = base.filter((x) => x.kind === k).length;
    if (n > 0) chips.push({ key: k, label: KINDS[k].label, count: n });
  }
  return chips;
}

// Access chips, mirroring kindChips but over the *effective* tiers (AH20).
export function accessChips(base: ArtefactSummary[]): Chip<AccessFilter>[] {
  const chips: Chip<AccessFilter>[] = [{ key: "all", label: "All access", count: base.length }];
  for (const v of VIS_ORDER) {
    const n = base.filter((x) => x.effectiveVisibility === v).length;
    if (n > 0) chips.push({ key: v, label: VIS[v].label, count: n });
  }
  return chips;
}
