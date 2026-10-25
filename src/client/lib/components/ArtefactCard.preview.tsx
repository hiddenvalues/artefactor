import { definePreview } from "../../design/preview";
import { artefact, gates, noop, ownedProps, people, shared, sharedProps, thumbnail } from "../../design/fixtures";
import type { ArtefactItemProps } from "./ArtefactCard";
import { ArtefactCard } from "./ArtefactCard";

// S62 — the owner's own artefact as a grid card, in each state the card spec
// (`docs/design/components/artefact-card.md`) names. The list row has its own
// preview (S56).
const CASES: [string, ArtefactItemProps][] = [
  ["Private", ownedProps(artefact())],
  ["Shared with org members", ownedProps(artefact({ id: "art-deck", title: "Design review deck", kind: "slide-deck", visibility: "authenticated", publicSlug: "d3ck01" }))],
  [
    "Public (no activity)",
    ownedProps(artefact({ id: "art-launch", title: "Launch page", kind: "prototype", visibility: "public", publicSlug: "l4unch", linkGate: null, thumbnailUrl: thumbnail })),
  ],
  [
    "Public, password + expiry, saves data",
    ownedProps(artefact({ id: "art-survey", title: "Customer survey", kind: "form", visibility: "public", publicSlug: "surv3y", usesStorage: true, dataVisibility: "shared", linkGate: gates.both })),
  ],
  [
    "In a collection, inherited access (icon)",
    ownedProps(artefact({ id: "art-guide", title: "Interactive style guide", kind: "interactive-doc", collectionId: "col-research", visibility: "private", effectiveVisibility: "authenticated", publicSlug: "gu1de" })),
  ],
  [
    "Bookmarked, saves data, rendered thumbnail",
    ownedProps(artefact({ thumbnailUrl: thumbnail, usesStorage: true }), { bookmarked: true }),
  ],
  [
    "Long title (two lines, then truncated)",
    ownedProps(artefact({ id: "art-long", kind: "other", title: "Vinga Ambassadors: Walkthrough of the onboarding flow for new ambassadors, their mentors and every programme review" })),
  ],
];

// S47/S62 — another user's artefact, on Home and on a collection page: a
// read-only access badge, "Shared by …" unless public, a Share that copies the
// link unless private, and only Open / Bookmark / Download HTML in the menu —
// plus Remove from collection for the collection's owner on their own page.
const SHARED: [string, ArtefactItemProps][] = [
  ["Shared with org members (Share copies the link)", sharedProps(shared())],
  [
    "Private to you (no Share)",
    sharedProps(shared({ id: "art-private", title: "Contributed draft", kind: "prototype", effectiveVisibility: "private", publicSlug: null })),
  ],
  [
    "Public, saves data, bookmarked (no activity, no Shared by)",
    sharedProps(
      shared({ id: "art-poll", title: "Offsite poll", kind: "form", effectiveVisibility: "public", usesStorage: true, thumbnailUrl: thumbnail }),
      { bookmarked: true },
    ),
  ],
  [
    "In a collection shared with you",
    sharedProps(shared({ id: "art-notes", title: "Interview notes", kind: "interactive-doc", collectionId: "col-research" })),
  ],
  [
    "Specific people, owner without a name",
    sharedProps(shared({ id: "art-spec", title: "Pricing spec", kind: "interactive-doc", effectiveVisibility: "selected", owner: { name: "", email: people[1]!.email } })),
  ],
  [
    "On your own collection page (menu: Remove from collection)",
    sharedProps(shared({ id: "art-contrib", title: "Contributed research notes", kind: "interactive-doc", collectionId: "col-research" }), {
      showCollectionChip: false,
      onRemoveFromCollection: noop,
    }),
  ],
];

const cards = (cases: [string, ArtefactItemProps][]) => (
  <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
    {cases.map(([name, p]) => (
      <div key={name} className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <ArtefactCard {...p} />
      </div>
    ))}
  </div>
);

export default definePreview({
  title: "Artefact card",
  variants: [
    { name: "Card", render: () => cards(CASES) },
    { name: "Card, shared with you", render: () => cards(SHARED) },
  ],
});
