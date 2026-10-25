import { Archive, Bookmark, Download, ExternalLink, Folder, FolderMinus, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { menuItemsOf, type CardRole } from "../artefact-card";

// A card's / row's ⋯ menu, in the order `menuItemsOf` gives (S54): an item
// whose handler isn't passed is left out.
export function MoreMenu({
  role,
  variant = "grid",
  onOpen,
  onEdit,
  onArchive,
  bookmarked = false,
  onBookmark,
  inCollection = false,
  onMoveToCollection,
  downloadHref,
  onRemoveFromCollection,
}: {
  // S47 — another user's artefact gets only the items a viewer may use.
  role: CardRole;
  variant?: "grid" | "list";
  onOpen: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  // S27 — bookmark toggle.
  bookmarked?: boolean;
  onBookmark?: () => void;
  // S25 — add/move to collection ("Move…" once it's already in one).
  inCollection?: boolean;
  onMoveToCollection?: () => void;
  // S30 — "Download HTML", for owner and viewer alike. A plain anchor: the
  // export endpoint authenticates on the session cookie, so no fetch/blob
  // dance is needed.
  downloadHref?: string;
  // S62 — on their own collection page, the collection's owner ejects another
  // user's artefact from it (S29, collections.containment.co-owned).
  onRemoveFromCollection?: () => void;
}) {
  const items = menuItemsOf(role, {
    inCollection,
    hasDownload: !!downloadHref,
    canRemoveFromCollection: !!onRemoveFromCollection,
  });
  // Non-modal, so an item that opens a dialog (Edit, Add to collection…) never
  // races the menu's own focus trap and pointer lock.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "grid" ? "ghost" : "outline"}
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          title="More actions"
          aria-label="More actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((item) => {
          switch (item) {
            case "open":
              return (
                <DropdownMenuItem key={item} onSelect={onOpen}>
                  <ExternalLink />
                  Open
                </DropdownMenuItem>
              );
            case "bookmark":
              return (
                onBookmark && (
                  <DropdownMenuItem key={item} onSelect={onBookmark}>
                    <Bookmark className={bookmarked ? "fill-current" : undefined} />
                    {bookmarked ? "Remove bookmark" : "Bookmark"}
                  </DropdownMenuItem>
                )
              );
            case "add-to-collection":
            case "move-to-collection":
              return (
                onMoveToCollection && (
                  <DropdownMenuItem key={item} onSelect={onMoveToCollection}>
                    <Folder />
                    {item === "move-to-collection" ? "Move to collection…" : "Add to collection…"}
                  </DropdownMenuItem>
                )
              );
            case "edit":
              return (
                onEdit && (
                  <DropdownMenuItem key={item} onSelect={onEdit}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                )
              );
            case "download":
              return (
                <DropdownMenuItem key={item} asChild>
                  <a href={downloadHref} download>
                    <Download />
                    Download HTML
                  </a>
                </DropdownMenuItem>
              );
            case "separator":
              return (onArchive || onRemoveFromCollection) && <DropdownMenuSeparator key={item} />;
            case "archive":
              return (
                onArchive && (
                  <DropdownMenuItem key={item} variant="destructive" onSelect={onArchive}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                )
              );
            case "remove-from-collection":
              return (
                <DropdownMenuItem key={item} onSelect={onRemoveFromCollection}>
                  <FolderMinus />
                  Remove from collection
                </DropdownMenuItem>
              );
          }
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
