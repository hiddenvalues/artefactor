import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "$lib/components/ui/button";

// Overlays (dialogs, menus, popovers) can't all be open at once on the catalog
// page, so a preview shows them behind a button. On a standalone page — one
// preview, which is what Claude design renders as a card — the preview's
// `primary` overlay starts open, so the card shows the thing itself.

export const StandaloneContext = createContext(false);

/** True on a standalone preview page. */
export const useStandalone = () => useContext(StandaloneContext);

export function Launcher({
  label,
  primary = false,
  children,
}: {
  label: string;
  primary?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const standalone = useStandalone();
  const [open, setOpen] = useState(standalone && primary);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && children(() => setOpen(false))}
    </>
  );
}
