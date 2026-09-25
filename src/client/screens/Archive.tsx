import type { ReactNode } from "react";
import { Folder, RotateCcw, Trash2 } from "lucide-react";
import type { ArtefactSummary, CollectionSummary } from "../../shared/contracts";
import { Button } from "$lib/components/ui/button";
import { Card } from "$lib/components/ui/card";
import { ScreenHeader, ScreenTitle, SectionLabel } from "$lib/components/Browse";
import { count, kindMeta, VIS } from "$lib/format";
import { hueVars, kindVars } from "$lib/style";

export type PendingDelete =
  | { kind: "artefact"; a: ArtefactSummary }
  | { kind: "collection"; c: CollectionSummary; artefacts: number; collections: number };

function ArchivedRow({
  icon,
  title,
  meta,
  onRestore,
  onDelete,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex-row items-center gap-3 px-3.5 py-2.5 shadow-none">
      <div className="flex size-7.5 shrink-0 items-center justify-center rounded-md bg-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground/80">{meta}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onRestore}>
        <RotateCcw />
        Restore
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8 text-destructive"
        onClick={onDelete}
        title="Delete permanently"
        aria-label="Delete permanently"
      >
        <Trash2 />
      </Button>
    </Card>
  );
}

// The Archive (S26): the top of each archived subtree (its descendants restore
// and delete with it) and the individually-archived artefacts.
export function Archive({
  archived,
  archivedCollections,
  onRestore,
  onRestoreCollection,
  onDelete,
}: {
  archived: ArtefactSummary[];
  archivedCollections: CollectionSummary[];
  onRestore: (id: string) => void;
  onRestoreCollection: (c: CollectionSummary) => void;
  onDelete: (p: PendingDelete) => void;
}) {
  const archivedIds = new Set(archivedCollections.map((c) => c.id));
  const tops = archivedCollections
    .filter((c) => c.parentId === null || !archivedIds.has(c.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Individually-archived artefacts whose collection is not itself archived.
  const loose = archived.filter((a) => !a.collectionId || !archivedIds.has(a.collectionId));

  // Every collection id in an archived node's subtree, and what it takes along.
  function cascade(c: CollectionSummary) {
    const ids = new Set([c.id]);
    const queue = [c.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const x of archivedCollections)
        if (x.parentId === cur && !ids.has(x.id)) {
          ids.add(x.id);
          queue.push(x.id);
        }
    }
    return { arts: archived.filter((a) => a.collectionId && ids.has(a.collectionId)).length, colls: ids.size - 1 };
  }

  return (
    <>
      <ScreenHeader>
        <ScreenTitle
          title="Archive"
          sub="Restore items, or delete them permanently. Deleting a collection also deletes everything inside it."
        />
      </ScreenHeader>

      {tops.length + loose.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-dashed px-6 py-16 text-center">
          <div className="text-base font-semibold">Archive is empty</div>
          <div className="text-sm text-muted-foreground">Archived collections and artefacts show up here.</div>
        </div>
      ) : (
        <>
          {tops.length > 0 && (
            <div className="mb-6">
              <SectionLabel>Collections</SectionLabel>
              <div className="flex flex-col gap-2">
                {tops.map((c) => {
                  const n = cascade(c);
                  return (
                    <ArchivedRow
                      key={c.id}
                      icon={<Folder style={hueVars(c.id)} className="size-4 text-(--hue)" />}
                      title={c.name}
                      meta={`${count(n.arts, "artefact")}${n.colls > 0 ? ` · ${count(n.colls, "sub-collection")}` : ""} · ${VIS[c.visibility].label}`}
                      onRestore={() => onRestoreCollection(c)}
                      onDelete={() => onDelete({ kind: "collection", c, artefacts: n.arts, collections: n.colls })}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {loose.length > 0 && (
            <div>
              <SectionLabel>Artefacts</SectionLabel>
              <div className="flex flex-col gap-2">
                {loose.map((a) => {
                  const m = kindMeta(a.kind);
                  const Icon = m.icon;
                  return (
                    <ArchivedRow
                      key={a.id}
                      icon={<Icon style={kindVars(a.kind)} className="size-4 text-(--kind)" />}
                      title={a.title}
                      meta={m.label}
                      onRestore={() => onRestore(a.id)}
                      onDelete={() => onDelete({ kind: "artefact", a })}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
