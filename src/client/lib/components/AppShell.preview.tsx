import type { ReactNode } from "react";
import { definePreview } from "../../design/preview";
import { cn } from "../utils";
import { AppShell } from "./AppShell";

// S69 — the frame alone: a labelled block in each slot, never the real Sidebar
// or TopBar, so the card shows what the frame places and nothing it doesn't own.
function Slot({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}>
      {label}
    </div>
  );
}

const sidebar = (
  <aside className="flex w-66 shrink-0 border-r bg-sidebar text-sidebar-foreground">
    <Slot label="sidebar" className="flex-1" />
  </aside>
);
const topBar = (
  <header className="sticky top-0 z-20 border-b bg-background">
    <Slot label="top bar" className="h-14" />
  </header>
);
const content = <Slot label="content" className="h-64 rounded-lg border-2 border-dashed" />;

/** The app frame is viewport-tall; here it fills a bounded box instead. */
function Example({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  return (
    <div className={cn("h-[28rem] max-w-full overflow-hidden rounded-lg border [&>div]:min-h-full", narrow ? "w-90" : "w-full")}>
      {children}
    </div>
  );
}

export default definePreview({
  title: "App shell",
  variants: [
    {
      name: "Slots filled",
      render: () => (
        <Example>
          <AppShell sidebar={sidebar} topBar={topBar}>
            {content}
          </AppShell>
        </Example>
      ),
    },
    {
      name: "Narrow",
      render: () => (
        <Example narrow>
          <AppShell sidebar={null} topBar={topBar}>
            {content}
          </AppShell>
        </Example>
      ),
    },
  ],
});
