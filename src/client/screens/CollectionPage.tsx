import { Fragment } from "react";
import { Archive, Bookmark, ChevronRight, Folder, MoreHorizontal, Pencil } from "lucide-react";
import type {
  ArtefactSummary,
  CollectionSummary,
  SharedArtefactSummary,
  SharedCollectionSummary,
} from "../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { applyFilters, kindChips, showCollectionKindChips, showCollectionSort } from "$lib/browse";
import {
  CollectionTile,
  countsLine,
  EmptyState,
  ItemList,
  KindChips,
  ScreenHeader,
  SectionLabel,
  tileGrid,
  ViewControls,
} from "$lib/components/Browse";
import { VisibilityControl } from "$lib/components/VisibilityControl";
import { VIS, type Visibility } from "$lib/format";
import { hueVars } from "$lib/style";
import { cn } from "$lib/utils";
import type { ListingProps } from "../AppShell";

const crumb =
  "cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

// One collection's page (S25–S29). It mixes ownership: the viewer's own
// artefacts render as normal cards; others' (a contributor's in your tree, or
// the owner's in a shared tree) as gallery cards with attribution. Structure,
// access and lifecycle are owner-only (CL9).
export function CollectionPage({
  collection: c,
  isOwn,
  shared: sharedNode,
  owned,
  others,
  collectionById,
  pool,
  bookmarked,
  onToggleBookmark,
  onOpenCollection,
  onGoDashboard,
  onGoGallery,
  onChangeVisibility,
  onManage,
  onEdit,
  onNewSub,
  onArchive,
  onEject,
  filters,
  onKind,
  onSort,
  density,
  onDensity,
  ownedProps,
  galleryProps,
}: ListingProps & {
  collection: CollectionSummary;
  isOwn: boolean;
  // The S28 node for a shared page (carries canContribute + owner identity).
  shared: SharedCollectionSummary | null;
  owned: ArtefactSummary[];
  others: SharedArtefactSummary[];
  collectionById: Map<string, CollectionSummary>;
  // The page's tree: your own list on an own page, the S28 shared nodes else.
  pool: CollectionSummary[];
  bookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenCollection: (id: string) => void;
  onGoDashboard: () => void;
  onGoGallery: () => void;
  onChangeVisibility: (v: Visibility) => void;
  onManage: () => void;
  onEdit: () => void;
  onNewSub: () => void;
  onArchive: () => void;
  onEject: (g: SharedArtefactSummary) => void;
}) {
  const mine = owned.filter((a) => a.collectionId === c.id);
  const theirs = others.filter((g) => g.collectionId === c.id);
  // A collection page has one tier tree-wide: no access filter.
  const visibleMine = applyFilters(mine, filters, false);
  const visibleTheirs = applyFilters(theirs, filters, false);
  const chips = kindChips([...mine, ...theirs]);
  const filtered = filters.query.trim() !== "" || filters.kind !== "all";

  // The tree root a collection inherits from (CL4) — itself when top-level.
  const root = c.parentId === null ? c : (collectionById.get(c.rootId) ?? c);
  // Ancestor chain for the breadcrumb, root-first (excludes the node itself).
  const chain: CollectionSummary[] = [];
  for (let n = c.parentId ? collectionById.get(c.parentId) : undefined; n; n = n.parentId ? collectionById.get(n.parentId) : undefined)
    chain.unshift(n);

  const subCollections = pool.filter((x) => x.parentId === c.id).sort((a, b) => a.name.localeCompare(b.name));
  const directCounts = (x: CollectionSummary) => ({
    arts: owned.filter((a) => a.collectionId === x.id).length + others.filter((g) => g.collectionId === x.id).length,
    colls: pool.filter((y) => y.parentId === x.id).length,
  });
  const here = directCounts(c);
  const sub =
    countsLine(here.arts, here.colls) +
    (!isOwn && sharedNode ? ` · Shared by ${sharedNode.owner.name || sharedNode.owner.email}` : "");
  const rootVis = VIS[root.visibility];
  const RootIcon = rootVis.icon;

  return (
    <>
      <ScreenHeader
        controls={
          <ViewControls
            sort={showCollectionSort(mine, theirs) ? filters.sort : undefined}
            onSort={onSort}
            density={density}
            onDensity={onDensity}
          />
        }
      >
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button type="button" onClick={isOwn ? onGoDashboard : onGoGallery} className={crumb}>
            {isOwn ? "Collections" : "Shared with you"}
          </button>
          {chain.map((n) => (
            <Fragment key={n.id}>
              <ChevronRight className="size-3 opacity-60" />
              <button type="button" onClick={() => onOpenCollection(n.id)} className={crumb}>
                {n.name}
              </button>
            </Fragment>
          ))}
          <ChevronRight className="size-3 opacity-60" />
          <span className="font-semibold text-foreground">{c.name}</span>
        </nav>
        <div className="flex items-center gap-3">
          <div
            style={hueVars(c.id)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--hue)_14%,transparent)]"
          >
            <Folder className="size-5 text-(--hue)" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{c.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
          </div>
          {isOwn ? (
            // Access control: editable on a root; Inherited on a nested one (CL4).
            <VisibilityControl
              visibility={root.visibility}
              variant="pill"
              onChoose={onChangeVisibility}
              onManage={onManage}
              inherited={c.parentId !== null}
              inheritedFrom={root.name}
              onOpenCollection={() => onOpenCollection(root.id)}
              note="Members of this collection — and every artefact inside — inherit this access."
            />
          ) : (
            // S28 — a viewer's page is read-only: the tier is a fact, not a
            // control; contribution happens via upload/move.
            <>
              <Badge variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
                <RootIcon />
                {rootVis.label}
              </Badge>
              {sharedNode?.canContribute && (
                <Badge variant="secondary" className="h-8 px-2.5" title="You can add your artefacts to this collection">
                  Contributor
                </Badge>
              )}
            </>
          )}
          <Button
            variant="outline"
            size="icon"
            className={cn("size-8 shrink-0", bookmarked ? "text-primary" : "text-muted-foreground")}
            onClick={onToggleBookmark}
            title={bookmarked ? "Remove bookmark" : "Bookmark collection"}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark collection"}
          >
            <Bookmark className={cn("size-3.5", bookmarked && "fill-current")} />
          </Button>
          {isOwn && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8 shrink-0 text-muted-foreground" title="More" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil />
                  Rename & access
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onNewSub}>
                  <Folder />
                  New sub-collection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                  <Archive />
                  Archive collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ScreenHeader>

      {subCollections.length > 0 && (
        <div className="mb-6">
          <SectionLabel>Collections</SectionLabel>
          <div className={tileGrid}>
            {subCollections.map((x) => {
              const n = directCounts(x);
              return <CollectionTile key={x.id} c={x} onOpen={() => onOpenCollection(x.id)} meta={countsLine(n.arts, n.colls)} />;
            })}
          </div>
        </div>
      )}

      <SectionLabel>Artefacts</SectionLabel>
      {/* Kind chips: more than one kind here, or a kind filter to clear. */}
      {showCollectionKindChips(chips, filters.kind) && <KindChips chips={chips} value={filters.kind} onChange={onKind} />}
      {visibleMine.length === 0 && visibleTheirs.length === 0 ? (
        filtered ? (
          <EmptyState title="No matches" sub="No artefacts in this collection match your current kind filter or search." />
        ) : (
          <EmptyState
            title="No artefacts here yet"
            sub="Add an artefact to this collection from its ⋯ menu. It will inherit this collection's access."
          />
        )
      ) : (
        <ItemList
          density={density}
          owned={visibleMine}
          others={visibleTheirs}
          ownedProps={ownedProps}
          galleryProps={(g) => galleryProps(g, isOwn ? () => onEject(g) : undefined)}
        />
      )}
    </>
  );
}
