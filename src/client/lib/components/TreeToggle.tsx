import { ChevronRight } from "lucide-react";
import { cn } from "../utils";

// The expand/collapse chevron of a collection-tree row, or the matching blank
// when the node has no children.
export function TreeToggle({
  hasChildren,
  expanded,
  onToggle,
}: {
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!hasChildren) return <span className="w-5 shrink-0" />;
  const label = expanded ? "Collapse" : "Expand";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className="flex h-7 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
    </button>
  );
}

/** Indentation for a tree row at `depth` (Tailwind can't build the class at runtime). */
export const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20", "pl-24"] as const;
export const indent = (depth: number) => INDENT[Math.min(depth, INDENT.length - 1)];
