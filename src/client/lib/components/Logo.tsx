import { cn } from "../utils";

// The Artefactor mark: two stacked sheets.
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "flex items-center justify-center rounded-md bg-primary text-primary-foreground",
          size === "lg" ? "size-8" : "size-7",
        )}
      >
        <svg className={size === "lg" ? "size-4.5" : "size-4"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="3" width="12" height="15" rx="2.5" fill="currentColor" opacity="0.5" />
          <rect x="8" y="6" width="12" height="15" rx="2.5" fill="currentColor" />
        </svg>
      </div>
      <span className={cn("font-semibold tracking-tight", size === "lg" ? "text-lg" : "text-[15px]")}>Artefactor</span>
    </div>
  );
}
