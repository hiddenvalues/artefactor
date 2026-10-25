import { Bookmark, CornerLeftUp, Database, Folder, Share2 } from "lucide-react";
import type { ArtefactSummary, LinkGateSummary, SharedArtefactSummary } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Card } from "$lib/components/ui/card";
import { cardMeta, shareLinkOf, type CardRole } from "../artefact-card";
import { kindMeta, relativeTime, STORAGE_LABEL, VIS, type DataVisibility } from "../format";
import { hueVars, kindVars } from "../style";
import { cn } from "../utils";
import { AccessInheritedPopover } from "./AccessInheritedPopover";
import { CardThumbnail } from "./CardThumbnail";
import { LinkGateBadges } from "./LinkGateBadges";
import { MoreMenu } from "./MoreMenu";

/** The item's collection, when the signed-in user can see it (S54,
 *  `collectionRowOf`). */
export type ItemCollection = { id: string; name: string } | null;

/** Everything a card or row of an artefact you own needs. */
export interface OwnedItemProps {
  a: ArtefactSummary;
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onArchive: () => void;
  // S55/S56 — a top-level item's Share opens the Manage access dialog.
  onShare: () => void;
  // S41 — whether viewers may load each other's saved data.
  onDataVisibility?: (v: DataVisibility) => void;
  // S25/S27 — collections + bookmarks.
  collectionName?: string | null;
  // S54 — the collection row.
  collection?: ItemCollection;
  // S32b — the tree root's link protection this artefact follows, if any.
  inheritedGate?: { rootName: string; gate: LinkGateSummary } | null;
  onOpenCollection?: () => void;
  // S64 — the tree root whose access the artefact follows (`accessRootOf`):
  // the "Access inherited" popover names and opens it.
  accessRoot?: { name: string; onOpen: () => void } | null;
  bookmarked?: boolean;
  onBookmark?: () => void;
  // S54 — the thumbnail's bookmark button: removes it, with an Undo toast.
  onRemoveBookmark?: () => void;
  onMoveToCollection?: () => void;
  // Hide the collection when the item already sits on that collection's page.
  showCollectionChip?: boolean;
}

/** S47 — the same card or row for another user's artefact shared with you:
 *  attribution and a read-only access badge instead of the visibility control,
 *  and only the menu items a viewer may use. */
export interface SharedItemProps {
  a: SharedArtefactSummary;
  shared: true;
  onOpen: () => void;
  onCopy: () => void;
  bookmarked?: boolean;
  onBookmark?: () => void;
  onRemoveBookmark?: () => void;
  // S54 — the collection row, for a collection shared with you (S28).
  collection?: ItemCollection;
  onOpenCollection?: () => void;
  showCollectionChip?: boolean;
  // S62 — the collection owner's eject, on their own collection page (S29).
  onRemoveFromCollection?: () => void;
}

export type ArtefactItemProps = OwnedItemProps | SharedItemProps;

export const isSharedItem = (p: ArtefactItemProps): p is SharedItemProps => "shared" in p;
export const roleOf = (p: ArtefactItemProps): CardRole => (isSharedItem(p) ? "viewer" : "owner");

export const sharedByOf = (a: SharedArtefactSummary) => a.owner.name || a.owner.email || "Unknown";

export const chip = "inline-flex items-center justify-center rounded-md bg-card p-1 shadow-sm";
// An inline link-style action in an item's meta line: a link Button reset to
// the line's own size, weight and colour.
const linkish =
  "h-auto min-w-0 shrink cursor-pointer gap-1 rounded-sm p-0 text-xs font-normal text-inherit underline-offset-auto has-[>svg]:p-0";

/** The item's ⋯ menu: every item for your own, a viewer's few for another's. */
export function itemMenu(p: ArtefactItemProps, variant: "grid" | "list") {
  const { a } = p;
  const download = `/api/artefacts/${a.id}/download`;
  if (isSharedItem(p))
    return (
      <MoreMenu
        role="viewer"
        variant={variant}
        onOpen={p.onOpen}
        bookmarked={p.bookmarked}
        onBookmark={p.onBookmark}
        downloadHref={download}
        onRemoveFromCollection={p.onRemoveFromCollection}
      />
    );
  return (
    <MoreMenu
      role="owner"
      variant={variant}
      onOpen={p.onOpen}
      onEdit={p.onEdit}
      onArchive={p.onArchive}
      bookmarked={p.bookmarked}
      onBookmark={p.onBookmark}
      inCollection={a.collectionId !== null}
      onMoveToCollection={p.onMoveToCollection}
      downloadHref={download}
    />
  );
}

