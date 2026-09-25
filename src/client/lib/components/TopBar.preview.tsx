import { useState } from "react";
import { definePreview } from "../../design/preview";
import { noop, viewer } from "../../design/fixtures";
import type { View } from "../view";
import { TopBar } from "./TopBar";

function Example({ view, initialQuery = "" }: { view: View; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <TopBar
        view={view}
        query={query}
        searchPlaceholder={view === "gallery" ? "Search shared artefacts…" : "Search your artefacts…"}
        user={viewer}
        onSearch={setQuery}
        onGoDashboard={noop}
        onGoGallery={noop}
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
    { name: "Your artefacts", render: () => <Example view="dashboard" /> },
    { name: "Shared with you, with a search", render: () => <Example view="gallery" initialQuery="roadmap" /> },
    { name: "Inside a collection", render: () => <Example view="collection" /> },
  ],
});
