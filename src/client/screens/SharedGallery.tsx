import type { ArtefactSummary, SharedArtefactSummary, SharedCollectionSummary } from "../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { accessChips, applyFilters, kindChips } from "$lib/browse";
import {
  CollectionTile,
  EmptyState,
  ItemList,
  KindChips,
  ScreenHeader,
  ScreenTitle,
  SectionLabel,
  tileGrid,
  ViewControls,
} from "$lib/components/Browse";
import { count } from "$lib/format";
import type { ListingProps } from "../AppShell";

// "Shared with you": others' artefacts you can open, plus the collection trees
// shared to you (S28) as browsable tiles — a both-way listing.
export function SharedGallery({
  shared,
  sharedCollections,
  owned,
  onOpenCollection,
  filters,
  onKind,
  onAccess,
  onSort,
  density,
  onDensity,
  ownedProps,
  galleryProps,
}: ListingProps & {
  shared: SharedArtefactSummary[];
  sharedCollections: SharedCollectionSummary[];
  owned: ArtefactSummary[];
  onOpenCollection: (id: string) => void;
}) {
  const visible = applyFilters(shared, filters);
  const filtered = filters.kind !== "all" || filters.access !== "all";
  const roots = sharedCollections.filter((c) => c.parentId === null).sort((a, b) => a.name.localeCompare(b.name));
  // Both-way listing means own + shared cover every artefact you can see.
  const artefactsIn = (id: string) =>
    owned.filter((a) => a.collectionId === id).length + shared.filter((g) => g.collectionId === id).length;

  return (
    <>
      <ScreenHeader
        controls={
          <ViewControls
            access={{ chips: accessChips(shared), value: filters.access }}
            onAccess={onAccess}
            sort={filters.sort}
            onSort={onSort}
            density={density}
            onDensity={onDensity}
          />
        }
      >
        <ScreenTitle title="Shared with you" sub="Artefacts teammates have shared with you — open to view." />
      </ScreenHeader>

      {roots.length > 0 && (
        <div className="mb-6">
          <SectionLabel>Collections</SectionLabel>
          <div className={tileGrid}>
            {roots.map((c) => (
              <CollectionTile
                key={c.id}
                c={c}
                onOpen={() => onOpenCollection(c.id)}
                meta={`${count(artefactsIn(c.id), "artefact")} · Shared by ${c.owner.name || c.owner.email}`}
                badge={
                  c.canContribute && (
                    <Badge variant="secondary" className="uppercase">
                      Contributor
                    </Badge>
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      <KindChips chips={kindChips(shared)} value={filters.kind} onChange={onKind} />
      {visible.length === 0 ? (
        filtered ? (
          <EmptyState title="No matches" sub="No artefacts match your current filters. Try clearing them." />
        ) : (
          <EmptyState
            title="Nothing shared with you"
            sub="When teammates share artefacts with members or the public, they’ll show up here."
          />
        )
      ) : (
        <ItemList density={density} owned={[]} others={visible} ownedProps={ownedProps} galleryProps={(g) => galleryProps(g)} />
      )}
    </>
  );
}
