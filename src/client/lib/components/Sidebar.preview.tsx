import { useState } from "react";
import { definePreview } from "../../design/preview";
import { collections, library, noop } from "../../design/fixtures";
import type { View } from "../view";
import { Sidebar } from "./Sidebar";

function Example({ view, active = null, empty = false }: { view: View; active?: string | null; empty?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "col-design": true });
  return (
    // The sidebar is viewport-tall in the app; here it fills the frame instead.
    <div className="h-[32rem] w-66 overflow-hidden rounded-lg border [&>aside]:h-full">
      <Sidebar
        view={view}
        collections={empty ? [] : collections}
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
    { name: "On the dashboard", render: () => <Example view="dashboard" /> },
    { name: "Inside a sub-collection", render: () => <Example view="collection" active="col-tokens" /> },
    { name: "On the archive", render: () => <Example view="archive" /> },
    { name: "Nothing yet", render: () => <Example view="dashboard" empty /> },
  ],
});
