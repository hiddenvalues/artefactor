import { Folder, Home } from "lucide-react";
import { definePreview } from "../../design/preview";
import { noop } from "../../design/fixtures";
import { NavRow } from "./NavRow";

const LONG = "A collection whose name is far too long to fit on one row";

// A sidebar-width strip on the tone's own surface, so hover and active read as in place.
function Strip({ tone, active }: { tone: "sidebar" | "dialog"; active: boolean }) {
  return (
    <div className={tone === "sidebar" ? "w-66 bg-sidebar p-2.5 text-sidebar-foreground" : "w-80 rounded-lg border bg-background p-2"}>
      <NavRow tone={tone} active={active} onClick={noop}>
        <Home className="size-4" />
        Home
      </NavRow>
      <NavRow tone={tone} onClick={noop}>
        <Folder className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{LONG}</span>
      </NavRow>
    </div>
  );
}

export default definePreview({
  title: "Nav row",
  variants: [
    { name: "Sidebar", render: () => <Strip tone="sidebar" active={false} /> },
    { name: "Sidebar, active", render: () => <Strip tone="sidebar" active /> },
    { name: "Dialog", render: () => <Strip tone="dialog" active={false} /> },
    { name: "Dialog, active", render: () => <Strip tone="dialog" active /> },
  ],
});
