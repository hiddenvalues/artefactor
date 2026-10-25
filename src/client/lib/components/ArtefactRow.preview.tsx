import { definePreview } from "../../design/preview";
import { cn } from "../utils";
import { artefact, gates, ownedProps, shared, sharedProps } from "../../design/fixtures";
import type { ArtefactItemProps } from "./ArtefactCard";
import { ArtefactRow } from "./ArtefactRow";

// S56/S65 — the list row, in each state the row spec
// (`docs/design/components/artefact-row.md`) names.
const STATES: [string, ArtefactItemProps][] = [
  ["Private", ownedProps(artefact())],
  ["Org members", ownedProps(artefact({ id: "art-deck", title: "Design review deck", kind: "slide-deck", visibility: "authenticated", publicSlug: "d3ck01" }))],
  ["Public (empty meta: the title centres on the tile)", ownedProps(artefact({ id: "art-launch", title: "Launch page", kind: "prototype", visibility: "public", publicSlug: "l4unch" }))],
  [
    "Public with password and expiry",
    ownedProps(artefact({ id: "art-survey", title: "Customer survey", kind: "form", visibility: "public", publicSlug: "surv3y", linkGate: gates.both })),
  ],
  ["In a collection", ownedProps(artefact({ id: "art-tokens", title: "Token audit", kind: "interactive-doc", collectionId: "col-design" }))],
  [
    "Inherited (org members from the collection)",
    ownedProps(artefact({ id: "art-guide", title: "Interactive style guide", kind: "interactive-doc", collectionId: "col-research", visibility: "private", effectiveVisibility: "authenticated", publicSlug: "gu1de" })),
  ],
  ["Bookmarked", ownedProps(artefact({ id: "art-saved", title: "Saved for later" }), { bookmarked: true })],
  ["Saves data", ownedProps(artefact({ id: "art-poll", title: "Offsite poll", kind: "form", usesStorage: true, dataVisibility: "shared" }))],
  ["Long title", ownedProps(artefact({ id: "art-long", kind: "other", title: "A very long artefact title that has to truncate somewhere sensible in the row, well before the right group" }))],
];

// S47/S65 — another user's artefact: the access badge and, when it has a link, a Share that copies it.
const VIEWER: [string, ArtefactItemProps][] = [
  ["Viewer, with a link (Share copies it)", sharedProps(shared({ id: "art-notes", title: "Interview notes", kind: "interactive-doc", collectionId: "col-research", publicSlug: "n0tes" }))],
  ["Viewer, public (no activity, no Shared by)", sharedProps(shared({ id: "art-pub", title: "Offsite agenda", kind: "form", effectiveVisibility: "public", publicSlug: "ag3nda" }), { bookmarked: true })],
  ["Viewer, no link (no Share)", sharedProps(shared({ id: "art-nolink", title: "Team retro", kind: "slide-deck", publicSlug: null }))],
];

const rows = (cases: [string, ArtefactItemProps][], className = "w-full") => (
  <div className={cn("flex flex-col gap-2.5", className)}>
    {cases.map(([name, p]) => (
      <div key={name} className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{name}</span>
        <ArtefactRow {...p} />
      </div>
    ))}
  </div>
);

export default definePreview({
  title: "Artefact row",
  variants: [
    { name: "States", render: () => rows(STATES) },
    { name: "Viewer", render: () => rows(VIEWER) },
    // The right group drops below the title block under the row's `@xl`.
    { name: "Narrow width", render: () => rows([STATES[3]!, STATES[5]!, VIEWER[0]!], "max-w-sm") },
  ],
});
