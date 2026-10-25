import { useState } from "react";
import { definePreview } from "../../design/preview";
import { gates, noop } from "../../design/fixtures";
import type { DataVisibility, Visibility } from "../format";
import { VisibilityControl } from "./VisibilityControl";

// Live, so choosing a tier in the popover moves the trigger too. The inherited
// pill opens the "Access inherited" popover, previewed on its own (S64).
function Example({
  initial,
  withGate = false,
  usesStorage = false,
  note,
  publicId = null,
}: {
  initial: Visibility;
  withGate?: boolean;
  usesStorage?: boolean;
  note?: string;
  publicId?: string | null;
}) {
  const [visibility, setVisibility] = useState(initial);
  const [data, setData] = useState<DataVisibility>("own");
  return (
    <VisibilityControl
      visibility={visibility}
      onChoose={setVisibility}
      onManage={noop}
      note={note}
      usesStorage={usesStorage}
      dataVisibility={data}
      onChooseData={setData}
      publicCollectionId={publicId}
      linkProtection={
        withGate ? { current: gates.password, onPublish: () => setVisibility("public"), onSave: noop } : undefined
      }
    />
  );
}

export default definePreview({
  title: "Visibility control",
  variants: [
    {
      name: "Pill (row) — each tier",
      render: () => (
        <>
          <Example initial="private" />
          <Example initial="selected" />
          <Example initial="authenticated" />
          <Example initial="public" withGate />
        </>
      ),
    },
    { name: "With saved data section", render: () => <Example initial="authenticated" usesStorage /> },
    { name: "With a note (collection header)", render: () => <Example initial="private" note="Everything inside inherits this." /> },
    {
      name: "Collection header — public root with link protection",
      render: () => <Example initial="public" withGate note="Everything inside inherits this." />,
    },
    {
      name: "Collection header — public root with its public collection id",
      render: () => (
        <Example initial="public" withGate publicId="Ab3dE6gH9jK" note="Everything inside inherits this." />
      ),
    },
  ],
});
