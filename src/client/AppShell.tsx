import { useEffect, useMemo, useRef, useState } from "react";
import { Archive as ArchiveIcon, Bookmark, Check, CircleAlert, Database, RotateCcw, Trash2 } from "lucide-react";
import type {
  ArtefactSummary,
  CollectionSummary,
  MeResponse,
  SetLinkGateRequest,
  SharedArtefactSummary,
} from "../shared/contracts";
import type { ArtefactKind } from "../domain/artefact/kind";
import { api, ApiError, ownOpenUrl, shareUrl } from "$lib/api";
import { signOut } from "$lib/auth";
import { DENSITIES, SORTS, type AccessFilter, type Filters, type KindFilter } from "$lib/browse";
import { AddToCollectionDialog } from "$lib/components/AddToCollectionDialog";
import { AppShell as AppFrame } from "$lib/components/AppShell";
import { ArtefactAccessDialog } from "$lib/components/ArtefactAccessDialog";
import type { ArtefactItemProps, OwnedItemProps, SharedItemProps } from "$lib/components/ArtefactCard";
import { CollectionEditorDialog } from "$lib/components/CollectionEditorDialog";
import { ConfirmDialog } from "$lib/components/ConfirmDialog";
import { ManageAccessDialog, type AccessTarget } from "$lib/components/ManageAccessDialog";
import { Sidebar } from "$lib/components/Sidebar";
import { TopBar, type TopBarAccount } from "$lib/components/TopBar";
import { UploadDialog } from "$lib/components/UploadDialog";
import { count, DATA_VIS, KIND_ORDER, VIS, VIS_ORDER, type DataVisibility, type Visibility } from "$lib/format";
import { accessRootOf, collectionRowOf } from "$lib/artefact-card";
import { HOME_SCOPES, isShared, type HomeItem, type HomeScope } from "$lib/home";
import { usePref } from "$lib/prefs";
import { copyText, inheritedLinkGate } from "$lib/link-protection";
import { notify } from "$lib/toast";
import { searchLibrary, type Hit } from "$lib/search";
import { useLibrary } from "$lib/use-library";
import { HOME, type Route } from "$lib/route";
import { useRoute } from "$lib/use-route";
import { AccountScreen } from "./screens/AccountScreen";
import { Archive, type PendingDelete } from "./screens/Archive";
import { CollectionPage } from "./screens/CollectionPage";
import type { EditorInput } from "./lib/collection-editor";
import { Home } from "./screens/Home";
import { OrganizationSettings } from "./screens/OrganizationSettings";
import { shareLinkPath } from "../shared/share-link";

/** What every listing screen shares: the filters, density and item props. */
export interface ListingProps {
  filters: Filters;
  onKind: (k: KindFilter) => void;
  onAccess: (a: AccessFilter) => void;
  onSort: (s: Filters["sort"]) => void;
  density: (typeof DENSITIES)[number];
  onDensity: (d: (typeof DENSITIES)[number]) => void;
  ownedProps: (a: ArtefactSummary) => OwnedItemProps;
  sharedProps: (g: SharedArtefactSummary, onRemoveFromCollection?: () => void) => SharedItemProps;
}

