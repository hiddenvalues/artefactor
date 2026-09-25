import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

// One toast at a time, auto-dismissing: 3 s for a plain message, 5 s when it
// carries an action (e.g. the "Undo" after archiving) — the Svelte client's
// timings, now on Sonner.
let current: string | number | undefined;

export function notify(
  msg: string,
  icon?: LucideIcon,
  action?: { label: string; onClick: () => void },
): void {
  if (current !== undefined) toast.dismiss(current);
  const Icon = icon;
  current = toast(msg, {
    icon: Icon ? <Icon className="size-4" /> : undefined,
    duration: action ? 5000 : 3000,
    action: action ? { label: action.label, onClick: action.onClick } : undefined,
  });
}
