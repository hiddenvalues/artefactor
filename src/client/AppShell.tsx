import { useEffect, useMemo, useState } from "react";
import { Archive as ArchiveIcon, Check, CircleAlert, Database, RotateCcw, Trash2 } from "lucide-react";
import type {
  ArtefactSummary,
  CollectionSummary,
  SetLinkGateRequest,
  SharedArtefactSummary,
} from "../shared/contracts";
import type { ArtefactKind } from "../domain/artefact/kind";
import { api, ApiError, ownOpenUrl, shareUrl } from "$lib/api";
import { signOut } from "$lib/auth";
import { DENSITIES, SORTS, type AccessFilter, type Filters, type KindFilter } from "$lib/browse";
import { AddToCollectionDialog } from "$lib/components/AddToCollectionDialog";
import type { OwnedItemProps } from "$lib/components/ArtefactCard";
import { CollectionEditorDialog } from "$lib/components/CollectionEditorDialog";
import { ConfirmDialog } from "$lib/components/ConfirmDialog";
import type { GalleryItemProps } from "$lib/components/GalleryCard";
import { ManageAccessDialog, type AccessTarget } from "$lib/components/ManageAccessDialog";
import { Sidebar } from "$lib/components/Sidebar";
import { TopBar } from "$lib/components/TopBar";
import { UploadDialog } from "$lib/components/UploadDialog";
import { count, DATA_VIS, KIND_ORDER, VIS, VIS_ORDER, type DataVisibility, type Visibility } from "$lib/format";
import { persist, restore, usePref } from "$lib/prefs";
import { notify } from "$lib/toast";
import { useLibrary } from "$lib/use-library";
import type { View } from "$lib/view";
import { Archive, type PendingDelete } from "./screens/Archive";
import { CollectionPage } from "./screens/CollectionPage";
import { Dashboard } from "./screens/Dashboard";
import { SharedGallery } from "./screens/SharedGallery";

/** What every listing screen shares: the filters, density and item props. */
export interface ListingProps {
  filters: Filters;
  onKind: (k: KindFilter) => void;
  onAccess: (a: AccessFilter) => void;
  onSort: (s: Filters["sort"]) => void;
  density: (typeof DENSITIES)[number];
  onDensity: (d: (typeof DENSITIES)[number]) => void;
  ownedProps: (a: ArtefactSummary) => OwnedItemProps;
  galleryProps: (g: SharedArtefactSummary, onEject?: () => void) => GalleryItemProps;
}

