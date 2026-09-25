import { useState } from "react";
import type { ArtefactSummary, CollectionSummary } from "../../../shared/contracts";
import { definePreview } from "../../design/preview";
import { artefact, collection, collections, people, viewer } from "../../design/fixtures";
import { Launcher } from "../../design/Launcher";
import { AddToCollectionDialog } from "./AddToCollectionDialog";

// The viewer's own tree plus a shared tree they may contribute to.
const targets = [...collections, collection({ id: "col-shared", ownerId: people[0]!.id, name: "Grace’s research", visibility: "selected" })];

// Owns the collections list, as the app does, so an inline "New collection"
// joins the picker and is selected.
function Picker({
  a,
  initial,
  busy = false,
  close,
}: {
  a: ArtefactSummary;
  initial: CollectionSummary[];
  busy?: boolean;
  close: () => void;
}) {
  const [list, setList] = useState(initial);
  async function create(name: string, parentId: string | null) {
    const made = collection({ id: `col-new-${list.length}`, name, parentId });
    setList((l) => [...l, made]);
    return made;
  }
  return (
    <AddToCollectionDialog artefact={a} collections={list} viewerId={viewer.id} busy={busy} onClose={close} onConfirm={close} onCreate={create} />
  );
}

export default definePreview({
  title: "Add to collection dialog",
  variants: [
    {
      name: "Top-level artefact",
      render: () => (
        <Launcher label="Open add to collection" primary>
          {(close) => <Picker a={artefact()} initial={targets} close={close} />}
        </Launcher>
      ),
    },
    {
      name: "Already in a sub-collection (move)",
      render: () => (
        <Launcher label="Open move">{(close) => <Picker a={artefact({ collectionId: "col-tokens" })} initial={targets} close={close} />}</Launcher>
      ),
    },
    {
      name: "No collections yet, busy (Escape closes the preview)",
      render: () => (
        <Launcher label="Open empty" escapable>
          {(close) => <Picker a={artefact()} initial={[]} busy close={close} />}
        </Launcher>
      ),
    },
  ],
});
