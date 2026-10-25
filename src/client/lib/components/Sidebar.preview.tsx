import { useState } from "react";
import type { SharedCollectionSummary } from "../../../shared/contracts";
import { definePreview } from "../../design/preview";
import { collection, collections, library, noop, people } from "../../design/fixtures";
import type { View } from "../view";
import { Sidebar } from "./Sidebar";

// S47 — trees another user shared with the viewer: a root with a sub-collection.
const bySomeone = { owner: { name: people[0]!.name, email: people[0]!.email }, canContribute: false };
const shared: SharedCollectionSummary[] = [
  { ...collection({ id: "col-shared-research", ownerId: people[0]!.id, name: "User research", visibility: "authenticated" }), ...bySomeone },
  {
    ...collection({ id: "col-shared-interviews", ownerId: people[0]!.id, name: "Interviews", parentId: "col-shared-research", rootId: "col-shared-research" }),
    ...bySomeone,
  },
];

function Example({
  view,
  active = null,
  empty = false,
  withShared = false,
}: {
  view: View;
  active?: string | null;
  empty?: boolean;
  withShared?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "col-design": true, "col-shared-research": true });
  return (
    // The sidebar is viewport-tall in the app; here it fills the frame instead.
    <div className="h-[32rem] w-66 overflow-hidden rounded-lg border [&>aside]:h-full">
      <Sidebar
        view={view}
        collections={empty ? [] : collections}
        sharedCollections={withShared ? shared : []}
        activeCollectionId={active}
        expanded={expanded}
        bookmarkedArtefacts={empty ? [] : library.slice(0, 2)}
        bookmarkedCollections={empty ? [] : collections.slice(3)}
        archivedCount={empty ? 0 : 4}
        onHome={noop}
        onOpenCollection={noop}
        onOpenArchive={noop}
        onNewCollection={noop}
        onToggleExpand={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
        onOpenArtefact={noop}
        onRemoveBookmark={noop}
      />
    </div>
  );
}

export default definePreview({
  title: "Sidebar",
  variants: [
    { name: "On Home", render: () => <Example view="dashboard" /> },
    { name: "With collections shared with me", render: () => <Example view="dashboard" withShared /> },
    { name: "Inside a shared sub-collection", render: () => <Example view="collection" active="col-shared-interviews" withShared /> },
    { name: "Inside a sub-collection", render: () => <Example view="collection" active="col-tokens" /> },
    { name: "On the archive", render: () => <Example view="archive" /> },
    { name: "Nothing yet", render: () => <Example view="dashboard" empty /> },
  ],
});
