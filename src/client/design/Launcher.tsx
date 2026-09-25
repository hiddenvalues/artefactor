import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  escapable = false,
  children,
}: {
  label: string;
  primary?: boolean;
  // A busy dialog ignores every close request, as it must in the app. Here
  // Escape closes the preview anyway, so the catalog is never stuck behind it.
  escapable?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const standalone = useStandalone();
  const [open, setOpen] = useState(standalone && primary);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // The overlay is mounted without a trigger, so hand focus back to this button
  // once it has gone.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !escapable) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, escapable]);

  return (
    <>
      <Button ref={button} variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && children(() => setOpen(false))}
    </>
  );
}
