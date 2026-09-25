import { useState } from "react";
import { Badge } from "$lib/components/ui/badge";
import { definePreview } from "../../design/preview";
import { collection, galleryProps, library, noop, ownedProps, shared } from "../../design/fixtures";
import { accessChips, kindChips, type AccessFilter, type Density, type KindFilter, type Sort } from "../browse";
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
} from "./Browse";

// The listing screens' building blocks (dashboard, gallery, collection page).

function Controls({ withAccess }: { withAccess: boolean }) {
  const [access, setAccess] = useState<AccessFilter>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [density, setDensity] = useState<Density>("grid");
  return (
    <ViewControls
      access={withAccess ? { chips: accessChips(library), value: access } : undefined}
      onAccess={setAccess}
      sort={sort}
      onSort={setSort}
      density={density}
      onDensity={setDensity}
    />
  );
}

function Chips() {
  const [kind, setKind] = useState<KindFilter>("all");
  return <KindChips chips={kindChips(library)} value={kind} onChange={setKind} />;
}

const others = [shared()];

export default definePreview({
  title: "Browse (listing building blocks)",
  variants: [
    {
      name: "Screen header, title and view controls",
      render: () => (
        <div className="w-full">
          <ScreenHeader controls={<Controls withAccess />}>
            <ScreenTitle title="Your artefacts" sub="5 artefacts · 2 collections" />
          </ScreenHeader>
        </div>
      ),
    },
    { name: "View controls without access filter", render: () => <Controls withAccess={false} /> },
    { name: "Kind chips", render: () => <Chips /> },
    { name: "Section label", render: () => <SectionLabel>Collections</SectionLabel> },
    {
      name: "Collection tiles",
      render: () => (
        <div className={`${tileGrid} w-full`}>
          <CollectionTile c={collection()} onOpen={noop} meta="3 artefacts · 2 collections" />
          <CollectionTile
            c={collection({ id: "col-research", name: "Research", visibility: "authenticated" })}
            onOpen={noop}
            meta="1 artefact"
            badge={<Badge variant="secondary">Shared</Badge>}
          />
        </div>
      ),
    },
    {
      name: "Item list — grid",
      render: () => (
        <div className="w-full">
          <ItemList density="grid" owned={library.slice(0, 3)} others={others} ownedProps={(a) => ownedProps(a)} galleryProps={(g) => galleryProps(g)} />
        </div>
      ),
    },
    {
      name: "Item list — list",
      render: () => (
        <div className="w-full">
          <ItemList density="list" owned={library.slice(0, 3)} others={others} ownedProps={(a) => ownedProps(a)} galleryProps={(g) => galleryProps(g)} />
        </div>
      ),
    },
    {
      name: "Empty state, with upload",
      render: () => (
        <div className="w-full">
          <EmptyState title="No artefacts yet" sub="Publish from Claude, or upload an HTML file." onUpload={noop} />
        </div>
      ),
    },
    {
      name: "Empty state, no action",
      render: () => (
        <div className="w-full">
          <EmptyState title="Nothing shared with you" sub="When someone shares an artefact with you, it shows up here." />
        </div>
      ),
    },
  ],
});
