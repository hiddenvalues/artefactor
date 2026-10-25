import { useState } from "react";
import type { SharedCollectionSummary } from "../../shared/contracts";
import type { AccessFilter, Density, Filters, KindFilter } from "$lib/browse";
import { collectionById, collections, noop, ownedLibrary, ownedProps, sharedCollections, sharedLibrary, sharedProps } from "../design/fixtures";
import { definePreview } from "../design/preview";
import { ScreenFrame } from "../design/ScreenFrame";
import { CollectionPage } from "./CollectionPage";

// S70 — a collection page inside the app frame: your own, or one shared with you.

function Example({ id, empty = false, description }: { id: string; empty?: boolean; description?: string }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [access, setAccess] = useState<AccessFilter>("all");
  const [sort, setSort] = useState<Filters["sort"]>("updated");
  const [density, setDensity] = useState<Density>("grid");
  const sharedNode: SharedCollectionSummary | null = sharedCollections.find((c) => c.id === id) ?? null;
  const isOwn = sharedNode === null;
  const found = collectionById.get(id)!;
  const c = description ? { ...found, description } : found;
  return (
    <ScreenFrame view="collection" activeCollectionId={id}>
      <CollectionPage
        filters={{ kind, access, sort }}
        onKind={setKind}
        onAccess={setAccess}
        onSort={setSort}
        density={density}
        onDensity={setDensity}
        ownedProps={(a) => ownedProps(a)}
        sharedProps={(g, onRemoveFromCollection) => sharedProps(g, { onRemoveFromCollection })}
        collection={c}
        isOwn={isOwn}
        shared={sharedNode}
        owned={empty ? ownedLibrary.filter((a) => a.collectionId !== id) : ownedLibrary}
        others={sharedLibrary}
        collectionById={collectionById}
        pool={isOwn ? collections : sharedCollections}
        bookmarked={false}
        onToggleBookmark={noop}
        onOpenCollection={noop}
        onGoDashboard={noop}
        onGoGallery={noop}
        onChangeVisibility={noop}
        onLinkGate={noop}
        onManage={noop}
        onEdit={noop}
        onNewSub={noop}
        onArchive={noop}
        onEject={noop}
      />
    </ScreenFrame>
  );
}

export default definePreview({
  title: "Collection page",
  variants: [
    { name: "With sub-collections and artefacts", render: () => <Example id="col-design" /> },
    {
      name: "With a description",
      render: () => <Example id="col-design" description="Tokens, type and the components every screen is built from." />,
    },
    { name: "Empty", render: () => <Example id="col-screens" empty /> },
    { name: "Read-only (shared)", render: () => <Example id="col-shared-research" /> },
  ],
});
