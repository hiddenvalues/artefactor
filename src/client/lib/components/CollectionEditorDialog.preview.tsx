import { definePreview } from "../../design/preview";
import { collection, noop } from "../../design/fixtures";
import { Launcher } from "../../design/Launcher";
import { CollectionEditorDialog } from "./CollectionEditorDialog";

export default definePreview({
  title: "Collection editor dialog",
  variants: [
    {
      name: "New collection (top level, with access)",
      render: () => (
        <Launcher label="Open new collection" primary>
          {(close) => <CollectionEditorDialog onClose={close} onSubmit={close} />}
        </Launcher>
      ),
    },
    {
      name: "New sub-collection (inherits access)",
      render: () => (
        <Launcher label="Open new sub-collection">
          {(close) => <CollectionEditorDialog parent={collection()} onClose={close} onSubmit={close} />}
        </Launcher>
      ),
    },
    {
      name: "Rename & access",
      render: () => (
        <Launcher label="Open rename">
          {(close) => (
            <CollectionEditorDialog editing={collection({ visibility: "authenticated" })} onClose={close} onSubmit={close} />
          )}
        </Launcher>
      ),
    },
    {
      name: "Busy, with server error",
      render: () => (
        <Launcher label="Open with error">
          {(close) => (
            <CollectionEditorDialog
              editing={collection()}
              busy
              serverError="A collection with that name already exists."
              onClose={close}
              onSubmit={noop}
            />
          )}
        </Launcher>
      ),
    },
  ],
});