// The signed-in app: TopBar + Sidebar + the current screen, and the dialogs
// every screen can open. The current screen lives in the URL (S59, `useRoute`).
export function AppShell({ user }: { user: { id: string; name: string; email: string } }) {
  const lib = useLibrary(true);
  const { owned, shared, collections, sharedCollections, collectionById } = lib;
  const myId = user.id;
  // S53 — `/api/me`, for the org context a superset reports (none in OSS);
  // the session's user stands in until it answers.
  const [me, setMe] = useState<MeResponse | null>(null);
  // S59 — whether `/api/me` has answered, so a reload on `/organization` waits.
  const [meLoaded, setMeLoaded] = useState(false);
  useEffect(() => {
    api
      .me()
      .then(setMe, () => {})
      .finally(() => setMeLoaded(true));
  }, []);

  // ---- control state (all but the screen, query and expanded rows persist) ----
  const [density, setDensity] = usePref("density", DENSITIES, "grid");
  const [kind, setKind] = usePref<KindFilter>("kind", ["all", ...KIND_ORDER], "all");
  const [access, setAccess] = usePref<AccessFilter>("access", ["all", ...VIS_ORDER], "all");
  // S82 — one Sort choice for Home and collection pages.
  // r[impl hosting.browse.one-sort-pref]
  const [sort, setSort] = usePref("sort", SORTS, "updated");
  // S47 — Home's switch.
  const [scope, setScope] = usePref<HomeScope>("scope", HOME_SCOPES, "all");
  // S25 — the collections/bookmarks sidebar. Closed by default; remembered.
  const [sidebar, setSidebar] = usePref("sidebar", ["open", "closed"] as const, "closed");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ---- the screen (S59): its path is the URL's ----
  // S58 — the active org, which Organization settings shows; none in OSS.
  const activeOrg = me?.organizations?.memberships.find((m) => m.id === me.organizations?.activeId);
  const openableCollectionIds = useMemo(
    () => new Set([...collections, ...sharedCollections].filter((c) => c.status === "active").map((c) => c.id)),
    [collections, sharedCollections],
  );
  const nav = useRoute(
    {
      collectionIds: openableCollectionIds,
      organizationOffered: activeOrg !== undefined,
      collectionsLoaded: lib.collectionsLoaded,
      meLoaded,
    },
    // A reload keeps the stored filters; Back and Forward reset them as an open does.
    (route, via) => enter(route, via === "pop"),
  );
  const view = nav.route?.view ?? "dashboard";
  const currentCollectionId = nav.route?.view === "collection" ? nav.route.id : null;

  // ---- dialogs ----
  const [upload, setUpload] = useState<{ editing: ArtefactSummary | null } | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [managing, setManaging] = useState<AccessTarget | null>(null);
  // S55 — the top-level artefact whose Manage access dialog is open.
  const [sharing, setSharing] = useState<ArtefactSummary | null>(null);
  // S33b — whether the deployment invites emails with no Account; a failed
  // config call reads as off.
  const [shareInvitations, setShareInvitations] = useState(false);
  useEffect(() => {
    api
      .config()
      .then((c) => setShareInvitations(c.capabilities.shareInvitations === true))
      .catch(() => {});
  }, []);
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
  // Entering a screen: filters and query reset, and a collection page expands
  // its ancestors + itself so the sidebar shows where you are.
  function enter(route: Route, resetFilters = true) {
    if (resetFilters) {
      setKind("all");
      setAccess("all");
      setQuery("");
    }
    if (route.view !== "collection") return;
    const { id } = route;
    setExpanded((prev) => {
      const open = { ...prev, [id]: true };
      let node = collectionById.get(id);
      while (node?.parentId) {
        open[node.parentId] = true;
        node = collectionById.get(node.parentId);
      }
      return open;
    });
  }
  // Each opener pushes one history entry (none when already there).
  function go(route: Route) {
    nav.open(route);
    enter(route);
  }
  const goDashboard = () => go(HOME);
  // A shared collection's breadcrumb returns to Home's Shared with me (S47).
  const goSharedHome = () => {
    go(HOME);
    setScope("shared");
  };
  const openArchive = () => go({ view: "archive" });
  const openAccount = () => go({ view: "account" });
  const openOrganization = () => go({ view: "organization" });
  const openCollection = (id: string) => go({ view: "collection", id });

  // ---- artefact actions ----
  // S47 — every open stamps your view locally, so Home's Recent moves at once;
  // the server records it as the shell is served (views.record.on-shell-serve,
  // views.record.on-owner-preview).
  const openUrl = (id: string, url: string) => {
    lib.markViewed(id);
    window.open(url, "_blank", "noopener");
  };
  const openItem = (a: ArtefactSummary) => openUrl(a.id, ownOpenUrl(a));
  // A bookmarked artefact may be someone else's (collections.bookmark.artefact-view-gated) — those open via their
  // slug link; the owner-preview path is owner-only.
  const openBookmarked = (a: ArtefactSummary) =>
    openUrl(a.id, a.ownerId === myId ? ownOpenUrl(a) : shareLinkPath(a.publicSlug!));
  const openShared = (g: SharedArtefactSummary) => openUrl(g.id, shareLinkPath(g.publicSlug!));

  // S62 — the card's and the row's copy: "Link copied" only once the write has
  // resolved; no clipboard, or a rejected write, says so instead.
  // r[impl hosting.card.copy-failure-says-so]
  async function copyLink(a: ArtefactSummary) {
    const url = shareUrl(a);
    if (!url) return;
    if ((await copyText(navigator.clipboard, url)) === "Copied")
      notify(`Link copied · ${url.replace(/^https?:\/\//, "")}`, Check);
    else notify("Couldn't copy the link", CircleAlert);
  }

  const fail = (e: unknown, fallback: string) => notify(e instanceof ApiError ? e.message : fallback, CircleAlert);

  // S41 — whether viewers may load each other's saved data (hosting.data-visibility.owner-set).
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
  async function setBookmark(kindOf: "artefact" | "collection", id: string, on: boolean): Promise<boolean> {
    try {
      await (kindOf === "artefact" ? api.setArtefactBookmark(id, on) : api.setCollectionBookmark(id, on));
      await lib.loadBookmarks();
      return true;
    } catch {
      notify("Could not update the bookmark", CircleAlert);
      return false;
    }
  }

  // S54 — a card's bookmark button removes the bookmark, and Undo re-adds it.
  async function removeBookmark(id: string) {
    if (await setBookmark("artefact", id, false))
      notify("Bookmark removed", Bookmark, { label: "Undo", onClick: () => void setBookmark("artefact", id, true) });
  }

  // ---- eject (S29, collections.containment.co-owned) ----
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

  async function submitEditor(input: EditorInput) {
    if (!editor) return;
    setEditorBusy(true);
    setEditorError(null);
    try {
      if (editor.editing) {
        const before = editor.editing.visibility;
        const updated = await api.editCollection(editor.editing.id, input);
        notify("Collection updated", Check);
        setEditor(null);
        await Promise.all([lib.loadCollections(), lib.loadOwned(), lib.loadShared()]);
        // Open the access list only on a change to `selected`, not on every save of a selected root.
        if (input.visibility === "selected" && before !== "selected") setManaging({ kind: "collection", id: updated.id, title: updated.name });
      } else {
        const parent = editor.parent;
        const created = await api.createCollection({
          name: input.name,
          description: input.description,
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

  async function changeCollectionVisibility(
    c: CollectionSummary,
    v: Visibility,
    linkGate?: { password?: string; expiresAt?: string },
  ) {
    try {
      await api.editCollection(c.id, linkGate ? { visibility: v, linkGate } : { visibility: v });
      await Promise.all([lib.loadCollections(), lib.loadOwned(), lib.loadShared()]);
      notify(`Collection access set to ${VIS[v].label} — artefacts inside follow`, VIS[v].icon);
      if (v === "selected") setManaging({ kind: "collection", id: c.id, title: c.name });
    } catch (e) {
      fail(e, "Could not update access");
    }
  }

  // S32b — change the link protection of a public collection root, which its
  // whole tree follows. Clearing both halves is a DELETE, as for an artefact.
  async function changeCollectionLinkGate(c: CollectionSummary, change: SetLinkGateRequest) {
    const clearsAll =
      (change.password === null || (change.password === undefined && !c.linkGate?.passwordProtected)) &&
      (change.expiresAt === null || (change.expiresAt === undefined && !c.linkGate?.expiresAt));
    try {
      if (clearsAll) await api.clearCollectionLinkGate(c.id);
      else if (Object.keys(change).length) await api.setCollectionLinkGate(c.id, change);
      else return;
      await lib.loadCollections();
      notify(clearsAll ? "Link protection removed" : "Link protection saved", Check);
    } catch (e) {
      fail(e, "Could not update link protection");
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
      // Navigating from inside the archived subtree would strand the view;
      // replacing its entry keeps Back from returning to it.
      if (view === "collection") {
        nav.leave(HOME);
        enter(HOME);
      }
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
        // Uploading from a collection page you own or contribute to (collections.contributor.on-root-access-list)
        // places the new artefact there: create-in = create + move-in, so the
        // usual invariants and the collections.slug.minted-on-effective-share slug mint apply unchanged.
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

  // S80 — a switch lands on Home: the shell takes the fresh identity, shows
  // Home (the page you were on belonged to the previous org), re-fetches its
  // lists under the new org and moves focus to Home's heading; a failed one
  // moves focus to the account button. The menu leaves focus to the shell, so
  // it goes straight there however long the answer takes, unless the user has
  // moved it on meanwhile.
  // One switch at a time: a pick made while one is pending is ignored, so an
  // older answer can never land after a newer choice.
  const switching = useRef(false);
  const topBar = useRef<TopBarAccount>(null);
  const homeHeading = useRef<HTMLHeadingElement>(null);
  const focusHome = useRef(false);
  const focusIsFree = () => {
    const at = document.activeElement;
    return at === null || at === document.body || (topBar.current?.holds(at) ?? false);
  };
  useEffect(() => {
    if (!focusHome.current || !homeHeading.current) return;
    focusHome.current = false;
    if (focusIsFree()) homeHeading.current.focus();
  });
  // r[impl platform.top-bar.switch-organization+3]
  async function switchOrganization(organizationId: string) {
    if (switching.current) return;
    switching.current = true;
    try {
      const next = await api.switchOrganization(organizationId);
      setMe(next);
      focusHome.current = true;
      goDashboard();
      const org = next.organizations?.memberships.find((m) => m.id === next.organizations?.activeId);
      notify(`Switched to ${org?.name ?? "the organization"}`, Check);
      void lib.refreshAll();
    } catch {
      notify("Couldn’t switch organization", CircleAlert);
      if (focusIsFree()) topBar.current?.focus();
    } finally {
      switching.current = false;
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
  // S64 — the tree root an owned artefact's access follows, for its "Access
  // inherited" popover to name and open.
  const accessRootProp = (a: ArtefactSummary) => {
    const root = accessRootOf(a, collectionById);
    return root && { name: root.name, onOpen: () => openCollection(root.id) };
  };
  const ownedProps = (a: ArtefactSummary): OwnedItemProps => ({
    a,
    onOpen: () => openItem(a),
    onCopy: () => void copyLink(a),
    onEdit: () => openUpload(a),
    onArchive: () => void archiveItem(a),
    onDataVisibility: (v) => void changeDataVisibility(a, v),
    onShare: () => setSharing(a),
    collectionName: a.collectionId ? collectionNameOf(a.collectionId) : null,
    collection: collectionRowOf(a, collectionById),
    inheritedGate: inheritedLinkGate(a.collectionId, collectionById),
    onOpenCollection: a.collectionId ? () => openCollection(a.collectionId!) : undefined,
    accessRoot: accessRootProp(a),
    bookmarked: lib.bookmarkedArtefactIds.has(a.id),
    onBookmark: () => void setBookmark("artefact", a.id, !lib.bookmarkedArtefactIds.has(a.id)),
    onRemoveBookmark: () => void removeBookmark(a.id),
    onMoveToCollection: () => setMovingArtefact(a),
    showCollectionChip: !isColl,
  });
  // S47/S62 — another user's artefact, on Home and on a collection page alike:
  // the same card and row in their viewer variant, with only what a viewer may
  // do, plus the collection owner's eject on their own page (S29).
  const sharedProps = (a: SharedArtefactSummary, onRemoveFromCollection?: () => void): SharedItemProps => ({
    a,
    shared: true,
    onOpen: () => openShared(a),
    onCopy: () => void copyLink(a),
    bookmarked: lib.bookmarkedArtefactIds.has(a.id),
    onBookmark: () => void setBookmark("artefact", a.id, !lib.bookmarkedArtefactIds.has(a.id)),
    onRemoveBookmark: () => void removeBookmark(a.id),
    // S54 — a collection shared with you opens like the Sidebar's "Shared
    // with me" group does; one you can't see isn't named (S28).
    collection: collectionRowOf(a, collectionById),
    onOpenCollection: a.collectionId ? () => openCollection(a.collectionId!) : undefined,
    showCollectionChip: !isColl,
    onRemoveFromCollection,
  });
  const homeItemProps = (a: HomeItem): ArtefactItemProps => (isShared(a) ? sharedProps(a) : ownedProps(a));
  const listing: ListingProps = {
    filters: { kind, access, sort },
    onKind: setKind,
    onAccess: setAccess,
    onSort: setSort,
    density,
    onDensity: setDensity,
    ownedProps,
    sharedProps,
  };

  // S46 — the top bar's search is global: every artefact and collection the
  // shell already lists, whatever the page.
  const results = useMemo(
    () => searchLibrary({ owned, shared, collections, sharedCollections, collectionById }, query),
    [owned, shared, collections, sharedCollections, collectionById, query],
  );
  function openResult(hit: Hit) {
    if (hit.kind === "collection") openCollection(hit.id);
    else if (hit.shared) openShared(hit.shared);
    else openItem(hit.artefact);
    setQuery("");
  }

  return (
    <>
      <AppFrame
        sidebar={
          sidebar === "open" && (
            <Sidebar
              view={view}
              collections={collections}
              sharedCollections={sharedCollections}
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
          )
        }
        topBar={
          <TopBar
            query={query}
            results={results}
            user={me ?? user}
            onSearch={setQuery}
            onOpenResult={openResult}
            onOpenUpload={() => openUpload()}
            onSignOut={() => void doSignOut()}
            onSwitchOrganization={(id) => void switchOrganization(id)}
            onOpenAccount={openAccount}
            onOpenOrganization={openOrganization}
            onToggleSidebar={() => setSidebar(sidebar === "open" ? "closed" : "open")}
            onGoHome={goDashboard}
            accountRef={topBar}
          />
        }
      >
        {nav.route === null ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : view === "account" ? (
          <AccountScreen user={me ?? user} onSaved={setMe} />
        ) : view === "organization" && activeOrg ? (
          <OrganizationSettings
            activeId={activeOrg.id}
            orgName={activeOrg.name}
            youId={myId}
            onRenamed={() => void api.me().then(setMe, () => {})}
          />
        ) : view === "archive" ? (
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
            views={lib.views}
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
            onGoGallery={goSharedHome}
            onChangeVisibility={(v, gate) => void changeCollectionVisibility(currentCollection, v, gate)}
            onLinkGate={(change) => void changeCollectionLinkGate(currentCollection, change)}
            onManage={() => setManaging({ kind: "collection", id: currentCollection.id, title: currentCollection.name })}
            onEdit={() => openEditor(currentCollection, null)}
            onNewSub={() => openEditor(null, currentCollection)}
            onArchive={() => void archiveCollection(currentCollection)}
            onEject={(g) => void ejectFromCurrent(g)}
          />
        ) : (
          <Home
            headingRef={homeHeading}
            owned={owned}
            shared={shared}
            views={lib.views}
            loaded={lib.loaded}
            scope={scope}
            onScope={setScope}
            kind={kind}
            onKind={setKind}
            access={access}
            onAccess={setAccess}
            sort={sort}
            onSort={setSort}
            density={density}
            onDensity={setDensity}
            itemProps={homeItemProps}
            onUpload={() => openUpload()}
          />
        )}
      </AppFrame>

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
      {sharing && (
        <ArtefactAccessDialog
          artefact={sharing}
          shareInvitations={shareInvitations}
          ownerEmail={user.email}
          onClose={() => setSharing(null)}
          onSaved={async () => {
            await Promise.all([lib.loadOwned(), lib.loadShared(), lib.loadCollections()]);
          }}
        />
      )}
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
    </>
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
