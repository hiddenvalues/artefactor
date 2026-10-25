import { useState, type ReactNode } from "react";
import type { OrganizationContext } from "../../shared/contracts";
import { AppShell } from "$lib/components/AppShell";
import { Sidebar } from "$lib/components/Sidebar";
import { TopBar } from "$lib/components/TopBar";
import { cn } from "$lib/utils";
import { searchLibrary } from "$lib/search";
import type { View } from "$lib/view";
import {
  archivedCollections,
  archivedLibrary,
  collectionById,
  collections,
  noop,
  ownedLibrary,
  sharedCollections,
  sharedLibrary,
  viewer,
} from "./fixtures";

// S70 — a signed-in screen as the app frames it: AppShell (S69) with the
// Sidebar and TopBar fed from fixtures, so a screen preview's card is the whole
// screen. Catalog-only: it lives beside the previews, never in the app.

// The app frame and the sign-in pages are viewport-tall; here each is as tall as
// its content, at least a screen's height, so the card shows the whole screen.
const box = "w-full max-w-full overflow-hidden rounded-lg border bg-background [&>div]:min-h-[48rem]";

/** A screen the app shows outside the signed-in frame (sign-in, consent), in the same box. */
export function PageFrame({ children }: { children: ReactNode }) {
  return <div className={box}>{children}</div>;
}

const lib = {
  owned: ownedLibrary,
  shared: sharedLibrary,
  collections,
  sharedCollections,
  collectionById,
};

export function ScreenFrame({
  view,
  activeCollectionId = null,
  organizations,
  empty = false,
  children,
}: {
  view: View;
  activeCollectionId?: string | null;
  // S53 — the org context a superset reports; none = OSS.
  organizations?: OrganizationContext;
  // A first-use library: nothing in the sidebar either.
  empty?: boolean;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "col-design": true, "col-shared-research": true });
  return (
    // The sidebar runs the content's full height rather than the viewport's.
    <div className={cn(box, "[&>div>aside]:h-auto")}>
      <AppShell
        sidebar={
          <Sidebar
            view={view}
            collections={empty ? [] : collections}
            sharedCollections={empty ? [] : sharedCollections}
            activeCollectionId={activeCollectionId}
            expanded={expanded}
            bookmarkedArtefacts={empty ? [] : ownedLibrary.slice(1, 3)}
            bookmarkedCollections={empty ? [] : collections.slice(3)}
            archivedCount={empty ? 0 : archivedLibrary.length + archivedCollections.length}
            onHome={noop}
            onOpenCollection={noop}
            onOpenArchive={noop}
            onNewCollection={noop}
            onToggleExpand={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
            onOpenArtefact={noop}
            onRemoveBookmark={noop}
          />
        }
        topBar={
          <TopBar
            query={query}
            results={searchLibrary(lib, query)}
            user={{ ...viewer, organizations }}
            onSearch={setQuery}
            onOpenResult={noop}
            onOpenUpload={noop}
            onSignOut={noop}
            onSwitchOrganization={noop}
            onOpenAccount={noop}
            onOpenOrganization={noop}
            onToggleSidebar={noop}
            onGoHome={noop}
          />
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
