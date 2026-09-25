import { definePreview } from "../../design/preview";
import { galleryProps, noop, people, shared, thumbnail } from "../../design/fixtures";
import type { GalleryItemProps } from "./GalleryCard";
import { GalleryCard, GalleryRow } from "./GalleryCard";

// Someone else's artefact as the viewer sees it: "Shared with you" and the
// others' items on a shared collection page.
const CASES: [string, GalleryItemProps][] = [
  ["Shared with you", galleryProps(shared())],
  ["Bookmarked, saves data", galleryProps(shared({ id: "art-poll", title: "Team offsite poll", kind: "form", usesStorage: true }), { bookmarked: true })],
  ["Rendered thumbnail", galleryProps(shared({ id: "art-proto", title: "Checkout prototype", kind: "prototype", thumbnailUrl: thumbnail, owner: { name: people[1]!.name, email: people[1]!.email } }))],
  ["In your collection (can be returned)", galleryProps(shared({ id: "art-contrib", title: "Contributed research notes", kind: "interactive-doc" }), { onEject: noop })],
];

export default definePreview({
  title: "Gallery card & row",
  variants: [
    {
      name: "Card",
      render: () => (
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
          {CASES.map(([name, p]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{name}</span>
              <GalleryCard {...p} />
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
            <GalleryRow key={name} {...p} />
          ))}
        </div>
      ),
    },
  ],
});
