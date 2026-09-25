import { definePreview } from "../../design/preview";
import { noop } from "../../design/fixtures";
import { MoreMenu } from "./MoreMenu";

const base = { onOpen: noop, onCopy: noop, onEdit: noop, onArchive: noop };

export default definePreview({
  title: "More menu",
  variants: [
    {
      name: "Grid card, private, every action",
      render: () => (
        <MoreMenu {...base} isShared={false} onBookmark={noop} onMoveToCollection={noop} downloadHref="#more-menu" />
      ),
    },
    {
      name: "List row, shared, bookmarked, in a collection",
      render: () => (
        <MoreMenu
          {...base}
          variant="list"
          isShared
          bookmarked
          onBookmark={noop}
          inCollection
          onMoveToCollection={noop}
          downloadHref="#more-menu"
        />
      ),
    },
    { name: "Minimal (no bookmark, move or download)", render: () => <MoreMenu {...base} isShared={false} /> },
  ],
});
