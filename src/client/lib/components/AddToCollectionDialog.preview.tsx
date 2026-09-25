import { definePreview } from "../../design/preview";
import { artefact, collection, collections, people, viewer } from "../../design/fixtures";
import { Launcher } from "../../design/Launcher";
import { AddToCollectionDialog } from "./AddToCollectionDialog";

// The viewer's own tree plus a shared tree they may contribute to.
const targets = [...collections, collection({ id: "col-shared", ownerId: people[0]!.id, name: "Grace’s research", visibility: "selected" })];
const create = async (name: string, parentId: string | null) => collection({ id: `col-${name}`, name, parentId });

export default definePreview({
  title: "Add to collection dialog",
  variants: [
    {
      name: "Top-level artefact",
      render: () => (
        <Launcher label="Open add to collection" primary>
          {(close) => (
            <AddToCollectionDialog artefact={artefact()} collections={targets} viewerId={viewer.id} onClose={close} onConfirm={close} onCreate={create} />
          )}
        </Launcher>
      ),
    },
    {
      name: "Already in a sub-collection (move)",
      render: () => (
        <Launcher label="Open move">
          {(close) => (
            <AddToCollectionDialog
              artefact={artefact({ collectionId: "col-tokens" })}
              collections={targets}
              viewerId={viewer.id}
              onClose={close}
              onConfirm={close}
              onCreate={create}
            />
          )}
        </Launcher>
      ),
    },
    {
      name: "No collections yet, busy",
      render: () => (
        <Launcher label="Open empty">
          {(close) => (
            <AddToCollectionDialog artefact={artefact()} collections={[]} viewerId={viewer.id} busy onClose={close} onConfirm={close} onCreate={create} />
          )}
        </Launcher>
      ),
    },
  ],
});
