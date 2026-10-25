import { archivedCollections, archivedLibrary, noop } from "../design/fixtures";
import { definePreview } from "../design/preview";
import { ScreenFrame } from "../design/ScreenFrame";
import { Archive } from "./Archive";

// S70 — the archive inside the app frame.
function Example({ empty = false }: { empty?: boolean }) {
  return (
    <ScreenFrame view="archive">
      <Archive
        archived={empty ? [] : archivedLibrary}
        archivedCollections={empty ? [] : archivedCollections}
        onRestore={noop}
        onRestoreCollection={noop}
        onDelete={noop}
      />
    </ScreenFrame>
  );
}

export default definePreview({
  title: "Archive",
  variants: [
    { name: "With items", render: () => <Example /> },
    { name: "Empty", render: () => <Example empty /> },
  ],
});
