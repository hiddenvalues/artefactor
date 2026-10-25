import { definePreview } from "../../design/preview";
import { noop, thumbnail } from "../../design/fixtures";
import { KIND_ORDER, kindMeta } from "../format";
import { BookmarkChip, StorageChip } from "./ArtefactCard";
import { CardThumbnail } from "./CardThumbnail";

// S54 — the chips sit beside the open button: the saved-data icon, then the
// bookmark button.
const chips = (
  <>
    <StorageChip />
    <BookmarkChip onRemove={noop} />
  </>
);

export default definePreview({
  title: "Card thumbnail",
  variants: [
    {
      name: "Kind placeholders (no render yet)",
      render: () =>
        KIND_ORDER.map((k) => (
          // S62 — the thumbnail names no kind, so the catalog captions each one.
          <div key={k} className="flex w-56 flex-col gap-1">
            <CardThumbnail kind={k} title={kindMeta(k).label} thumbnailUrl={null} onOpen={noop} />
            <span className="text-xs text-muted-foreground">{kindMeta(k).label}</span>
          </div>
        )),
    },
    {
      name: "Rendered thumbnail, saves data + bookmarked",
      render: () => (
        <div className="w-56">
          <CardThumbnail kind="prototype" title="Onboarding flow" thumbnailUrl={thumbnail} onOpen={noop} chips={chips} />
        </div>
      ),
    },
    {
      name: "Placeholder, saves data + bookmarked",
      render: () => (
        <div className="w-56">
          <CardThumbnail kind="form" title="Customer survey" thumbnailUrl={null} onOpen={noop} chips={chips} />
        </div>
      ),
    },
  ],
});
