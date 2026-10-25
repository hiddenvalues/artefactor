import type { MouseEvent } from "react";
import { cn } from "../utils";

export interface LogoProps {
  size?: "md" | "lg";
  /** Where the logo goes; without one it's an image, not a link. */
  href?: string;
  /** The link's accessible name, e.g. "Artefactor, go to Home". */
  label?: string;
  /** Takes a plain click on the link in place of the browser's navigation. */
  onNavigate?: () => void;
}

// S77 — the Artefactor brand mark (the gem jar) and name (docs/design/components/logo.md).
// The screen using it decides where it goes.
// r[impl platform.client.logo-link]
export function Logo({ size = "md", href, label = "Artefactor", onNavigate }: LogoProps) {
  const lg = size === "lg";
  const content = (
    <>
      <span
        className={cn(
          "flex items-center justify-center rounded-md bg-primary text-primary-foreground",
          lg ? "size-8" : "size-7",
        )}
      >
        <svg className={lg ? "size-4.5" : "size-4"} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
          <path d="M12 6H7C6.44772 6 6 6.44772 6 7V25C6 25.5523 6.44772 26 7 26H16V30H4C2.89543 30 2 29.1046 2 28V4C2 2.89543 2.89543 2 4 2H12V6Z" />
          <circle cx="12" cy="16" r="2.5" stroke="currentColor" />
          <circle cx="21" cy="6" r="3.5" stroke="currentColor" />
          <circle cx="25" cy="23" r="4.5" stroke="currentColor" />
        </svg>
      </span>
      {/* The top bar's name goes when the bar is narrower than sm (its own
          width, not the viewport's: the sidebar can sit beside it), taking its
          gap with it. Outside a top bar there is no such container, so the
          name stays hidden. r[impl platform.client.logo-narrow+2] */}
      <span
        className={cn(
          "font-semibold tracking-tight",
          lg ? "ml-2.5 text-lg" : "hidden text-[15px] @min-[40rem]/top-bar:ml-2.5 @min-[40rem]/top-bar:inline",
        )}
      >
        Artefactor
      </span>
    </>
  );
  if (href === undefined)
    return (
      <div role="img" aria-label="Artefactor" className="flex w-fit items-center">
        {content}
      </div>
    );
  // A modified or middle click keeps the browser's default, so a new tab works;
  // a click something else already prevented isn't a navigation.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate();
  };
  return (
    <a
      href={href}
      aria-label={label}
      onClick={onClick}
      className="flex w-fit items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {content}
    </a>
  );
}
