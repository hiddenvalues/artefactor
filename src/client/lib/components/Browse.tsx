import type { ReactNode } from "react";
import { ArrowUpDown, ChevronDown, FilePlus, Filter, Folder, LayoutGrid, List, Plus } from "lucide-react";
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
import { count, VIS } from "../format";
import { hueVars } from "../style";
import { ArtefactCard, ArtefactRow, type OwnedItemProps } from "./ArtefactCard";
import { GalleryCard, GalleryRow, type GalleryItemProps } from "./GalleryCard";

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
      {sort && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
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
      )}
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
    </>
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
}: {
  title: string;
  sub: string;
  // The "Upload your first artefact" call to action, when there is one.
  onUpload?: () => void;
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
    </div>
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
    <button
      type="button"
      onClick={onOpen}
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
// page, others' (as gallery cards with attribution), in the chosen density.
export function ItemList({
  density,
  owned,
  others,
  ownedProps,
  galleryProps,
}: {
  density: Density;
  owned: ArtefactSummary[];
  others: SharedArtefactSummary[];
  ownedProps: (a: ArtefactSummary) => OwnedItemProps;
  galleryProps: (g: SharedArtefactSummary) => GalleryItemProps;
}) {
  if (density === "grid")
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
        {owned.map((a) => (
          <ArtefactCard key={a.id} {...ownedProps(a)} />
        ))}
        {others.map((g) => (
          <GalleryCard key={g.id} {...galleryProps(g)} />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {owned.map((a) => (
        <ArtefactRow key={a.id} {...ownedProps(a)} />
      ))}
      {others.map((g) => (
        <GalleryRow key={g.id} {...galleryProps(g)} />
      ))}
    </div>
  );
}
