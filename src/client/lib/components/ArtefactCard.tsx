import { Bookmark, Database, Folder, Link } from "lucide-react";
import type { ArtefactSummary, SetLinkGateRequest } from "../../../shared/contracts";
import { Card } from "$lib/components/ui/card";
import { fmtBytes, kindMeta, relativeTime, STORAGE_LABEL, type DataVisibility, type Visibility } from "../format";
import { hueVars, kindVars } from "../style";
import { cn } from "../utils";
import { CardThumbnail } from "./CardThumbnail";
import { LinkGateBadges } from "./LinkGateBadges";
import { MoreMenu } from "./MoreMenu";
import { VisibilityControl } from "./VisibilityControl";

/** Everything a card or row of an artefact you own needs. */
export interface OwnedItemProps {
  a: ArtefactSummary;
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onVisibility: (v: Visibility, linkGate?: { password?: string; expiresAt?: string }) => void;
  // S32a — change the link protection of this (public) artefact.
  onLinkGate?: (change: SetLinkGateRequest) => void;
  onManage: () => void;
  // S41 — whether viewers may load each other's saved data.
  onDataVisibility?: (v: DataVisibility) => void;
  // S25/S27 — collections + bookmarks.
  collectionName?: string | null;
  onOpenCollection?: () => void;
  bookmarked?: boolean;
  onBookmark?: () => void;
  onMoveToCollection?: () => void;
  // Hide the "in <Collection>" chip when the item already sits on that
  // collection's page.
  showCollectionChip?: boolean;
}

export const chip = "inline-flex items-center justify-center rounded-md bg-card p-1 shadow-sm";
export const linkish =
  "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The owned item's derived bits and its visibility control, shared by card and row. */
export function useOwnedItem(p: OwnedItemProps, variant: "block" | "pill") {
  const { a } = p;
  const inherited = a.collectionId !== null;
  // Link reachability follows the *effective* tier (AH20).
  const isShared = a.effectiveVisibility !== "private" && !!a.publicSlug;
  const visibility = (
    <VisibilityControl
      visibility={a.effectiveVisibility}
      variant={variant}
      onChoose={p.onVisibility}
      onManage={p.onManage}
      inherited={inherited}
      inheritedFrom={p.collectionName ?? ""}
      onOpenCollection={p.onOpenCollection}
      usesStorage={a.usesStorage}
      dataVisibility={a.dataVisibility}
      onChooseData={p.onDataVisibility}
      linkProtection={
        p.onLinkGate
          ? {
              current: a.linkGate ?? null,
              onPublish: (gate) => p.onVisibility("public", gate),
              onSave: p.onLinkGate,
            }
          : undefined
      }
    />
  );
  const menu = (
    <MoreMenu
      isShared={isShared}
      variant={variant === "block" ? "grid" : "list"}
      onOpen={p.onOpen}
      onCopy={p.onCopy}
      onEdit={p.onEdit}
      onArchive={p.onArchive}
      bookmarked={p.bookmarked}
      onBookmark={p.onBookmark}
      inCollection={inherited}
      onMoveToCollection={p.onMoveToCollection}
      downloadHref={`/api/artefacts/${a.id}/download`}
    />
  );
  const collectionChip = inherited && p.collectionName && p.showCollectionChip !== false && (
    <button
      type="button"
      onClick={p.onOpenCollection}
      title={`Open “${p.collectionName}”`}
      style={hueVars(a.collectionId!)}
      className={cn(linkish, "max-w-36")}
    >
      <Folder className="size-3 shrink-0 text-(--hue)" />
      <span className="truncate">in {p.collectionName}</span>
    </button>
  );
  const shareLink = isShared && (
    <button type="button" onClick={p.onCopy} title={`Copy ${location.origin}/a/${a.publicSlug}`} className={cn(linkish, "text-primary")}>
      <Link className="size-3" />
      <span className="font-mono">/a/{a.publicSlug}</span>
    </button>
  );
  return { isShared, visibility, menu, collectionChip, shareLink };
}

export const Dot = () => <span className="opacity-50">·</span>;

// Grid cards (not list rows) lift on hover: a small rise and scale, a deeper
// shadow and a tinted border, raised above their neighbours so the shadow isn't
// drawn under them. Reduced motion keeps only the shadow and border change.
export const cardLift =
  "relative transition-[transform,box-shadow,border-color] duration-150 ease-out hover:z-20 hover:-translate-y-1.5 hover:scale-[1.015] hover:border-primary/40 hover:shadow-xl motion-reduce:transition-[box-shadow,border-color] motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100";

// A grid card of an artefact you own.
export function ArtefactCard(p: OwnedItemProps) {
  const { a } = p;
  const { visibility, menu, collectionChip, shareLink } = useOwnedItem(p, "block");
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-xs", cardLift)}>
      <CardThumbnail
        kind={a.kind}
        title={a.title}
        thumbnailUrl={a.thumbnailUrl}
        onOpen={p.onOpen}
        chips={
          <>
            {p.bookmarked && (
              <span title="Bookmarked" aria-label="Bookmarked" className={cn(chip, "text-primary")}>
                <Bookmark className="size-3.5 fill-current" />
              </span>
            )}
            <LinkGateBadges gate={a.linkGate} variant="chip" />
            {a.usesStorage && (
              <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className={cn(chip, "text-muted-foreground")}>
                <Database className="size-3.5" />
              </span>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-2.5 p-3.5 pt-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={p.onOpen}
            className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sm leading-snug font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {a.title}
          </button>
          {menu}
        </div>
        {visibility}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {collectionChip && (
            <>
              {collectionChip}
              <Dot />
            </>
          )}
          <span>Updated {relativeTime(a.updatedAt)}</span>
          <Dot />
          <span className="font-mono">{fmtBytes(a.payloadBytes)}</span>
          {shareLink && <span className="ml-auto">{shareLink}</span>}
        </div>
      </div>
    </Card>
  );
}

// A list row of an artefact you own.
export function ArtefactRow(p: OwnedItemProps) {
  const { a } = p;
  const m = kindMeta(a.kind);
  const Icon = m.icon;
  const { visibility, menu, collectionChip, shareLink } = useOwnedItem(p, "pill");
  return (
    <Card className="flex-row items-center gap-3.5 px-3.5 py-2.5 shadow-xs">
      <button
        type="button"
        onClick={p.onOpen}
        aria-label={`Open ${a.title}`}
        style={kindVars(a.kind)}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-(--kind-tint) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className="size-5 text-(--kind)" strokeWidth={1.7} />
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={p.onOpen}
          className="block max-w-full cursor-pointer truncate rounded-sm text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {a.title}
          {p.bookmarked && <Bookmark className="ml-1.5 inline size-3 fill-current align-[-1px] text-primary" />}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{m.label}</span>
          {collectionChip && (
            <>
              <Dot />
              {collectionChip}
            </>
          )}
          <LinkGateBadges gate={a.linkGate} variant="inline" />
          {a.usesStorage && (
            <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className="inline-flex items-center">
              <Database className="size-3" />
            </span>
          )}
          <Dot />
          <span>Updated {relativeTime(a.updatedAt)}</span>
          <Dot />
          <span className="font-mono">{fmtBytes(a.payloadBytes)}</span>
          {shareLink && (
            <>
              <Dot />
              {shareLink}
            </>
          )}
        </div>
      </div>
      {visibility}
      {menu}
    </Card>
  );
}
