import { useState } from "react";
import { definePreview } from "../../design/preview";
import type { OrganizationContext } from "../../../shared/contracts";
import { collections, library, memberOfSeveral, noop, ownerOfOne, shared, viewer } from "../../design/fixtures";
import { searchLibrary } from "../search";
import { cn } from "../utils";
import { TopBar } from "./TopBar";

// S46 — the global search reads the same lists the shell loads; here, fixtures.
const lib = {
  owned: library,
  shared: [shared(), shared({ id: "art-guide-review", title: "Style guide review", kind: "interactive-doc" })],
  collections,
  sharedCollections: [],
  collectionById: new Map(collections.map((c) => [c.id, c])),
};

function Example({
  initialQuery = "",
  organizations,
  narrow = false,
}: {
  initialQuery?: string;
  // S53 — the org context a superset reports; none = OSS.
  organizations?: OrganizationContext;
  // S80 — a 30rem card: below the bar's `sm`, so the logo is its tile and the
  // account menu its avatar variant.
  narrow?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  return (
    // Room below the bar for the results dropdown and account menu to open into.
    <div
      className={cn(
        "h-[22rem] max-w-full overflow-hidden rounded-lg border",
        narrow ? "w-[30rem]" : "w-full",
      )}
    >
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
    </div>
  );
}

// r[impl platform.search.top-bar-previews]
export default definePreview({
  title: "Top bar",
  variants: [
    { name: "Default", render: () => <Example /> },
    { name: "Results, first row highlighted", render: () => <Example initialQuery="s" /> },
    { name: "No results", render: () => <Example initialQuery="zebra" /> },
    // S80 — signed in, wide and narrow; the account menu's own states are AccountMenu's previews.
    { name: "Signed in, wide", render: () => <Example organizations={memberOfSeveral} /> },
    { name: "Signed in, narrow, with an organization", render: () => <Example organizations={ownerOfOne} narrow /> },
    { name: "No organization (OSS)", render: () => <Example /> },
  ],
});
