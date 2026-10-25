import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { Card } from "$lib/components/ui/card";
import { rowMetaOf, type RowMetaPart } from "../artefact-card";
import { kindMeta, relativeTime, STORAGE_LABEL } from "../format";
import { kindVars } from "../style";
import {
  AccessBadge,
  BookmarkChip,
  collectionLink,
  Dot,
  inheritedFrom,
  InheritedIcon,
  isSharedItem,
  itemMenu,
  roleOf,
  sharedByOf,
  ShareTrigger,
  ViewerShare,
  type ArtefactItemProps,
} from "./ArtefactCard";

// S56/S65 — a list row of an artefact you own, or (S47) one shared with you,
// per `docs/design/components/artefact-row.md`: the card's content and actions
// on one row — kind tile, title block with its meta line (left out when no
// part applies, so the title centres on the tile), and the right group (access
// badge, the owner's inherited icon, Share, ⋯). Under `@xl` of its own width
// the right group drops below the title block.
export function ArtefactRow(p: ArtefactItemProps) {
  const { a } = p;
  const m = kindMeta(a.kind);
  const Icon = m.icon;
  // The row names its collection only as the card does (`collectionRowOf`, via
  // `p.collection`), and not on that collection's own page.
  const visible = p.collection && p.showCollectionChip !== false ? [[p.collection.id, p.collection] as const] : [];
  const parts = rowMetaOf(a, roleOf(p), new Map(visible));

  function render(part: RowMetaPart): ReactNode {
    switch (part.part) {
      case "shared-by":
        return isSharedItem(p) && <span className="truncate">Shared by {sharedByOf(p.a)}</span>;
      case "collection":
        return collectionLink(p, "max-w-48");
      case "saved-data":
        return (
          <span role="img" title={STORAGE_LABEL} aria-label={STORAGE_LABEL} className="inline-flex items-center">
            <Database className="size-3" />
          </span>
        );
      case "activity":
        return `Updated ${relativeTime(a.updatedAt)}`;
    }
  }

  return (
    <Card className="@container gap-0 py-0 shadow-xs transition-[box-shadow,border-color] duration-150 ease-out hover:border-primary/40 hover:shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-2.5 @xl:flex-nowrap">
        {/* eslint-disable-next-line no-restricted-syntax -- the kind-icon tile is the row's open target, a surface rather than a control */}
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
          <div className="flex min-w-0 items-center gap-1">
            {/* eslint-disable-next-line no-restricted-syntax -- the item's title is its open target, a text surface rather than a control */}
            <button
              type="button"
              onClick={p.onOpen}
              title={a.title}
              className="min-w-0 cursor-pointer truncate rounded-sm text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {a.title}
            </button>
            {p.bookmarked && <BookmarkChip inline onRemove={p.onRemoveBookmark} />}
          </div>
          {/* Each "·" ends the part before it, so a wrapped line never starts with one. */}
          {parts.length > 0 && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              {parts.map((part, i) => (
                <span key={part.part} className="inline-flex min-w-0 items-center gap-1.5">
                  {render(part)}
                  {i < parts.length - 1 && <Dot />}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 @xl:w-auto @xl:shrink-0 @xl:flex-nowrap">
          <AccessBadge a={a} />
          {isSharedItem(p) ? (
            <ViewerShare p={p} />
          ) : (
            <>
              {a.collectionId !== null && <InheritedIcon from={inheritedFrom(p)} />}
              <ShareTrigger p={p} />
            </>
          )}
          {itemMenu(p, "list")}
        </div>
      </div>
    </Card>
  );
}
