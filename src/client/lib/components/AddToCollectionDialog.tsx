import { useMemo, useState } from "react";
import { Check, Folder, Home, Plus, X } from "lucide-react";
import type { ArtefactSummary, CollectionSummary } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { hueVars } from "../style";
import { flattenTree } from "../tree";
import { cn } from "../utils";
import { indent, TreeToggle } from "./TreeToggle";

const rowClass = (active: boolean) =>
  cn(
    "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active && "bg-accent font-semibold",
  );

// S25 — the add/move-to-collection picker: a nested single-select tree with a
// "Top level (no collection)" option and an inline "New collection" that
// creates under the selected target without leaving the dialog.
export function AddToCollectionDialog({
  artefact,
  collections,
  viewerId,
  busy = false,
  onClose,
  onConfirm,
  onCreate,
}: {
  artefact: ArtefactSummary;
  // Active targets: the viewer's own collections plus contributable shared
  // trees (S29/CL12) — mixed in one forest, distinguished by ownerId.
  collections: CollectionSummary[];
  // The signed-in user — gates the inline "New collection" (own targets only:
  // creating nodes inside someone else's tree is owner-only, CL9).
  viewerId: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (targetId: string | null) => void;
  // Creates a collection (name, parent) and returns it so the picker can select
  // it. The caller owns the collections list refresh.
  onCreate: (name: string, parentId: string | null) => Promise<CollectionSummary>;
}) {
  const byId = useMemo(() => new Map(collections.map((c) => [c.id, c])), [collections]);
  // Preselect the artefact's current collection and expand its ancestors.
  const [target, setTarget] = useState<string | null>(artefact.collectionId);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const open: Record<string, boolean> = {};
    let node = artefact.collectionId ? byId.get(artefact.collectionId) : undefined;
    while (node) {
      open[node.id] = true;
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return open;
  });
  const [inlineOpen, setInlineOpen] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const tree = flattenTree(collections, expanded);
  const targetName = target ? (byId.get(target)?.name ?? "") : null;
  const unchanged = target === artefact.collectionId;
  // Inline create works at top level or under the viewer's own nodes (CL9).
  const canCreateHere = target === null || byId.get(target)?.ownerId === viewerId;
  const inlineHint = target === null ? "at top level" : `in ${targetName}`;

  async function createInline() {
    const name = inlineName.trim();
    // Enter still reaches here while a create is in flight; the button can't.
    if (!name || inlineBusy) return;
    setInlineBusy(true);
    setInlineError(null);
    try {
      const created = await onCreate(name, target);
      if (target) setExpanded((e) => ({ ...e, [target]: true }));
      setTarget(created.id);
      setInlineOpen(false);
      setInlineName("");
    } catch {
      setInlineError("Could not create the collection.");
    } finally {
      setInlineBusy(false);
    }
  }

  function cancelInline() {
    setInlineOpen(false);
    setInlineName("");
    setInlineError(null);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{artefact.collectionId ? "Move to collection" : "Add to collection"}</DialogTitle>
          <DialogDescription className="truncate">“{artefact.title}”</DialogDescription>
        </DialogHeader>

        <div className="-mx-2 overflow-y-auto px-2">
          <div className="flex items-center">
            <span className="w-5 shrink-0" />
            <button type="button" onClick={() => setTarget(null)} className={rowClass(target === null)}>
              <Home className="size-3.5 shrink-0" />
              <span className="flex-1">Top level (no collection)</span>
              {target === null && <Check className="size-3.5 shrink-0" />}
            </button>
          </div>

          {tree.map((node) => {
            const active = target === node.c.id;
            return (
              <div key={node.c.id} className={cn("flex items-center", indent(node.depth))}>
                <TreeToggle
                  hasChildren={node.hasChildren}
                  expanded={!!expanded[node.c.id]}
                  onToggle={() => setExpanded((e) => ({ ...e, [node.c.id]: !e[node.c.id] }))}
                />
                <button type="button" onClick={() => setTarget(node.c.id)} className={rowClass(active)}>
                  <Folder style={hueVars(node.c.id)} className="size-3.5 shrink-0 text-(--hue)" />
                  <span className="min-w-0 flex-1 truncate">{node.c.name}</span>
                  {node.c.ownerId !== viewerId && (
                    <Badge variant="secondary" className="uppercase">
                      Shared
                    </Badge>
                  )}
                  {active && <Check className="size-3.5 shrink-0" />}
                </button>
              </div>
            );
          })}

          {/* Inline new collection (own targets only, CL9). */}
          {canCreateHere && (
            <div className="mt-2.5 pl-5">
              {inlineOpen ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={inlineName}
                      onChange={(e) => setInlineName(e.target.value)}
                      placeholder={`Name ${inlineHint}`}
                      onKeyDown={(e) => e.key === "Enter" && createInline()}
                      className="h-8"
                      autoFocus
                    />
                    <Button size="sm" onClick={createInline} disabled={inlineBusy || !inlineName.trim()}>
                      Create
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={cancelInline} aria-label="Cancel">
                      <X />
                    </Button>
                  </div>
                  {inlineError && <div className="mt-1 text-xs text-destructive">{inlineError}</div>}
                </>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start border-dashed text-muted-foreground"
                  onClick={() => setInlineOpen(true)}
                >
                  <Plus />
                  New collection <span className="opacity-75">{inlineHint}</span>
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => !unchanged && onConfirm(target)} disabled={busy || unchanged}>
            {target === null ? "Move to top level" : `Add to ${targetName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
