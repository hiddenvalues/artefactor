import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Menu, Plus, Search, X } from "lucide-react";
import type { OrganizationContext } from "../../../shared/contracts";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "$lib/components/ui/popover";
import { kindMeta } from "../format";
import { HOME, routePath } from "../route";
import { highlight, type Hit, type SearchResults } from "../search";
import { hueVars, kindVars } from "../style";
import { cn } from "../utils";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";

const SEARCH_LABEL = "Search artefacts and collections";

/** S80 — the account button, for a host that moves focus after a switch. */
export interface TopBarAccount {
  /** Focuses the account button on display (one variant is hidden). */
  focus(): void;
  /** Whether `el` is the account button or inside an open menu, i.e. focus the user hasn't moved on. */
  holds(el: Element): boolean;
}

// r[impl platform.search.top-bar-dropdown+2]
export function TopBar({
  query,
  results,
  user,
  onSearch,
  onOpenResult,
  onOpenUpload,
  onSignOut,
  onSwitchOrganization,
  onOpenAccount,
  onOpenOrganization,
  onToggleSidebar,
  onGoHome,
  accountRef,
  switcherOpen = false,
}: {
  query: string;
  // S46 — the global search's hits (`searchLibrary`) for `query`.
  results: SearchResults;
  // S53 — `organizations` only when a superset supplies an org context.
  user: { name: string; email: string; organizations?: OrganizationContext };
  onSearch: (q: string) => void;
  onOpenResult: (hit: Hit) => void;
  onOpenUpload: () => void;
  onSignOut: () => void;
  // S53 — picking an org other than the active one.
  onSwitchOrganization: (organizationId: string) => void;
  // S57 — opens the Account screen.
  onOpenAccount: () => void;
  // S58 — opens Organization settings (offered only with an org context).
  onOpenOrganization: () => void;
  // S25 — toggles the collections/bookmarks sidebar (closed by default).
  onToggleSidebar: () => void;
  // S80 — the logo's plain click: shows Home.
  onGoHome: () => void;
  // S80 — the account button, for the shell's focus after a switch.
  accountRef?: Ref<TopBarAccount>;
  // S53 — previews only: mount with the account menu and its switcher open
  // (a standalone preview page's primary overlay, as `Launcher` does). Only the
  // wide variant takes it: a hidden trigger's menu would open too.
  switcherOpen?: boolean;
}) {
  const account = { user, onSwitchOrganization, onOpenAccount, onOpenOrganization, onSignOut };
  const wide = useRef<HTMLButtonElement>(null);
  const narrow = useRef<HTMLButtonElement>(null);
  useImperativeHandle(
    accountRef,
    () => ({
      focus: () => [wide.current, narrow.current].find((b) => b?.offsetParent != null)?.focus(),
      holds: (el) => el === wide.current || el === narrow.current || el.closest("[role='menu']") !== null,
    }),
    [],
  );

  return (
    <header className="@container/top-bar sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-2.5 @min-[40rem]/top-bar:gap-3.5 @min-[40rem]/top-bar:px-6">
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
          {/* r[impl platform.top-bar.logo-home] */}
          <Logo href={routePath(HOME)} label="Artefactor, go to Home" onNavigate={onGoHome} />
        </div>

        <GlobalSearch query={query} results={results} onSearch={onSearch} onOpenResult={onOpenResult} />

        <div className="flex-1" />

        <Button onClick={onOpenUpload} className="shrink-0">
          <Plus />
          New artefact
        </Button>

        {/* One variant is displayed at a time, so the account button is one tab stop.
            r[impl platform.top-bar.narrow-fit+2] */}
        <div className="hidden shrink-0 @min-[40rem]/top-bar:block">
          <AccountMenu variant="default" {...account} triggerRef={wide} switcherOpen={switcherOpen} />
        </div>
        <div className="shrink-0 @min-[40rem]/top-bar:hidden">
          <AccountMenu variant="avatar" {...account} triggerRef={narrow} />
        </div>
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
