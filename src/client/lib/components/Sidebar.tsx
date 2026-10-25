import type { ReactNode } from "react";
import { Archive, Bookmark, Folder, Home, Plus } from "lucide-react";
import type { ArtefactSummary, CollectionSummary, SharedCollectionSummary } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { kindMeta } from "../format";
import { hueVars, kindVars } from "../style";
import { flattenTree, type TreeNode } from "../tree";
import { cn } from "../utils";
import type { View } from "../view";
import { NavRow } from "./NavRow";
import { indent, TreeToggle } from "./TreeToggle";

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
// default). Sections top→bottom: Home, Bookmarks (collections before artefacts),
// the Collections tree with (S47) the trees shared with you below it, and an
// Archive footer with a count.
// r[impl hosting.home.sidebar-shared]
export function Sidebar({
  view,
  collections,
  sharedCollections,
  activeCollectionId,
  expanded,
  bookmarkedArtefacts,
  bookmarkedCollections,
  archivedCount,
  onHome,
  onOpenCollection,
  onOpenArchive,
  onNewCollection,
  onToggleExpand,
  onOpenArtefact,
  onRemoveBookmark,
}: {
  view: View;
  collections: CollectionSummary[]; // active only
  // S47 — every node of the trees shared with you (S28), listed from their roots.
  sharedCollections: SharedCollectionSummary[];
  activeCollectionId: string | null;
  expanded: Record<string, boolean>;
  bookmarkedArtefacts: ArtefactSummary[];
  bookmarkedCollections: CollectionSummary[];
  archivedCount: number;
  onHome: () => void;
  onOpenCollection: (id: string) => void;
  onOpenArchive: () => void;
  onNewCollection: () => void;
  onToggleExpand: (id: string) => void;
  onOpenArtefact: (a: ArtefactSummary) => void;
  onRemoveBookmark: (kind: "artefact" | "collection", id: string) => void;
}) {
  const tree = flattenTree(collections, expanded);
  const sharedTree = flattenTree(sharedCollections, expanded);
  const ownerOf = new Map(sharedCollections.map((c) => [c.id, c.owner.name || c.owner.email]));
  const bookmarkedIds = new Set(bookmarkedCollections.map((c) => c.id));
  const hasBookmarks = bookmarkedArtefacts.length > 0 || bookmarkedCollections.length > 0;

  // One tree row: toggle, folder and name; a shared root adds its owner as a hint.
  const treeRow = (node: TreeNode, owner?: string) => (
    <div key={node.c.id} className={cn("flex items-center", indent(node.depth))}>
      <TreeToggle
        hasChildren={node.hasChildren}
        expanded={!!expanded[node.c.id]}
        onToggle={() => onToggleExpand(node.c.id)}
      />
      <NavRow
        tone="sidebar"
        active={view === "collection" && activeCollectionId === node.c.id}
        onClick={() => onOpenCollection(node.c.id)}
        title={owner ? `${node.c.name} · shared by ${owner}` : node.c.name}
      >
        <Folder style={hueVars(node.c.id)} className="size-3.5 shrink-0 text-(--hue)" />
        <span className="min-w-0 flex-1 truncate">{node.c.name}</span>
        {owner && <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{owner}</span>}
        {bookmarkedIds.has(node.c.id) && <Bookmark className="size-3 shrink-0 fill-current" />}
      </NavRow>
    </div>
  );

  return (
    <aside className="sticky top-0 flex h-screen w-66 shrink-0 flex-col overflow-y-auto border-r bg-sidebar text-sidebar-foreground">
      <div className="flex flex-1 flex-col gap-5 px-2.5 py-3.5">
        <div>
          <NavRow tone="sidebar" active={view === "dashboard"} onClick={onHome}>
            <Home className="size-4" />
            Home
          </NavRow>
        </div>

        {hasBookmarks && (
          <div>
            <div className="px-2 pb-1.5">
              <SectionLabel>Bookmarks</SectionLabel>
            </div>
            {bookmarkedCollections.map((c) => (
              <div key={c.id} className="flex items-center">
                <NavRow
                  tone="sidebar"
                  active={view === "collection" && activeCollectionId === c.id}
                  onClick={() => onOpenCollection(c.id)}
                  title={c.name}
                >
                  <Folder style={hueVars(c.id)} className="size-3.5 shrink-0 text-(--hue)" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </NavRow>
                <RemoveBookmark name={c.name} onClick={() => onRemoveBookmark("collection", c.id)} />
              </div>
            ))}
            {bookmarkedArtefacts.map((a) => {
              const m = kindMeta(a.kind);
              const Icon = m.icon;
              return (
                <div key={a.id} className="flex items-center">
                  <NavRow tone="sidebar" onClick={() => onOpenArtefact(a)} title={a.title}>
                    <Icon style={kindVars(a.kind)} className="size-3.5 shrink-0 text-(--kind)" />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  </NavRow>
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
            tree.map((node) => treeRow(node))
          )}
          {/* S47 — the trees shared with you, below your own: collections, not a nav destination. */}
          {sharedTree.length > 0 && (
            <div role="group" aria-label="Shared with me" className="mt-3">
              <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Shared with me</div>
              {sharedTree.map((node) => treeRow(node, node.depth === 0 ? ownerOf.get(node.c.id) : undefined))}
            </div>
          )}
        </div>
      </div>

      {archivedCount > 0 && (
        <div className="border-t p-2.5">
          <NavRow tone="sidebar" active={view === "archive"} onClick={onOpenArchive}>
            <Archive className="size-4" />
            <span className="flex-1">Archive</span>
            <Badge variant="secondary">{archivedCount}</Badge>
          </NavRow>
        </div>
      )}
    </aside>
  );
}
