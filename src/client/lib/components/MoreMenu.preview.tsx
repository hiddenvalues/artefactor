import { definePreview } from "../../design/preview";
import { noop } from "../../design/fixtures";
import { MoreMenu } from "./MoreMenu";

const owner = { role: "owner", onOpen: noop, onEdit: noop, onArchive: noop } as const;

export default definePreview({
  title: "More menu",
  variants: [
    {
      name: "Grid card, your own, every action",
      render: () => <MoreMenu {...owner} onBookmark={noop} onMoveToCollection={noop} downloadHref="#more-menu" />,
    },
    {
      name: "List row, your own, bookmarked, in a collection",
      render: () => (
        <MoreMenu
          {...owner}
          variant="list"
          bookmarked
          onBookmark={noop}
          inCollection
          onMoveToCollection={noop}
          downloadHref="#more-menu"
        />
      ),
    },
    { name: "Minimal (no bookmark, move or download)", render: () => <MoreMenu {...owner} /> },
    {
      name: "Another user's artefact (Open, Bookmark, Download HTML)",
      render: () => <MoreMenu role="viewer" onOpen={noop} onBookmark={noop} downloadHref="#more-menu" />,
    },
    {
      name: "Another user's artefact, on your own collection page (Remove from collection)",
      render: () => (
        <MoreMenu role="viewer" onOpen={noop} onBookmark={noop} downloadHref="#more-menu" onRemoveFromCollection={noop} />
      ),
    },
  ],
});
