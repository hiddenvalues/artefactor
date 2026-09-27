import { useState } from "react";
import { definePreview } from "../../design/preview";
import { collections, library, noop, shared, viewer } from "../../design/fixtures";
import { searchLibrary } from "../search";
import { TopBar } from "./TopBar";

// S46 — the global search reads the same lists the shell loads; here, fixtures.
const lib = {
  owned: library,
  shared: [shared(), shared({ id: "art-guide-review", title: "Style guide review", kind: "interactive-doc" })],
  collections,
  sharedCollections: [],
  collectionById: new Map(collections.map((c) => [c.id, c])),
};

function Example({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    // Room below the bar for the results dropdown to open into.
    <div className="h-[22rem] w-full overflow-hidden rounded-lg border">
      <TopBar
        query={query}
        results={searchLibrary(lib, query)}
        user={viewer}
        onSearch={setQuery}
        onOpenResult={noop}
        onOpenUpload={noop}
        onSignOut={noop}
        onToggleSidebar={noop}
      />
    </div>
  );
}

export default definePreview({
  title: "Top bar",
  variants: [
    { name: "Default", render: () => <Example /> },
    { name: "Results, first row highlighted", render: () => <Example initialQuery="s" /> },
    { name: "No results", render: () => <Example initialQuery="zebra" /> },
  ],
});