/** The owner's Share button, on a card and a row alike: on a top-level artefact
 *  it opens the Manage access dialog (S55); inside a collection, the "Access
 *  inherited" popover, since the root governs (hosting.access.effective-from-tree-root). */
export function ShareTrigger({ p }: { p: OwnedItemProps }) {
  const { a } = p;
  // S65 — the tooltip names what Share opens.
  const share = (title: string, onClick?: () => void) => (
    <Button variant="outline" size="sm" aria-haspopup="dialog" title={title} onClick={onClick}>
      <Share2 />
      Share
    </Button>
  );
  if (a.collectionId === null) return share("Manage access", p.onShare);
  // S64 — the share link sits at the popover's top, under the same rule as a
  // viewer's Share (hosting.card.share-link-unless-private).
  const path = shareLinkOf(a);
  return (
    <AccessInheritedPopover
      width="share"
      trigger={share("Access inherited")}
      link={path ? { path, onCopy: p.onCopy } : null}
      collectionName={inheritedFrom(p)}
      gate={p.inheritedGate ?? null}
      onOpenCollection={p.accessRoot?.onOpen ?? p.onOpenCollection}
      usesStorage={a.usesStorage}
      dataVisibility={a.dataVisibility}
      onChooseData={p.onDataVisibility}
    />
  );
}

/** The collection link "In X", tinted with its hue: a card's collection row and a
 *  row's meta line. */
export function collectionLink(p: ArtefactItemProps, className?: string) {
  const c = p.collection;
  if (!c || p.showCollectionChip === false) return null;
  return (
    <Button
      type="button"
      variant="link"
      onClick={p.onOpenCollection}
      title={`Open “${c.name}”`}
      style={hueVars(c.id)}
      className={cn(linkish, className)}
    >
      <Folder className="size-3 shrink-0 text-(--hue)" />
      <span className="truncate">
        In {c.name}
      </span>
    </Button>
  );
}

/** S54 — the read-only access badge: the effective tier
 *  (hosting.access.effective-from-tree-root) and, on your own protected public link, its lock and
 *  clock (hosting.link-gate.owner-summary-only; only an owner's summary carries the gate). */
export function AccessBadge({ a }: { a: ArtefactSummary }) {
  const v = VIS[a.effectiveVisibility];
  const Icon = v.icon;
  const gate = a.collectionId === null && a.effectiveVisibility === "public" ? a.linkGate : null;
  return (
    // S62 — on a narrow card the label truncates (the title keeps it whole), so
    // Share stays on the access row instead of being clipped at the card's edge.
    <Badge variant="secondary" title={`Access: ${v.label}`} className="min-w-0 shrink">
      <Icon />
      <span className="min-w-0 truncate">{v.label}</span>
      <LinkGateBadges gate={gate} />
    </Badge>
  );
}

/** S54 — the thumbnail's saved-data chip. */
export const StorageChip = () => (
  <span role="img" title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className={cn(chip, "text-muted-foreground")}>
    <Database className="size-3.5" />
  </span>
);

/** S54 — the thumbnail's bookmark: a button of its own that removes it. Inline
 *  (S56), it sits after a row's title, without the chip's surface. */
export const BookmarkChip = ({ onRemove, inline = false }: { onRemove?: () => void; inline?: boolean }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    title="Remove bookmark"
    aria-label="Remove bookmark"
    onClick={onRemove}
    disabled={!onRemove}
    className={cn(inline ? "rounded-sm p-0.5" : chip, "size-auto shrink-0 text-primary hover:text-primary")}
  >
    <Bookmark className="size-3.5 fill-current" />
  </Button>
);

export const Dot = () => <span className="opacity-50">·</span>;

/** The collection an artefact's access is inherited from: its tree root (S64),
 *  named alike by the inherited icon and the "Access inherited" popover (S65). */
export const inheritedFrom = (p: OwnedItemProps): string => p.accessRoot?.name ?? p.collectionName ?? "";

/** S62 — the owner's mark, on a card and (S65) a row, that access comes from
 *  the collection's root. */
export function InheritedIcon({ from }: { from: string }) {
  const label = `Access inherited from “${from}”`;
  return (
    <span role="img" title={label} aria-label={label} className="inline-flex shrink-0 text-muted-foreground">
      <CornerLeftUp className="size-4" />
    </span>
  );
}

/** S62 — a viewer's Share, on a card and (S65) a row: copies the share link
 *  whenever there is one (`shareLinkOf`), and opens no dialog. */
export function ViewerShare({ p }: { p: SharedItemProps }) {
  if (!shareLinkOf(p.a)) return null;
  return (
    <Button variant="outline" size="sm" aria-label="Copy link" title="Copy link" onClick={p.onCopy}>
      <Share2 />
      Share
    </Button>
  );
}

