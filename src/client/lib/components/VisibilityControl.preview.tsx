import { useState } from "react";
import { definePreview } from "../../design/preview";
import { gates, noop } from "../../design/fixtures";
import type { DataVisibility, Visibility } from "../format";
import { VisibilityControl } from "./VisibilityControl";

// Live, so choosing a tier in the popover moves the trigger too.
function Example({
  initial,
  variant = "block",
  withGate = false,
  usesStorage = false,
  note,
}: {
  initial: Visibility;
  variant?: "block" | "pill";
  withGate?: boolean;
  usesStorage?: boolean;
  note?: string;
}) {
  const [visibility, setVisibility] = useState(initial);
  const [data, setData] = useState<DataVisibility>("own");
  return (
    <VisibilityControl
      visibility={visibility}
      variant={variant}
      onChoose={setVisibility}
      onManage={noop}
      note={note}
      usesStorage={usesStorage}
      dataVisibility={data}
      onChooseData={setData}
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
      name: "Block (card) — each tier",
      render: () => (
        <>
          <Example initial="private" />
          <Example initial="selected" />
          <Example initial="authenticated" />
          <Example initial="public" withGate />
        </>
      ),
    },
    {
      name: "Pill (row) — each tier",
      render: () => (
        <>
          <Example variant="pill" initial="private" />
          <Example variant="pill" initial="selected" />
          <Example variant="pill" initial="authenticated" />
          <Example variant="pill" initial="public" withGate />
        </>
      ),
    },
    { name: "With saved data section", render: () => <Example initial="authenticated" usesStorage /> },
    { name: "With a note (collection header)", render: () => <Example initial="private" note="Everything inside inherits this." /> },
    {
      name: "Inherited from a collection (read-only)",
      render: () => (
        <VisibilityControl visibility="authenticated" onChoose={noop} inherited inheritedFrom="Research" onOpenCollection={noop} />
      ),
    },
  ],
});
