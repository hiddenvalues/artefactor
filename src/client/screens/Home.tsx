import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import type { ArtefactSummary, SharedArtefactSummary } from "../../shared/contracts";
import { accessChips, kindChips, type AccessFilter, type Density, type KindFilter, type Sort, type Views } from "$lib/browse";
import { ArtefactCard, type ArtefactItemProps } from "$lib/components/ArtefactCard";
import { ArtefactRow } from "$lib/components/ArtefactRow";
import { EmptyState, HomeControls } from "$lib/components/Browse";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "$lib/components/ui/pagination";
import { Skeleton } from "$lib/components/ui/skeleton";
import {
  applyHomeFilters,
  paginate,
  recentList,
  scopeCounts,
  scopeList,
  type HomeItem,
  type HomeScope,
} from "$lib/home";
import { cn } from "$lib/utils";

const cardGrid = "grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4";

// Home's two section headings, as the prototype has them: sentence case, not
// the small uppercase SectionLabel.
function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-lg font-semibold tracking-tight">{children}</h2>;
}

// S47 — Home: the one landing screen. Recent (what you last edited, uploaded or
// opened, yours or shared), then the filter and sort bar over All artefacts,
// paginated. Every item is an ArtefactCard / ArtefactRow — shared ones in their
// shared mode.
// r[impl hosting.home.screen]
export function Home({
  owned,
  shared,
  views,
  loaded,
  scope,
  onScope,
  kind,
  onKind,
  access,
  onAccess,
  sort,
  onSort,
  density,
  onDensity,
  itemProps,
  onUpload,
  headingRef,
}: {
  owned: ArtefactSummary[];
  shared: SharedArtefactSummary[];
  views: Views;
  loaded: boolean;
  scope: HomeScope;
  onScope: (s: HomeScope) => void;
  kind: KindFilter;
  onKind: (k: KindFilter) => void;
  access: AccessFilter;
  onAccess: (a: AccessFilter) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  density: Density;
  onDensity: (d: Density) => void;
  itemProps: (a: HomeItem) => ArtefactItemProps;
  onUpload: () => void;
  // S80 — the main heading, which a host can focus (after an org switch).
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  // The page isn't persisted; any change to what's listed starts over at 1.
  const [page, setPage] = useState(1);
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setPage(1);
      set(v);
    };

  const base = scopeList(owned, shared, scope);
  const visible = applyHomeFilters(base, { kind, access, sort }, views);
  const paged = paginate(visible, page);
  const recent = recentList(owned, shared, views);

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Home
      </h1>
      {loaded && recent.length > 0 && (
        <section aria-label="Recent" className="mb-10">
          <SectionHeading>Recent</SectionHeading>
          <RecentRow items={recent} itemProps={itemProps} />
        </section>
      )}

      <section aria-label="All artefacts">
        <SectionHeading>All artefacts</SectionHeading>
        <HomeControls
          scope={scope}
          counts={scopeCounts(owned, shared)}
          onScope={reset(onScope)}
          kind={{ chips: kindChips(base), value: kind }}
          onKind={reset(onKind)}
          access={{ chips: accessChips(base), value: access }}
          onAccess={reset(onAccess)}
          sort={sort}
          onSort={reset(onSort)}
          density={density}
          onDensity={onDensity}
        />
        {!loaded ? (
          <Placeholders density={density} />
        ) : base.length === 0 ? (
          scope === "shared" ? (
            <EmptyState
              title="Nothing has been shared with you yet."
              sub="When teammates share artefacts with you, they’ll show up here."
            />
          ) : (
            <EmptyState
              title="No artefacts yet"
              sub="Upload an HTML deliverable from Claude — a prototype, deck, form or doc — and it lives here."
              onUpload={onUpload}
            />
          )
        ) : visible.length === 0 ? (
          // Only the filters can empty a non-empty scope; clearing them keeps the switch.
          <EmptyState
            title="No matches"
            sub="No artefacts match your current filters."
            onClear={() => {
              setPage(1);
              onKind("all");
              onAccess("all");
            }}
          />
        ) : (
          <>
            <Items density={density} items={paged.items} itemProps={itemProps} />
            <Pager page={paged.page} pageCount={paged.pageCount} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}

function Items({
  density,
  items,
  itemProps,
}: {
  density: Density;
  items: HomeItem[];
  itemProps: (a: HomeItem) => ArtefactItemProps;
}) {
  if (density === "grid")
    return (
      <div className={cardGrid}>
        {items.map((a) => (
          <ArtefactCard key={a.id} {...itemProps(a)} />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((a) => (
        <ArtefactRow key={a.id} {...itemProps(a)} />
      ))}
    </div>
  );
}

// Recent is always one row of cards: the grid's own auto-fill column count
// (read back from its resolved tracks) decides how many of the items it shows.
function RecentRow({ items, itemProps }: { items: HomeItem[]; itemProps: (a: HomeItem) => ArtefactItemProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(items.length);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      setColumns(Math.max(1, tracks));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-recent className={cardGrid}>
      {items.slice(0, columns).map((a) => (
        <ArtefactCard key={a.id} {...itemProps(a)} />
      ))}
    </div>
  );
}

// Loading: placeholder cards or rows in the chosen density.
function Placeholders({ density }: { density: Density }) {
  const n = density === "grid" ? 8 : 6;
  return (
    <div aria-busy="true" aria-label="Loading artefacts" className={density === "grid" ? cardGrid : "flex flex-col gap-2.5"}>
      {Array.from({ length: n }, (_, i) =>
        density === "grid" ? (
          <div key={i} className="flex flex-col gap-3 rounded-xl border p-3.5">
            <Skeleton className="aspect-[16/10] w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : (
          <div key={i} className="flex items-center gap-3.5 rounded-xl border px-3.5 py-2.5">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

// The page numbers to show: all of them when few, else the ends and the
// current page's neighbours, with gaps as ellipses.
function pageList(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - last > 1) out.push("gap");
    out.push(p);
    last = p;
  }
  return out;
}

// All artefacts' pager — hidden when everything fits on one page.
function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const go = (p: number) => (e: MouseEvent) => {
    e.preventDefault();
    if (p >= 1 && p <= pageCount && p !== page) onPage(p);
  };
  const off = "pointer-events-none opacity-50";
  return (
    <Pagination className="mt-6">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" onClick={go(page - 1)} aria-disabled={page === 1} className={cn(page === 1 && off)} />
        </PaginationItem>
        {pageList(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink href="#" isActive={p === page} onClick={go(p)} aria-label={`Page ${p}`}>
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={go(page + 1)}
            aria-disabled={page === pageCount}
            className={cn(page === pageCount && off)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