// Grid cards (not list rows) lift on hover — the Svelte client's `.af-card-grid`
// pop, value for value: a 6 px rise and 1.5 % scale, its own shadow and a tinted
// border, eased over 150 ms and raised above neighbouring cards so the shadow
// isn't drawn under them — but to `z-10`, under the sticky top bar's `z-20`, so
// a card scrolled under the bar stays beneath it. The lift sets `transform`
// itself, not Tailwind's `translate-*` / `scale-*` (those move the separate
// `translate` and `scale` properties, which a `transform` transition doesn't
// ease — the card would snap). Reduced motion keeps only the shadow and border
// change.
// r[impl platform.client.card-lift-under-top-bar]
export const cardLift =
  "relative transition-[transform,box-shadow,border-color] duration-150 ease-out hover:z-10 hover:[transform:translateY(-6px)_scale(1.015)] hover:border-primary/40 hover:shadow-card-lift motion-reduce:transition-[box-shadow,border-color] motion-reduce:hover:transform-none";

// S62 — the one grid card of an artefact, yours or (S47) one shared with you,
// per `docs/design/components/artefact-card.md`: thumbnail, title row (kind
// icon · title · ⋯), collection row, activity and — on the bottom edge — the
// access row. The card fills its grid cell, so a row's access rows line up.
// r[impl hosting.home.shared-cards+2]
export function ArtefactCard(p: ArtefactItemProps) {
  const { a } = p;
  const role = roleOf(p);
  const meta = cardMeta(a, role);
  const kind = kindMeta(a.kind);
  const KindIcon = kind.icon;
  const collection = collectionLink(p, "max-w-full");
  return (
    <Card className={cn("h-full gap-0 overflow-hidden py-0 shadow-xs", cardLift)}>
      <CardThumbnail
        kind={a.kind}
        title={a.title}
        thumbnailUrl={a.thumbnailUrl}
        onOpen={p.onOpen}
        chips={
          (a.usesStorage || p.bookmarked) && (
            <>
              {a.usesStorage && <StorageChip />}
              {p.bookmarked && <BookmarkChip onRemove={p.onRemoveBookmark} />}
            </>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-2.5 p-3.5 pt-3">
        {/* A long title wraps to two lines; the kind icon and ⋯ stay level with
            the first, which the title's margin centres on the 32px ⋯. */}
        <div className="flex items-start gap-2">
          {/* Named, with a tooltip, now that the thumbnail carries no kind text. */}
          <span role="img" title={kind.label} aria-label={kind.label} style={kindVars(a.kind)} className="inline-flex h-8 shrink-0 items-center text-(--kind)">
            <KindIcon className="size-4" />
          </span>
          {/* eslint-disable-next-line no-restricted-syntax -- the item's title is its open target, a text surface rather than a control */}
          <button
            type="button"
            onClick={p.onOpen}
            title={a.title}
            className="my-1.5 min-w-0 flex-1 cursor-pointer rounded-sm text-left text-sm leading-snug font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {/* The clamp sits on an inner span: WebKit won't lay a button out
                as the -webkit-box that line-clamp needs. */}
            <span
              // r[impl hosting.card.long-title]
              className="line-clamp-2 break-words"
            >
              {a.title}
            </span>
          </button>
          {itemMenu(p, "grid")}
        </div>
        {collection && <div className="flex min-w-0 text-xs text-muted-foreground">{collection}</div>}
        {meta.showActivity && <div className="text-xs text-muted-foreground">Updated {relativeTime(a.updatedAt)}</div>}
        {/* The access row sits on the bottom edge; a viewer's wraps, growing
            upward, so "Shared by …" and Share move to a second line together
            rather than cutting the name. An owner's stays one line. */}
        <div className={cn("mt-auto flex min-h-8 min-w-0 items-center gap-x-2", isSharedItem(p) && "flex-wrap gap-y-1.5")}>
          <AccessBadge a={a} />
          {isSharedItem(p) ? (
            <div className="flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-1.5">
              {meta.showSharedBy && (
                <span title={`Shared by ${sharedByOf(p.a)}`} className="max-w-full truncate text-xs text-muted-foreground">
                  Shared by {sharedByOf(p.a)}
                </span>
              )}
              <span className="ml-auto">
                <ViewerShare p={p} />
              </span>
            </div>
          ) : (
            <>
              {a.collectionId !== null && <InheritedIcon from={inheritedFrom(p)} />}
              <span className="ml-auto">
                <ShareTrigger p={p} />
              </span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
