import type { ArtefactSummary } from "../../shared/contracts";
import type { ArtefactKind } from "../../domain/artefact/kind";
import { KIND_ORDER, KINDS, VIS, VIS_ORDER, type Visibility } from "./format";

// S82 — Home and collection pages share one Sort menu. A remembered value
// outside it (S65's retired "size") falls back to the default on restore
// (`prefs.ts`).
export const SORTS = ["updated", "viewed", "title"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  updated: "Last updated",
  viewed: "Last viewed",
  title: "Title A–Z",
};
export const DENSITIES = ["grid", "list"] as const;
export type Density = (typeof DENSITIES)[number];
export type KindFilter = "all" | ArtefactKind;
export type AccessFilter = "all" | Visibility;
/** The caller's own views: artefact id → ISO `viewedAt` (views.mine.own-visible-only). */
export type Views = ReadonlyMap<string, string>;

/** The filters a listing screen applies, all persisted. (S46 — the top bar's
 *  search is global, so text no longer filters a page.) */
export interface Filters {
  kind: KindFilter;
  access: AccessFilter;
  sort: Sort;
}

export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || title.toLowerCase().includes(q);
}

/** An ISO timestamp in ms; a missing one sorts last. */
export const time = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

/** `updated`: by `updatedAt`, newest first. `viewed`: your views newest first,
 *  then never-viewed by `updatedAt`. `title`: A–Z. */
// r[impl hosting.browse.one-sort]
export function sortList<T extends ArtefactSummary>(list: T[], sort: Sort, views: Views): T[] {
  const byUpdated = (x: T, y: T) => time(y.updatedAt) - time(x.updatedAt);
  const a = [...list];
  if (sort === "title") return a.sort((x, y) => x.title.localeCompare(y.title));
  if (sort === "updated") return a.sort(byUpdated);
  return a.sort((x, y) => {
    const vx = views.get(x.id);
    const vy = views.get(y.id);
    if (vx && vy) return time(vy) - time(vx);
    if (vx || vy) return vx ? -1 : 1;
    return byUpdated(x, y);
  });
}

/** Filter + sort a list. `withAccess: false` ignores the access filter (a
 *  collection page has one tier tree-wide). */
// r[impl platform.search.filters-ignore-text]
export function applyFilters<T extends ArtefactSummary>(list: T[], f: Filters, views: Views, withAccess = true): T[] {
  return sortList(
    list
      .filter((a) => f.kind === "all" || a.kind === f.kind)
      .filter((a) => !withAccess || f.access === "all" || a.effectiveVisibility === f.access),
    f.sort,
    views,
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

// A collection page shows its kind chips only when it holds more than one kind
// — or while a kind filter is active, so a filter that now matches nothing can
// still be cleared.
export function showCollectionKindChips(chips: Chip<KindFilter>[], kind: KindFilter): boolean {
  return chips.length > 2 || kind !== "all";
}

// A collection page offers sorting whenever it lists any artefact — yours or
// others' (a contributor's, or the owner's in a shared tree).
export function showCollectionSort(mine: ArtefactSummary[], theirs: ArtefactSummary[]): boolean {
  return mine.length + theirs.length > 0;
}

// Access chips, mirroring kindChips but over the *effective* tiers
// (hosting.access.effective-from-tree-root).
export function accessChips(base: ArtefactSummary[]): Chip<AccessFilter>[] {
  const chips: Chip<AccessFilter>[] = [{ key: "all", label: "All access", count: base.length }];
  for (const v of VIS_ORDER) {
    const n = base.filter((x) => x.effectiveVisibility === v).length;
    if (n > 0) chips.push({ key: v, label: VIS[v].label, count: n });
  }
  return chips;
}
