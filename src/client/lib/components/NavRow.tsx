import type { ComponentProps } from "react";
import { Button } from "$lib/components/ui/button";
import { cn } from "../utils";

// S49b — a full-width, left-aligned navigation row: the sidebar's destinations
// and the dialog pickers' targets. A ghost Button whose height, centring,
// padding and weight are reset through cn's tailwind-merge; `tone` picks the
// accent the row sits on (the sidebar's or a dialog's) for hover and active.
const TONE = {
  sidebar: { hover: "hover:bg-sidebar-accent dark:hover:bg-sidebar-accent", active: "bg-sidebar-accent" },
  dialog: { hover: "hover:bg-accent dark:hover:bg-accent", active: "bg-accent" },
} as const;

export function NavRow({
  active = false,
  tone,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size" | "asChild"> & { active?: boolean; tone: keyof typeof TONE }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "flex h-auto w-full min-w-0 shrink cursor-pointer justify-start px-2 py-1.5 text-left font-normal whitespace-normal hover:text-inherit has-[>svg]:px-2",
        TONE[tone].hover,
        active && [TONE[tone].active, "font-semibold"],
        className,
      )}
      {...props}
    />
  );
}
