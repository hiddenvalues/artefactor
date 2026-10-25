import type { ArtefactSummary, SharedArtefactSummary } from "../../shared/contracts";
import type { AccessFilter, KindFilter } from "./browse";

// S47 — Home: the pure model behind its Recent row, the All / My artefacts /
// Shared with me switch, the two sorts and the pager.
// r[impl hosting.home.model]

export const HOME_SCOPES = ["all", "mine", "shared"] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];
export const HOME_SCOPE_LABELS: Record<HomeScope, string> = {
  all: "All",
  mine: "My artefacts",
  shared: "Shared with me",
};

export const HOME_SORTS = ["updated", "viewed"] as const;
export type HomeSort = (typeof HOME_SORTS)[number];
export const HOME_SORT_LABELS: Record<HomeSort, string> = {
  updated: "Last edited or uploaded",
  viewed: "Last viewed",
};

export const PAGE_SIZE = 24;
export const RECENT_CAP = 12;

/** An artefact on Home: one you own, or another user's shared with you. */
export type HomeItem = ArtefactSummary | SharedArtefactSummary;
/** The caller's own views: artefact id → ISO `viewedAt` (views.mine.own-visible-only). */
export type Views = ReadonlyMap<string, string>;

export const isShared = (a: HomeItem): a is SharedArtefactSummary => "owner" in a;

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

export function scopeList(owned: ArtefactSummary[], shared: SharedArtefactSummary[], scope: HomeScope): HomeItem[] {
  if (scope === "mine") return owned;
  if (scope === "shared") return shared;
  return [...owned, ...shared];
}

/** Library totals for the switch — never narrowed by Type or Access. */
export function scopeCounts(owned: ArtefactSummary[], shared: SharedArtefactSummary[]): Record<HomeScope, number> {
  return { all: owned.length + shared.length, mine: owned.length, shared: shared.length };
}

/** What you most recently acted on: your latest view of it or, for your own,
 *  its last edit or upload. A shared artefact you never opened is left out. */
export function recentList(
  owned: ArtefactSummary[],
  shared: SharedArtefactSummary[],
  views: Views,
  cap = RECENT_CAP,
): HomeItem[] {
  const ranked: [HomeItem, number][] = [
    ...owned.map((a): [HomeItem, number] => [a, Math.max(time(a.updatedAt), time(views.get(a.id)))]),
    ...shared.filter((g) => views.has(g.id)).map((g): [HomeItem, number] => [g, time(views.get(g.id))]),
  ];
  return ranked
    .sort((x, y) => y[1] - x[1])
    .slice(0, cap)
    .map(([a]) => a);
}

/** `viewed`: your views newest first, then never-viewed by `updatedAt`.
 *  `updated`: by `updatedAt`, newest first. */
export function sortHome<T extends HomeItem>(list: T[], sort: HomeSort, views: Views): T[] {
  const byUpdated = (x: T, y: T) => time(y.updatedAt) - time(x.updatedAt);
  const a = [...list];
  if (sort === "updated") return a.sort(byUpdated);
  return a.sort((x, y) => {
    const vx = views.get(x.id);
    const vy = views.get(y.id);
    if (vx && vy) return time(vy) - time(vx);
    if (vx || vy) return vx ? -1 : 1;
    return byUpdated(x, y);
  });
}

export interface HomeFilters {
  kind: KindFilter;
  access: AccessFilter;
  sort: HomeSort;
}

export function applyHomeFilters<T extends HomeItem>(list: T[], f: HomeFilters, views: Views): T[] {
  return sortHome(
    list
      .filter((a) => f.kind === "all" || a.kind === f.kind)
      .filter((a) => f.access === "all" || a.effectiveVisibility === f.access),
    f.sort,
    views,
  );
}

/** A fresh `/api/views/mine` answer folded into the views you hold: the later
 *  timestamp wins per artefact, so a response already in flight when you opened
 *  something can't undo that open's local stamp. An entry the server dropped
 *  (archived, unshared) may linger; nothing looks it up, since Recent and the
 *  sort read views only for listed artefacts. */
export function mergeViews(current: Views, server: { artefactId: string; viewedAt: string }[]): Map<string, string> {
  const next = new Map(server.map((v) => [v.artefactId, v.viewedAt]));
  for (const [id, at] of current) {
    const theirs = next.get(id);
    if (!theirs || time(at) > time(theirs)) next.set(id, at);
  }
  return next;
}

/** One page of `list`, with `page` clamped to 1…pageCount. */
export function paginate<T>(list: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return { items: list.slice((p - 1) * size, p * size), page: p, pageCount };
}
