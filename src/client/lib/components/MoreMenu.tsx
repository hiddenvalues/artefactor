import { Archive, Bookmark, Download, ExternalLink, Folder, Link, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";

// A card's / row's ⋯ menu.
export function MoreMenu({
  isShared,
  variant = "grid",
  onOpen,
  onCopy,
  onEdit,
  onArchive,
  bookmarked = false,
  onBookmark,
  inCollection = false,
  onMoveToCollection,
  downloadHref,
}: {
  isShared: boolean;
  variant?: "grid" | "list";
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onArchive: () => void;
  // S27 — bookmark toggle (owned artefacts only; omitted elsewhere).
  bookmarked?: boolean;
  onBookmark?: () => void;
  // S25 — add/move to collection ("Move…" once it's already in one).
  inCollection?: boolean;
  onMoveToCollection?: () => void;
  // S30 — "Download HTML". A plain anchor: the export endpoint authenticates on
  // the session cookie, so no fetch/blob dance is needed.
  downloadHref?: string;
}) {
  // Non-modal, so an item that opens a dialog (Edit, Add to collection…) never
  // races the menu's own focus trap and pointer lock.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "grid" ? "ghost" : "outline"}
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          title="More"
          aria-label="More"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={onOpen}>
          <ExternalLink />
          Open
        </DropdownMenuItem>
        {onBookmark && (
          <DropdownMenuItem onSelect={onBookmark}>
            <Bookmark className={bookmarked ? "fill-current" : undefined} />
            {bookmarked ? "Remove bookmark" : "Bookmark"}
          </DropdownMenuItem>
        )}
        {onMoveToCollection && (
          <DropdownMenuItem onSelect={onMoveToCollection}>
            <Folder />
            {inCollection ? "Move to collection…" : "Add to collection…"}
          </DropdownMenuItem>
        )}
        {isShared && (
          <DropdownMenuItem onSelect={onCopy}>
            <Link />
            Copy share link
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {downloadHref && (
          <DropdownMenuItem asChild>
            <a href={downloadHref} download>
              <Download />
              Download HTML
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onArchive}>
          <Archive />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
