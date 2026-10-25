import type { ReactNode } from "react";
import { ArrowUpDown, ChevronDown, FilePlus, Filter, Folder, FunnelX, LayoutGrid, List, Plus, Shapes, type LucideIcon } from "lucide-react";
import type { ArtefactSummary, CollectionSummary, SharedArtefactSummary } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "$lib/components/ui/toggle-group";
import {
  DENSITIES,
  SORT_LABELS,
  SORTS,
  type AccessFilter,
  type Chip,
  type Density,
  type KindFilter,
  type Sort,
} from "../browse";
import { count, KINDS, VIS } from "../format";
import { HOME_SCOPE_LABELS, HOME_SCOPES, type HomeScope } from "../home";
import { hueVars } from "../style";
import { ArtefactCard, type OwnedItemProps, type SharedItemProps } from "./ArtefactCard";
import { ArtefactRow } from "./ArtefactRow";

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>;
}

/** A screen's title block beside its view controls. */
export function ScreenHeader({ children, controls }: { children: ReactNode; controls?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">{children}</div>
      {controls && <div className="flex shrink-0 items-center gap-2.5">{controls}</div>}
    </div>
  );
}

export function ScreenTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </>
  );
}

// Access filter (by effective tier) · sort · grid/list density.
export function ViewControls({
  access,
  onAccess,
  sort,
  onSort,
  density,
  onDensity,
}: {
  // Hidden when omitted (a collection page has one tier tree-wide).
  access?: { chips: Chip<AccessFilter>[]; value: AccessFilter };
  onAccess?: (v: AccessFilter) => void;
  // Hidden when omitted (an artefact-less collection page).
  sort?: Sort;
  onSort: (s: Sort) => void;
  density: Density;
  onDensity: (d: Density) => void;
}) {
  const current = access && access.value !== "all" ? VIS[access.value] : null;
  const AccessIcon = current?.icon ?? Filter;
  return (
    <>
      {access && access.chips.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <AccessIcon />
              {current ? current.label : "All access"}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuRadioGroup value={access.value} onValueChange={(v) => onAccess?.(v as AccessFilter)}>
              {access.chips.map((chip) => {
                const Icon = chip.key === "all" ? Filter : VIS[chip.key].icon;
                return (
                  <DropdownMenuRadioItem key={chip.key} value={chip.key}>
                    <Icon />
                    <span className="flex-1">{chip.label}</span>
                    <Badge variant="secondary">{chip.count}</Badge>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {sort && <SortMenu sort={sort} onSort={onSort} />}
      <DensityToggle density={density} onDensity={onDensity} />
    </>
  );
}

// S82 — the one Sort menu Home and collection pages share (hosting.browse.one-sort).
function SortMenu({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={`Sort: ${SORT_LABELS[sort]}`}>
          <ArrowUpDown />
          {SORT_LABELS[sort]}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as Sort)}>
          {SORTS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Kind chips (filter by type); access is filtered via the dropdown.
export function KindChips({
  chips,
  value,
  onChange,
}: {
  chips: Chip<KindFilter>[];
  value: KindFilter;
  onChange: (k: KindFilter) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={2}
      value={value}
      onValueChange={(v) => v && onChange(v as KindFilter)}
      className="mb-5 flex-wrap"
      aria-label="Filter by kind"
    >
      {chips.map((chip) => (
        <ToggleGroupItem
          key={chip.key}
          value={chip.key}
          className="rounded-full data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {chip.label}
          <Badge variant="secondary" className="rounded-full px-1.5">
            {chip.count}
          </Badge>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function EmptyState({
  title,
  sub,
  onUpload,
  onClear,
}: {
  title: string;
  sub: string;
  // The "Upload your first artefact" call to action, when there is one.
  onUpload?: () => void;
  // S47 — "Clear filters", when the filters are what emptied the list.
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-dashed px-6 py-16 text-center">
      <div className="mb-2 flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FilePlus className="size-6.5" strokeWidth={1.7} />
      </div>
      <div className="text-base font-semibold">{title}</div>
      <div className="max-w-sm text-sm text-muted-foreground">{sub}</div>
      {onUpload && (
        <Button className="mt-3.5" onClick={onUpload}>
          <Plus />
          Upload your first artefact
        </Button>
      )}
      {onClear && (
        <Button variant="outline" className="mt-3.5" onClick={onClear}>
          <FunnelX />
          Clear filters
        </Button>
      )}
    </div>
  );
}

// S47 — one filter dropdown (Type or Access) over chips with counts.
function FilterDropdown<K extends string>({
  label,
  chips,
  value,
  onChange,
  iconOf,
}: {
  label: string;
  chips: Chip<K>[];
  value: K;
  onChange: (v: K) => void;
  iconOf: (key: K) => LucideIcon;
}) {
  const current = chips.find((c) => c.key === value);
  const Icon = iconOf(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={`${label}: ${current?.label ?? value}`}>
          <Icon />
          {current?.label ?? chips[0]?.label}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as K)}>
          {chips.map((chip) => {
            const ChipIcon = iconOf(chip.key);
            return (
              <DropdownMenuRadioItem key={chip.key} value={chip.key}>
                <ChipIcon />
                <span className="flex-1">{chip.label}</span>
                <Badge variant="secondary">{chip.count}</Badge>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// S47 — Home's filter and sort bar: the All / My artefacts / Shared with me
// switch with counts, Type and Access on the left; Sort and the card/list toggle
// on the right. It wraps by its container's width, never the viewport's: one
// line when wide; the switch on its own line when narrower; and at the
// narrowest Type + Access on one line, Sort + the toggle on the next.
export function HomeControls({
  scope,
  counts,
  onScope,
  kind,
  onKind,
  access,
  onAccess,
  sort,
  onSort,
  density,
  onDensity,
}: {
  scope: HomeScope;
  counts: Record<HomeScope, number>;
  onScope: (s: HomeScope) => void;
  kind: { chips: Chip<KindFilter>[]; value: KindFilter };
  onKind: (k: KindFilter) => void;
  access: { chips: Chip<AccessFilter>[]; value: AccessFilter };
  onAccess: (a: AccessFilter) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  density: Density;
  onDensity: (d: Density) => void;
}) {
  return (
    <div className="@container mb-5">
      <div data-bar className="flex flex-col gap-2.5 @5xl:flex-row @5xl:items-center">
        <Tabs value={scope} onValueChange={(v) => onScope(v as HomeScope)} className="min-w-0">
          <TabsList aria-label="Whose artefacts" className="max-w-full">
            {HOME_SCOPES.map((s) => (
              // Sized to its label, not an equal share (the stock trigger is flex-1).
              <TabsTrigger key={s} value={s} className="group flex-none gap-2 px-3">
                {HOME_SCOPE_LABELS[s]}
                <Badge variant="secondary" className="rounded-full bg-transparent px-1.5 group-data-[state=active]:bg-secondary">
                  {counts[s]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2.5 @2xl:flex-row @2xl:items-center @5xl:flex-1">
          <div data-filters className="flex flex-wrap items-center gap-2.5">
            <FilterDropdown
              label="Type"
              chips={kind.chips}
              value={kind.value}
              onChange={onKind}
              iconOf={(k) => (k === "all" ? Shapes : KINDS[k].icon)}
            />
            <FilterDropdown
              label="Access"
              chips={access.chips}
              value={access.value}
              onChange={onAccess}
              iconOf={(a) => (a === "all" ? Filter : VIS[a].icon)}
            />
          </div>
          <div data-view className="flex items-center gap-2.5 @2xl:ml-auto">
            <SortMenu sort={sort} onSort={onSort} />
            <DensityToggle density={density} onDensity={onDensity} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DensityToggle({ density, onDensity }: { density: Density; onDensity: (d: Density) => void }) {
  return (
    <Tabs value={density} onValueChange={(v) => onDensity(v as Density)}>
      <TabsList>
        {DENSITIES.map((d) => {
          const Icon = d === "grid" ? LayoutGrid : List;
          const label = d === "grid" ? "Grid" : "List";
          return (
            <TabsTrigger key={d} value={d} title={label} aria-label={label} className="px-2">
              <Icon />
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

// A collection shown as a tile (sub-collections, shared trees).
export function CollectionTile({
  c,
  onOpen,
  meta,
  badge,
}: {
  c: CollectionSummary;
  onOpen: () => void;
  meta: string;
  badge?: ReactNode;
}) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- the whole collection card is its open target, a surface rather than a control
    <button
      type="button"
      onClick={onOpen}
      title={c.name}
      style={hueVars(c.id)}
      className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left text-card-foreground shadow-xs outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--hue)_14%,transparent)]">
        <Folder className="size-4 text-(--hue)" strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{c.name}</span>
          {badge}
        </div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
    </button>
  );
}

export const tileGrid = "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3";

/** "3 artefacts · 2 collections" — the collections part only when non-zero. */
export function countsLine(arts: number, colls: number): string {
  return colls > 0 ? `${count(arts, "artefact")} · ${count(colls, "collection")}` : count(arts, "artefact");
}

// Your own artefacts (as cards/rows with every control) and, on a collection
// page, others' (S62 — the same card and row, in their viewer variant), in the
// chosen density.
export function ItemList({
  density,
  owned,
  others,
  ownedProps,
  sharedProps,
}: {
  density: Density;
  owned: ArtefactSummary[];
  others: SharedArtefactSummary[];
  ownedProps: (a: ArtefactSummary) => OwnedItemProps;
  sharedProps: (g: SharedArtefactSummary) => SharedItemProps;
}) {
  if (density === "grid")
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
        {owned.map((a) => (
          <ArtefactCard key={a.id} {...ownedProps(a)} />
        ))}
        {others.map((g) => (
          <ArtefactCard key={g.id} {...sharedProps(g)} />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {owned.map((a) => (
        <ArtefactRow key={a.id} {...ownedProps(a)} />
      ))}
      {others.map((g) => (
        <ArtefactRow key={g.id} {...sharedProps(g)} />
      ))}
    </div>
  );
}