// The signed-in app: TopBar + Sidebar + the current screen, and the dialogs
// every screen can open. Views are in-memory state (no URL router).
export function AppShell({ user }: { user: { id: string; name: string; email: string } }) {
  const lib = useLibrary(true);
  const { owned, shared, collections, sharedCollections, collectionById } = lib;
  const myId = user.id;

  // ---- view / control state (all but the query and the collection persist) ----
  const [view, setView] = useState<View>(() => restore("view", ["dashboard", "gallery"], "dashboard"));
  useEffect(() => {
    // Only the two tabs are restored across reloads — a collection/archive view
    // isn't (its target id wouldn't be).
    if (view === "dashboard" || view === "gallery") persist("view", view);
  }, [view]);
  const [density, setDensity] = usePref("density", DENSITIES, "grid");
  const [kind, setKind] = usePref<KindFilter>("kind", ["all", ...KIND_ORDER], "all");
  const [access, setAccess] = usePref<AccessFilter>("access", ["all", ...VIS_ORDER], "all");
  const [sort, setSort] = usePref("sort", SORTS, "updated");
  // S25 — the collections/bookmarks sidebar. Closed by default; remembered.
  const [sidebar, setSidebar] = usePref("sidebar", ["open", "closed"] as const, "closed");
  const [query, setQuery] = useState("");
  const [currentCollectionId, setCurrentCollectionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ---- dialogs ----
  const [upload, setUpload] = useState<{ editing: ArtefactSummary | null } | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [managing, setManaging] = useState<AccessTarget | null>(null);
  const [movingArtefact, setMovingArtefact] = useState<ArtefactSummary | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [editor, setEditor] = useState<{ editing: CollectionSummary | null; parent: CollectionSummary | null } | null>(
    null,
  );
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const currentCollection = currentCollectionId ? (collectionById.get(currentCollectionId) ?? null) : null;
  const isOwnCollection = currentCollection?.ownerId === myId;
  // The S28 node for a shared page (carries canContribute + owner identity).
  const currentShared = currentCollectionId
    ? (sharedCollections.find((c) => c.id === currentCollectionId) ?? null)
    : null;

  // Individually-archived artefacts plus archived subtree tops, for the badge.
  const archivedCount = useMemo(() => {
    const archivedIds = new Set(lib.archivedCollections.map((c) => c.id));
    const tops = lib.archivedCollections.filter((c) => c.parentId === null || !archivedIds.has(c.parentId)).length;
    const loose = lib.archived.filter((a) => !a.collectionId || !archivedIds.has(a.collectionId)).length;
    return tops + loose;
  }, [lib.archived, lib.archivedCollections]);

  // ---- navigation ----
  function go(next: View, collectionId: string | null = null) {
    setView(next);
    setCurrentCollectionId(collectionId);
    setKind("all");
    setAccess("all");
    setQuery("");
  }
  const goDashboard = () => go("dashboard");
  const goGallery = () => go("gallery");
  const openArchive = () => go("archive");
  function openCollection(id: string) {
    go("collection", id);
    // Auto-expand the ancestors + the node so the sidebar shows where you are.
    const open = { ...expanded, [id]: true };
    let node = collectionById.get(id);
    while (node?.parentId) {
      open[node.parentId] = true;
      node = collectionById.get(node.parentId);
    }
    setExpanded(open);
  }

  // ---- artefact actions ----
  const openItem = (a: ArtefactSummary) => window.open(ownOpenUrl(a), "_blank", "noopener");
  // A bookmarked artefact may be someone else's (BM2) — those open via their
  // slug link; the owner-preview path is owner-only.
  const openBookmarked = (a: ArtefactSummary) =>
    window.open(a.ownerId === myId ? ownOpenUrl(a) : `/a/${a.publicSlug}`, "_blank", "noopener");
  const openShared = (g: SharedArtefactSummary) => window.open(`/a/${g.publicSlug}`, "_blank", "noopener");

  async function copyLink(a: ArtefactSummary) {
    const url = shareUrl(a);
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      /* clipboard may be unavailable */
    }
    notify(`Link copied · ${url.replace(/^https?:\/\//, "")}`, Check);
  }

  const fail = (e: unknown, fallback: string) => notify(e instanceof ApiError ? e.message : fallback, CircleAlert);

  async function changeVisibility(a: ArtefactSummary, v: Visibility, linkGate?: { password?: string; expiresAt?: string }) {
    try {
      await api.setVisibility(a.id, v, linkGate);
      await Promise.all([lib.loadOwned(), lib.loadShared()]);
      notify(`Visibility set to ${VIS[v].label}`, VIS[v].icon);
      // Switching to "Specific people" jumps straight into the member picker.
      if (v === "selected") setManaging({ kind: "artefact", id: a.id, title: a.title });
    } catch (e) {
      fail(e, "Could not update visibility");
    }
  }

  // S32a — change the link protection of a public artefact (AH31). Clearing
  // both halves is a DELETE; anything else a PUT of just what changed.
  async function changeLinkGate(a: ArtefactSummary, change: SetLinkGateRequest) {
    const clearsAll =
      (change.password === null || (change.password === undefined && !a.linkGate?.passwordProtected)) &&
      (change.expiresAt === null || (change.expiresAt === undefined && !a.linkGate?.expiresAt));
    try {
      if (clearsAll) await api.clearLinkGate(a.id);
      else if (Object.keys(change).length) await api.setLinkGate(a.id, change);
      else return;
      await lib.loadOwned();
      notify(clearsAll ? "Link protection removed" : "Link protection saved", Check);
    } catch (e) {
      fail(e, "Could not update link protection");
    }
  }

  // S41 — whether viewers may load each other's saved data (AH30).
  async function changeDataVisibility(a: ArtefactSummary, v: DataVisibility) {
    try {
      await api.setDataVisibility(a.id, v);
      await lib.loadOwned();
      notify(`Saved data: ${DATA_VIS[v].label}`, Database);
    } catch (e) {
      fail(e, "Could not update saved-data visibility");
    }
  }

  // Closing the panel reloads so any access-driven `updatedAt` reorder shows.
  function closeManaging() {
    setManaging(null);
    void lib.loadOwned();
    void lib.loadShared();
    void lib.loadCollections();
  }

  async function restoreItem(id: string) {
    try {
      await api.restore(id);
      await Promise.all([lib.loadOwned(), lib.loadShared(), lib.loadArchived()]);
      notify("Restored", RotateCcw);
    } catch (e) {
      fail(e, "Could not restore");
    }
  }

  async function archiveItem(a: ArtefactSummary) {
    try {
      await api.archive(a.id);
      await Promise.all([lib.loadOwned(), lib.loadShared(), lib.loadArchived()]);
      notify(`“${a.title}” archived`, ArchiveIcon, { label: "Undo", onClick: () => void restoreItem(a.id) });
    } catch (e) {
      fail(e, "Could not archive");
    }
  }

  // ---- bookmarks (S27) ----
  async function setBookmark(kindOf: "artefact" | "collection", id: string, on: boolean) {
    try {
      await (kindOf === "artefact" ? api.setArtefactBookmark(id, on) : api.setCollectionBookmark(id, on));
      await lib.loadBookmarks();
    } catch {
      notify("Could not update the bookmark", CircleAlert);
    }
  }

  // ---- eject (S29, CL13) ----
  async function ejectFromCurrent(g: SharedArtefactSummary) {
    if (!currentCollectionId) return;
    try {
      await api.ejectArtefact(currentCollectionId, g.id);
      await Promise.all([lib.loadShared(), lib.loadOwned()]);
      notify(`“${g.title}” removed from the collection`, Check);
    } catch (e) {
      fail(e, "Could not remove it");
    }
  }

  // ---- collections (S25/S26) ----
  function openEditor(editing: CollectionSummary | null, parent: CollectionSummary | null) {
    setEditorError(null);
    setEditor({ editing, parent });
  }

  async function submitEditor(input: { name: string; visibility?: Visibility }) {
    if (!editor) return;
    setEditorBusy(true);
    setEditorError(null);
    try {
      if (editor.editing) {
        const updated = await api.editCollection(editor.editing.id, input);
        notify("Collection updated", Check);
        setEditor(null);
        await Promise.all([lib.loadCollections(), lib.loadOwned(), lib.loadShared()]);
        if (input.visibility === "selected") setManaging({ kind: "collection", id: updated.id, title: updated.name });
      } else {
        const parent = editor.parent;
        const created = await api.createCollection({
          name: input.name,
          parentId: parent?.id ?? null,
          visibility: input.visibility,
        });
        notify(`Collection “${created.name}” created`, Check);
        setEditor(null);
        setSidebar("open");
        if (parent) setExpanded((e) => ({ ...e, [parent.id]: true }));
        await lib.loadCollections();
        if (input.visibility === "selected") setManaging({ kind: "collection", id: created.id, title: created.name });
      }
    } catch (e) {
      setEditorError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setEditorBusy(false);
    }
  }

  async function changeCollectionVisibility(c: CollectionSummary, v: Visibility) {
    try {
      await api.editCollection(c.id, { visibility: v });
      await Promise.all([lib.loadCollections(), lib.loadOwned(), lib.loadShared()]);
      notify(`Collection access set to ${VIS[v].label} — artefacts inside follow`, VIS[v].icon);
      if (v === "selected") setManaging({ kind: "collection", id: c.id, title: c.name });
    } catch (e) {
      fail(e, "Could not update access");
    }
  }

  async function restoreCollection(c: CollectionSummary) {
    try {
      await api.restoreCollection(c.id);
      await lib.refreshAll();
      notify(`“${c.name}” restored`, RotateCcw);
    } catch (e) {
      fail(e, "Could not restore");
    }
  }

  async function archiveCollection(c: CollectionSummary) {
    try {
      const { cascade } = await api.archiveCollection(c.id);
      // Navigating from inside the archived subtree would strand the view.
      if (view === "collection") goDashboard();
      await lib.refreshAll();
      const suffix = cascade.artefacts > 0 ? ` with ${count(cascade.artefacts, "artefact")}` : "";
      const evicted =
        cascade.evicted > 0
          ? ` · ${cascade.evicted} returned to their owner${cascade.evicted === 1 ? "" : "s"}`
          : "";
      notify(`“${c.name}” archived${suffix}${evicted}`, ArchiveIcon, {
        label: "Undo",
        onClick: () => void restoreCollection(c),
      });
    } catch (e) {
      fail(e, "Could not archive");
    }
  }

  // ---- move to collection (S25) ----
  async function confirmMove(targetId: string | null) {
    if (!movingArtefact) return;
    const title = movingArtefact.title;
    setMoveBusy(true);
    try {
      const moved = await api.moveToCollection(movingArtefact.id, targetId);
      setMovingArtefact(null);
      await Promise.all([lib.loadOwned(), lib.loadShared(), lib.loadBookmarks()]);
      if (targetId) {
        const target = collectionById.get(targetId);
        notify(
          `“${title}” added to ${target?.name ?? "collection"} — now inherits ${VIS[moved.effectiveVisibility].label} access`,
          Check,
        );
      } else notify("Moved to top level", Check);
    } catch (e) {
      setMovingArtefact(null);
      fail(e, "Could not move the artefact");
    } finally {
      setMoveBusy(false);
    }
  }

  async function createFromPicker(name: string, parentId: string | null) {
    const created = await api.createCollection({ name, parentId });
    await lib.loadCollections();
    return created;
  }

  // ---- permanent delete (S15/S26) ----
  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      if (pendingDelete.kind === "artefact") {
        await api.delete(pendingDelete.a.id);
        notify(`“${pendingDelete.a.title}” deleted`, Trash2);
      } else {
        await api.deleteCollection(pendingDelete.c.id);
        notify(`“${pendingDelete.c.name}” deleted`, Trash2);
      }
      setPendingDelete(null);
      await lib.refreshAll();
    } catch (e) {
      setPendingDelete(null);
      fail(e, "Could not delete");
    } finally {
      setDeleteBusy(false);
    }
  }

  // ---- upload / edit ----
  function openUpload(editing: ArtefactSummary | null = null) {
    setUploadError(null);
    setUpload({ editing });
  }

  // S35 — a new upload or HTML replace renders its thumbnail in the background.
  // Watch that one artefact briefly (every 2 s, up to ~30 s) and swap the new
  // preview into its card without a reload. `previous` is the URL the card had,
  // so a replace waits for the new render rather than the one it replaces.
  function watchThumbnail(id: string, previous: string | null) {
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const latest = await api.getOwn(id);
        if (latest.thumbnailUrl !== null && latest.thumbnailUrl !== previous) {
          lib.setOwned((list) => list.map((x) => (x.id === id ? { ...x, thumbnailUrl: latest.thumbnailUrl } : x)));
          return;
        }
      } catch {
        return; // gone or no longer ours — the card's own state stands
      }
      if (attempts < 15) setTimeout(check, 2000);
    };
    setTimeout(check, 2000);
  }

  async function submitUpload(input: { title: string; kind: ArtefactKind; file: File | null }) {
    const editing = upload?.editing ?? null;
    setUploadBusy(true);
    setUploadError(null);
    try {
      if (editing) {
        const updated = await api.update(editing.id, input);
        notify("Changes saved", Check);
        if (input.file) watchThumbnail(updated.id, updated.thumbnailUrl);
      } else {
        const created = await api.create({ title: input.title, kind: input.kind, file: input.file! });
        watchThumbnail(created.id, created.thumbnailUrl);
        // Uploading from a collection page you own or contribute to (CL12)
        // places the new artefact there: create-in = create + move-in, so the
        // usual invariants and the CL6 slug mint apply unchanged.
        const into =
          view === "collection" &&
          currentCollection !== null &&
          currentCollection.status === "active" &&
          (isOwnCollection || currentShared?.canContribute === true)
            ? currentCollection
            : null;
        if (into) {
          const moved = await api.moveToCollection(created.id, into.id);
          notify(
            `“${created.title}” uploaded to ${into.name} — inherits ${VIS[moved.effectiveVisibility].label} access`,
            Check,
          );
        } else {
          notify(`“${created.title}” uploaded`, Check);
          goDashboard();
        }
      }
      setUpload(null);
      await Promise.all([lib.loadOwned(), lib.loadShared(), lib.loadArchived()]);
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setUploadBusy(false);
    }
  }

  async function doSignOut() {
    // signOut() clears the session cookie server-side; a full reload re-resolves
    // the (now absent) session and clears all state.
    await signOut();
    window.location.href = "/";
  }

  // ---- per-item props, shared by every listing screen ----
  const isColl = view === "collection";
  const collectionNameOf = (id: string | null) => (id ? (collectionById.get(id)?.name ?? "") : "");
  const ownedProps = (a: ArtefactSummary): OwnedItemProps => ({
    a,
    onOpen: () => openItem(a),
    onCopy: () => void copyLink(a),
    onEdit: () => openUpload(a),
    onArchive: () => void archiveItem(a),
    onVisibility: (v, gate) => void changeVisibility(a, v, gate),
    onLinkGate: (change) => void changeLinkGate(a, change),
    onDataVisibility: (v) => void changeDataVisibility(a, v),
    onManage: () => setManaging({ kind: "artefact", id: a.id, title: a.title }),
    collectionName: a.collectionId ? collectionNameOf(a.collectionId) : null,
    onOpenCollection: a.collectionId ? () => openCollection(a.collectionId!) : undefined,
    bookmarked: lib.bookmarkedArtefactIds.has(a.id),
    onBookmark: () => void setBookmark("artefact", a.id, !lib.bookmarkedArtefactIds.has(a.id)),
    onMoveToCollection: () => setMovingArtefact(a),
    showCollectionChip: !isColl,
  });
  const galleryProps = (g: SharedArtefactSummary, onEject?: () => void): GalleryItemProps => ({
    g,
    onOpen: () => openShared(g),
    bookmarked: lib.bookmarkedArtefactIds.has(g.id),
    onBookmark: () => void setBookmark("artefact", g.id, !lib.bookmarkedArtefactIds.has(g.id)),
    onEject,
  });
  const listing: ListingProps = {
    filters: { kind, access, sort, query },
    onKind: setKind,
    onAccess: setAccess,
    onSort: setSort,
    density,
    onDensity: setDensity,
    ownedProps,
    galleryProps,
  };

  const searchPlaceholder = isColl
    ? "Search this collection…"
    : view === "gallery"
      ? "Search shared artefacts…"
      : "Search your artefacts…";

  return (
    <div className="flex min-h-screen">
      {sidebar === "open" && (
        <Sidebar
          view={view}
          collections={collections}
          activeCollectionId={currentCollectionId}
          expanded={expanded}
          bookmarkedArtefacts={lib.bookmarkedArtefacts}
          bookmarkedCollections={lib.bookmarkedCollections}
          archivedCount={archivedCount}
          onHome={goDashboard}
          onOpenCollection={openCollection}
          onOpenArchive={openArchive}
          onNewCollection={() => openEditor(null, null)}
          onToggleExpand={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
          onOpenArtefact={openBookmarked}
          onRemoveBookmark={(k, id) => void setBookmark(k, id, false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          view={view}
          query={query}
          searchPlaceholder={searchPlaceholder}
          user={user}
          onSearch={setQuery}
          onGoDashboard={goDashboard}
          onGoGallery={goGallery}
          onOpenUpload={() => openUpload()}
          onSignOut={() => void doSignOut()}
          onToggleSidebar={() => setSidebar(sidebar === "open" ? "closed" : "open")}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-16">
          {view === "archive" ? (
            <Archive
              archived={lib.archived}
              archivedCollections={lib.archivedCollections}
              onRestore={(id) => void restoreItem(id)}
              onRestoreCollection={(c) => void restoreCollection(c)}
              onDelete={setPendingDelete}
            />
          ) : view === "collection" && currentCollection ? (
            <CollectionPage
              {...listing}
              collection={currentCollection}
              isOwn={isOwnCollection}
              shared={currentShared}
              owned={owned}
              others={shared}
              collectionById={collectionById}
              pool={isOwnCollection ? collections : sharedCollections}
              bookmarked={lib.bookmarkedCollectionIds.has(currentCollection.id)}
              onToggleBookmark={() =>
                void setBookmark("collection", currentCollection.id, !lib.bookmarkedCollectionIds.has(currentCollection.id))
              }
              onOpenCollection={openCollection}
              onGoDashboard={goDashboard}
              onGoGallery={goGallery}
              onChangeVisibility={(v) => void changeCollectionVisibility(currentCollection, v)}
              onManage={() => setManaging({ kind: "collection", id: currentCollection.id, title: currentCollection.name })}
              onEdit={() => openEditor(currentCollection, null)}
              onNewSub={() => openEditor(null, currentCollection)}
              onArchive={() => void archiveCollection(currentCollection)}
              onEject={(g) => void ejectFromCurrent(g)}
            />
          ) : view === "gallery" ? (
            <SharedGallery
              {...listing}
              shared={shared}
              sharedCollections={sharedCollections}
              owned={owned}
              onOpenCollection={openCollection}
            />
          ) : (
            <Dashboard {...listing} owned={owned} onUpload={() => openUpload()} />
          )}
        </main>
      </div>

      {upload && (
        <UploadDialog
          editing={upload.editing}
          busy={uploadBusy}
          serverError={uploadError}
          onClose={() => setUpload(null)}
          onSubmit={(input) => void submitUpload(input)}
        />
      )}
      {managing && <ManageAccessDialog target={managing} onClose={closeManaging} />}
      {movingArtefact && (
        <AddToCollectionDialog
          artefact={movingArtefact}
          collections={[...collections, ...sharedCollections.filter((c) => c.canContribute)]}
          viewerId={myId}
          busy={moveBusy}
          onClose={() => setMovingArtefact(null)}
          onConfirm={(id) => void confirmMove(id)}
          onCreate={createFromPicker}
        />
      )}
      {editor && (
        <CollectionEditorDialog
          editing={editor.editing}
          parent={editor.parent}
          busy={editorBusy}
          serverError={editorError}
          onClose={() => setEditor(null)}
          onSubmit={(input) => void submitEditor(input)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          {...deleteCopy(pendingDelete)}
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function deleteCopy(p: PendingDelete): { title: string; message: string; confirmLabel: string } {
  if (p.kind === "artefact")
    return {
      title: `Delete “${p.a.title}” permanently?`,
      message: "This artefact and all its saved data will be permanently deleted. This can’t be undone.",
      confirmLabel: "Delete artefact",
    };
  const cascade =
    p.artefacts > 0 || p.collections > 0
      ? ` ${count(p.artefacts, "artefact")}${p.collections > 0 ? ` and ${count(p.collections, "sub-collection")}` : ""} will be deleted with it.`
      : "";
  return {
    title: `Delete “${p.c.name}” permanently?`,
    message: `Everything inside this collection will be permanently deleted too.${cascade} This can’t be undone.`,
    confirmLabel: "Delete collection",
  };
}
