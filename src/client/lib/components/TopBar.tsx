import { ChevronDown, LogOut, Menu, Plus, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input";
import { initials } from "../format";
import type { View } from "../view";
import { cn } from "../utils";
import { Logo } from "./Logo";

export function TopBar({
  view,
  query,
  searchPlaceholder,
  user,
  onSearch,
  onGoDashboard,
  onGoGallery,
  onOpenUpload,
  onSignOut,
  onToggleSidebar,
}: {
  view: View;
  query: string;
  searchPlaceholder: string;
  user: { name: string; email: string };
  onSearch: (q: string) => void;
  onGoDashboard: () => void;
  onGoGallery: () => void;
  onOpenUpload: () => void;
  onSignOut: () => void;
  // S25 — toggles the collections/bookmarks sidebar (closed by default).
  onToggleSidebar: () => void;
}) {
  const displayName = user.name || user.email;
  // Plain buttons (not roving tabs): Tab reaches both views.
  const tab = (active: boolean) =>
    cn("h-7 px-3.5 font-medium", active ? "bg-background shadow-sm hover:bg-background" : "text-muted-foreground");

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="flex items-center gap-3.5 px-6 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          className="text-muted-foreground"
        >
          <Menu />
        </Button>
        <div className="mr-1">
          <Logo />
        </div>

        <nav className="flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
          <Button
            variant="ghost"
            size="sm"
            className={tab(view === "dashboard")}
            aria-current={view === "dashboard" ? "page" : undefined}
            onClick={onGoDashboard}
          >
            Your artefacts
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={tab(view === "gallery")}
            aria-current={view === "gallery" ? "page" : undefined}
            onClick={onGoGallery}
          >
            Shared with you
          </Button>
        </nav>

        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>

        <div className="flex-1" />

        <Button onClick={onOpenUpload}>
          <Plus />
          New artefact
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1.5 px-1.5" title="Account" aria-label="Account">
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
