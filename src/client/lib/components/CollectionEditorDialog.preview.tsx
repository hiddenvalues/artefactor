import { definePreview } from "../../design/preview";
import { collection, noop } from "../../design/fixtures";
import { Launcher } from "../../design/Launcher";
import { CollectionEditorDialog } from "./CollectionEditorDialog";

// 281 characters: the counter shows it over 280, and Save shows the inline error.
const OVER_LIMIT = "Everything the design team publishes: tokens, type, icons and the components every screen is built from. ".repeat(3).slice(0, 281);

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
      name: "Edit details & access",
      render: () => (
        <Launcher label="Open edit">
          {(close) => (
            <CollectionEditorDialog editing={collection({ visibility: "authenticated" })} onClose={close} onSubmit={close} />
          )}
        </Launcher>
      ),
    },
    {
      name: "Edit, with a description",
      render: () => (
        <Launcher label="Open edit with description">
          {(close) => (
            <CollectionEditorDialog
              editing={collection({ description: "Tokens, type and the components every screen is built from." })}
              onClose={close}
              onSubmit={close}
            />
          )}
        </Launcher>
      ),
    },
    {
      name: "Description over the limit",
      render: () => (
        <Launcher label="Open over the limit">
          {(close) => (
            <CollectionEditorDialog
              editing={collection({ description: OVER_LIMIT })}
              onClose={close}
              onSubmit={close}
            />
          )}
        </Launcher>
      ),
    },
    {
      name: "Busy, with server error (Escape closes the preview)",
      render: () => (
        <Launcher label="Open with error" escapable>
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
