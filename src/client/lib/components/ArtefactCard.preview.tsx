import { definePreview } from "../../design/preview";
import { artefact, gates, ownedProps, thumbnail } from "../../design/fixtures";
import type { OwnedItemProps } from "./ArtefactCard";
import { ArtefactCard, ArtefactRow } from "./ArtefactCard";

// The owner's own artefact, as a grid card and as a list row, in each state the
// dashboard shows.
const CASES: [string, OwnedItemProps][] = [
  ["Private", ownedProps(artefact())],
  ["Shared with members", ownedProps(artefact({ id: "art-deck", title: "Design review deck", kind: "slide-deck", visibility: "authenticated", publicSlug: "d3ck01" }))],
  [
    "Public, password + expiry, saves data",
    ownedProps(artefact({ id: "art-survey", title: "Customer survey", kind: "form", visibility: "public", publicSlug: "surv3y", usesStorage: true, dataVisibility: "shared", linkGate: gates.both })),
  ],
  ["In a collection (inherited access)", ownedProps(artefact({ id: "art-guide", title: "Interactive style guide", kind: "interactive-doc", collectionId: "col-design" }))],
  ["Bookmarked, rendered thumbnail", ownedProps(artefact({ thumbnailUrl: thumbnail }), { bookmarked: true })],
  ["Long title", ownedProps(artefact({ id: "art-long", kind: "other", title: "A very long artefact title that has to truncate somewhere sensible in the card" }))],
];

export default definePreview({
  title: "Artefact card & row",
  variants: [
    {
      name: "Card",
      render: () => (
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
          {CASES.map(([name, p]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{name}</span>
              <ArtefactCard {...p} />
            </div>
          ))}
        </div>
      ),
    },
    {
      name: "Row",
      render: () => (
        <div className="flex w-full flex-col gap-2.5">
          {CASES.map(([name, p]) => (
            <ArtefactRow key={name} {...p} />
          ))}
        </div>
      ),
    },
  ],
});
