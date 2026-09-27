import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, LogOut, Menu, Monitor, Moon, Plus, Search, Sun, X } from "lucide-react";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "$lib/components/ui/popover";
import { initials, kindMeta } from "../format";
import { highlight, type Hit, type SearchResults } from "../search";
import { hueVars, kindVars } from "../style";
import { THEMES, useTheme, type Theme } from "../theme";
import { cn } from "../utils";
import { Logo } from "./Logo";

// S45 — the avatar menu's theme choice.
const THEME_OPTIONS: Record<Theme, { label: string; Icon: typeof Sun }> = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

const SEARCH_LABEL = "Search artefacts and collections";

export function TopBar({
  query,
  results,
  user,
  onSearch,
  onOpenResult,
  onOpenUpload,
  onSignOut,
  onToggleSidebar,
}: {
  query: string;
  // S46 — the global search's hits (`searchLibrary`) for `query`.
  results: SearchResults;
  user: { name: string; email: string };
  onSearch: (q: string) => void;
  onOpenResult: (hit: Hit) => void;
  onOpenUpload: () => void;
  onSignOut: () => void;
  // S25 — toggles the collections/bookmarks sidebar (closed by default).
  onToggleSidebar: () => void;
}) {
  const displayName = user.name || user.email;
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3.5 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          className="shrink-0 text-muted-foreground"
        >
          <Menu />
        </Button>
        <div className="mr-1 shrink-0">
          <Logo />
        </div>

        <GlobalSearch query={query} results={results} onSearch={onSearch} onOpenResult={onOpenResult} />

        <div className="flex-1" />

        <Button onClick={onOpenUpload} className="shrink-0">
          <Plus />
          New artefact
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="shrink-0 gap-1.5 px-1.5" title="Account" aria-label="Account">
              <Avatar className="size-6">
                <AvatarFallback className="text-[11px] font-semibold">{initials(displayName)}</AvatarFallback>
              </Avatar>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
              <Avatar className="size-8">
                <AvatarFallback className="text-xs font-semibold">{initials(displayName)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {THEMES.map((t) => {
                const { label, Icon } = THEME_OPTIONS[t];
                return (
                  <DropdownMenuRadioItem key={t} value={t}>
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// S46 — one field that finds any artefact or collection the viewer can see, in
// a dropdown anchored to it. Focus stays in the input: the input is a combobox
// whose highlighted option is announced through aria-activedescendant.
function GlobalSearch({
  query,
  results,
  onSearch,
  onOpenResult,
}: {
  query: string;
  results: SearchResults;
  onSearch: (q: string) => void;
  onOpenResult: (hit: Hit) => void;
}) {
  const base = useId();
  const listboxId = `${base}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);

  const hits: Hit[] = [...results.collections, ...results.artefacts];
  const open = query.trim() !== "" && !dismissed;
  const current = open ? Math.min(active, hits.length - 1) : -1;
  const optionId = (i: number) => `${base}-option-${i}`;

  // A new query reopens the dropdown on its first row.
  useEffect(() => {
    setDismissed(false);
    setActive(0);
  }, [query]);

  function openHit(hit: Hit) {
    setDismissed(true);
    onOpenResult(hit);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setDismissed(false);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(hits.length - 1, current + step)));
    } else if (e.key === "Enter" && open && current >= 0) {
      e.preventDefault();
      openHit(hits[current]!);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setDismissed(true);
    }
  }

  const row = (hit: Hit, i: number) => {
    const [before, match, after] = highlight(hit.title, query);
    const KindIcon = hit.kind === "artefact" ? kindMeta(hit.artefactKind).icon : null;
    const swatch =
      hit.kind === "artefact" && KindIcon ? (
        <KindIcon style={kindVars(hit.artefactKind)} className="size-4 shrink-0 text-(--kind)" />
      ) : (
        <span style={hueVars(hit.id)} className="size-3.5 shrink-0 rounded-sm bg-(--hue)" aria-hidden="true" />
      );
    return (
      <div
        key={`${hit.kind}-${hit.id}`}
        id={optionId(i)}
        role="option"
        aria-selected={i === current}
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => setActive(i)}
        onClick={() => openHit(hit)}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm",
          i === current && "bg-accent text-accent-foreground",
        )}
      >
        {swatch}
        <span className="min-w-0 flex-1 truncate">
          {before}
          {match && <strong className="font-semibold">{match}</strong>}
          {after}
        </span>
        <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{hit.meta}</span>
      </div>
    );
  };

  const group = (label: string, list: Hit[], offset: number) =>
    list.length > 0 && (
      <div role="group" aria-labelledby={`${base}-${label}`} className="py-1">
        <div id={`${base}-${label}`} className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          {label}
        </div>
        {list.map((hit, i) => row(hit, offset + i))}
      </div>
    );

  return (
    <Popover open={open} onOpenChange={(next) => !next && setDismissed(true)}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} role="search" className="relative max-w-md min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search artefacts and collections…"
            aria-label={SEARCH_LABEL}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open && hits.length > 0 ? listboxId : undefined}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            className={cn("pl-9", query && "pr-9")}
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                onSearch("");
                inputRef.current?.focus();
              }}
            >
              <X />
            </Button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {hits.length === 0 ? (
          <div role="status" className="px-3 py-4 text-center">
            <div className="text-sm font-medium">No matches for “{query.trim()}”</div>
            <div className="mt-1 text-xs text-muted-foreground">Try another word, or check the spelling.</div>
          </div>
        ) : (
          <>
            <div id={listboxId} role="listbox" aria-label={SEARCH_LABEL}>
              {group("Collections", results.collections, 0)}
              {group("Artefacts", results.artefacts, results.collections.length)}
            </div>
            <div className="flex gap-3 border-t px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
              <span>↑↓ to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
