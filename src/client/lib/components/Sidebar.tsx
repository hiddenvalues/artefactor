import type { ReactNode } from "react";
import { Archive, Bookmark, Folder, Home, Plus, Users } from "lucide-react";
import type { ArtefactSummary, CollectionSummary } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { kindMeta } from "../format";
import { hueVars, kindVars } from "../style";
import { flattenTree } from "../tree";
import { cn } from "../utils";
import type { View } from "../view";
import { indent, TreeToggle } from "./TreeToggle";

const navRow = (active: boolean) =>
  cn(
    "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active && "bg-sidebar-accent font-semibold",
  );

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{children}</span>
);

function RemoveBookmark({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      onClick={onClick}
      title="Remove bookmark"
      aria-label={`Remove bookmark for ${name}`}
    >
      <Bookmark className="size-3.5 fill-current" />
    </Button>
  );
}

// S25/S27 — the collections + bookmarks sidebar (hamburger-toggled, closed by
// default). Sections top→bottom: Home + Shared with you, Bookmarks (collections before
// artefacts), the Collections tree, and an Archive footer with a count.
export function Sidebar({
  view,
  collections,
  activeCollectionId,
  expanded,
  bookmarkedArtefacts,
  bookmarkedCollections,
  archivedCount,
  onHome,
  onOpenShared,
  onOpenCollection,
  onOpenArchive,
  onNewCollection,
  onToggleExpand,
  onOpenArtefact,
  onRemoveBookmark,
}: {
  view: View;
  collections: CollectionSummary[]; // active only
  activeCollectionId: string | null;
  expanded: Record<string, boolean>;
  bookmarkedArtefacts: ArtefactSummary[];
  bookmarkedCollections: CollectionSummary[];
  archivedCount: number;
  onHome: () => void;
  onOpenShared: () => void;
  onOpenCollection: (id: string) => void;
  onOpenArchive: () => void;
  onNewCollection: () => void;
  onToggleExpand: (id: string) => void;
  onOpenArtefact: (a: ArtefactSummary) => void;
  onRemoveBookmark: (kind: "artefact" | "collection", id: string) => void;
}) {
  const tree = flattenTree(collections, expanded);
  const bookmarkedIds = new Set(bookmarkedCollections.map((c) => c.id));
  const hasBookmarks = bookmarkedArtefacts.length > 0 || bookmarkedCollections.length > 0;

  return (
    <aside className="sticky top-0 flex h-screen w-66 shrink-0 flex-col overflow-y-auto border-r bg-sidebar text-sidebar-foreground">
      <div className="flex flex-1 flex-col gap-5 px-2.5 py-3.5">
        <div>
          <button type="button" onClick={onHome} className={navRow(view === "dashboard")}>
            <Home className="size-4" />
            Home
          </button>
          {/* S46 — interim: the top bar's tabs are gone until the landing page re-homes this view. */}
          <button type="button" onClick={onOpenShared} className={navRow(view === "gallery")}>
            <Users className="size-4" />
            Shared with you
          </button>
        </div>

        {hasBookmarks && (
          <div>
            <div className="px-2 pb-1.5">
              <SectionLabel>Bookmarks</SectionLabel>
            </div>
            {bookmarkedCollections.map((c) => (
              <div key={c.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onOpenCollection(c.id)}
                  className={navRow(view === "collection" && activeCollectionId === c.id)}
                >
                  <Folder style={hueVars(c.id)} className="size-3.5 shrink-0 text-(--hue)" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </button>
                <RemoveBookmark name={c.name} onClick={() => onRemoveBookmark("collection", c.id)} />
              </div>
            ))}
            {bookmarkedArtefacts.map((a) => {
              const m = kindMeta(a.kind);
              const Icon = m.icon;
              return (
                <div key={a.id} className="flex items-center">
                  <button type="button" onClick={() => onOpenArtefact(a)} className={navRow(false)}>
                    <Icon style={kindVars(a.kind)} className="size-3.5 shrink-0 text-(--kind)" />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  </button>
                  <RemoveBookmark name={a.title} onClick={() => onRemoveBookmark("artefact", a.id)} />
                </div>
              );
            })}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between pr-1 pb-1.5 pl-2">
            <SectionLabel>Collections</SectionLabel>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={onNewCollection}
              title="New collection"
              aria-label="New collection"
            >
              <Plus />
            </Button>
          </div>
          {tree.length === 0 ? (
            <div className="px-2 text-sm text-muted-foreground">No collections yet.</div>
          ) : (
            tree.map((node) => (
              <div key={node.c.id} className={cn("flex items-center", indent(node.depth))}>
                <TreeToggle
                  hasChildren={node.hasChildren}
                  expanded={!!expanded[node.c.id]}
                  onToggle={() => onToggleExpand(node.c.id)}
                />
                <button
                  type="button"
                  onClick={() => onOpenCollection(node.c.id)}
                  className={navRow(view === "collection" && activeCollectionId === node.c.id)}
                >
                  <Folder style={hueVars(node.c.id)} className="size-3.5 shrink-0 text-(--hue)" />
                  <span className="min-w-0 flex-1 truncate">{node.c.name}</span>
                  {bookmarkedIds.has(node.c.id) && <Bookmark className="size-3 shrink-0 fill-current" />}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {archivedCount > 0 && (
        <div className="border-t p-2.5">
          <button type="button" onClick={onOpenArchive} className={navRow(view === "archive")}>
            <Archive className="size-4" />
            <span className="flex-1">Archive</span>
            <Badge variant="secondary">{archivedCount}</Badge>
          </button>
        </div>
      )}
    </aside>
  );
}
