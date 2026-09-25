import { Bookmark, Database, ExternalLink, X } from "lucide-react";
import type { SharedArtefactSummary } from "../../../shared/contracts";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import { Card } from "$lib/components/ui/card";
import { initials, kindMeta, relativeTime, STORAGE_LABEL } from "../format";
import { kindVars } from "../style";
import { cn } from "../utils";
import { cardLift, chip, Dot } from "./ArtefactCard";
import { CardThumbnail } from "./CardThumbnail";

/** A card or row of someone else's artefact you can see. */
export interface GalleryItemProps {
  g: SharedArtefactSummary;
  onOpen: () => void;
  // S27 (BM2) — shared artefacts are bookmarkable too.
  bookmarked?: boolean;
  onBookmark?: () => void;
  // S29 (CL13) — on the caller's own collection page: eject this foreign
  // artefact back to its owner's top level.
  onEject?: () => void;
}

const ownerOf = (g: SharedArtefactSummary) => g.owner.name || g.owner.email || "Unknown";

function BookmarkToggle({ bookmarked, onBookmark, className }: { bookmarked: boolean; onBookmark: () => void; className?: string }) {
  const label = bookmarked ? "Remove bookmark" : "Bookmark";
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onBookmark}
      title={label}
      aria-label={label}
      className={cn("size-8", bookmarked ? "text-primary" : "text-muted-foreground", className)}
    >
      <Bookmark className={cn("size-3.5", bookmarked && "fill-current")} />
    </Button>
  );
}

function EjectButton({ g, onEject }: { g: SharedArtefactSummary; onEject: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onEject}
      title="Remove from collection"
      aria-label={`Remove ${g.title} from this collection`}
      className="text-muted-foreground"
    >
      <X />
      Remove
    </Button>
  );
}

export function GalleryCard({ g, onOpen, bookmarked = false, onBookmark, onEject }: GalleryItemProps) {
  const owner = ownerOf(g);
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-xs", cardLift)}>
      {/* The bookmark toggle sits over the preview's lower-right, outside the
          open-button so a mis-click never opens the artefact. */}
      <div className="relative">
        <CardThumbnail
          kind={g.kind}
          title={g.title}
          thumbnailUrl={g.thumbnailUrl}
          onOpen={onOpen}
          chips={
            g.usesStorage && (
              <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className={cn(chip, "text-muted-foreground")}>
                <Database className="size-3.5" />
              </span>
            )
          }
        />
        {onBookmark && (
          <BookmarkToggle bookmarked={bookmarked} onBookmark={onBookmark} className="absolute right-2 bottom-2 size-7 bg-card" />
        )}
      </div>
      <div className="flex flex-col gap-3 p-3.5">
        <div className="truncate text-sm leading-snug font-semibold">{g.title}</div>
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            <AvatarFallback className="text-[10px] font-semibold">{initials(owner)}</AvatarFallback>
          </Avatar>
          <span className="truncate text-xs text-muted-foreground">{owner}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(g.updatedAt)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onOpen}>
            <ExternalLink />
            Open
          </Button>
          {onEject && <EjectButton g={g} onEject={onEject} />}
        </div>
      </div>
    </Card>
  );
}

export function GalleryRow({ g, onOpen, bookmarked = false, onBookmark, onEject }: GalleryItemProps) {
  const m = kindMeta(g.kind);
  const Icon = m.icon;
  const owner = ownerOf(g);
  return (
    <Card className="flex-row items-center gap-3.5 px-3.5 py-2.5 shadow-xs">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${g.title}`}
        style={kindVars(g.kind)}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-(--kind-tint) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className="size-5 text-(--kind)" strokeWidth={1.7} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{g.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{m.label}</span>
          {g.usesStorage && (
            <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className="inline-flex items-center">
              <Database className="size-3" />
            </span>
          )}
          <Dot />
          <span>Shared by {owner}</span>
          <Dot />
          <span>{relativeTime(g.updatedAt)}</span>
        </div>
      </div>
      <Avatar className="size-6">
        <AvatarFallback className="text-[10px] font-semibold">{initials(owner)}</AvatarFallback>
      </Avatar>
      {onEject && <EjectButton g={g} onEject={onEject} />}
      {onBookmark && <BookmarkToggle bookmarked={bookmarked} onBookmark={onBookmark} />}
      <Button variant="outline" size="sm" onClick={onOpen}>
        <ExternalLink />
        Open
      </Button>
    </Card>
  );
}
