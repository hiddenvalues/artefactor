import type { ArtefactSummary } from "../../shared/contracts";
import { accessChips, applyFilters, kindChips } from "$lib/browse";
import { EmptyState, ItemList, KindChips, ScreenHeader, ScreenTitle, ViewControls } from "$lib/components/Browse";
import type { ListingProps } from "../AppShell";

// "Your artefacts": everything you own, with every control.
export function Dashboard({
  owned,
  onUpload,
  filters,
  onKind,
  onAccess,
  onSort,
  density,
  onDensity,
  ownedProps,
  galleryProps,
}: ListingProps & { owned: ArtefactSummary[]; onUpload: () => void }) {
  const visible = applyFilters(owned, filters);
  const filtered = filters.kind !== "all" || filters.access !== "all";

  return (
    <>
      <ScreenHeader
        controls={
          <ViewControls
            access={{ chips: accessChips(owned), value: filters.access }}
            onAccess={onAccess}
            sort={filters.sort}
            onSort={onSort}
            density={density}
            onDensity={onDensity}
          />
        }
      >
        <ScreenTitle title="Your artefacts" sub="Manage, share and organise the artefacts you own." />
      </ScreenHeader>
      <KindChips chips={kindChips(owned)} value={filters.kind} onChange={onKind} />
      {visible.length === 0 ? (
        filtered ? (
          <EmptyState title="No matches" sub="No artefacts match your current filters. Try clearing them." />
        ) : (
          <EmptyState
            title="No artefacts yet"
            sub="Upload an HTML deliverable from Claude — a prototype, deck, form or doc — and it lives here."
            onUpload={onUpload}
          />
        )
      ) : (
        <ItemList density={density} owned={visible} others={[]} ownedProps={ownedProps} galleryProps={galleryProps} />
      )}
    </>
  );
}
