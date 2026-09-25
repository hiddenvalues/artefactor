import { useState } from "react";
import { definePreview } from "../../design/preview";
import { noop } from "../../design/fixtures";
import { TreeToggle } from "./TreeToggle";

function Live() {
  const [expanded, setExpanded] = useState(false);
  return <TreeToggle hasChildren expanded={expanded} onToggle={() => setExpanded((e) => !e)} />;
}

export default definePreview({
  title: "Tree toggle",
  variants: [
    { name: "Collapsed", render: () => <TreeToggle hasChildren expanded={false} onToggle={noop} /> },
    { name: "Expanded", render: () => <TreeToggle hasChildren expanded onToggle={noop} /> },
    { name: "Leaf (no children, keeps the indent)", render: () => <TreeToggle hasChildren={false} expanded={false} onToggle={noop} /> },
    { name: "Interactive", render: () => <Live /> },
  ],
});
