<script lang="ts">
  import { signOut, useSession } from "$lib/auth";
  import type {
    ArtefactSummary,
    CollectionSummary,
    SharedArtefactSummary,
  } from "../shared/contracts";
  import type { ArtefactKind } from "../domain/artefact/kind";
  import {
    KINDS,
    KIND_ORDER,
    VIS,
    VIS_ORDER,
    collectionColor,
    kindMeta,
    ARCHIVE_ICON,
    BOOKMARK_ICON,
    FOLDER_ICON,
    type Visibility,
  } from "$lib/format";
  import { api, ApiError, shareUrl, ownOpenUrl } from "$lib/api";
  import { overlay } from "$lib/ui.svelte";
  import { toast, TOAST_ICONS } from "$lib/toast.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ArtefactCard from "$lib/components/ArtefactCard.svelte";
  import ArtefactRow from "$lib/components/ArtefactRow.svelte";
  import GalleryCard from "$lib/components/GalleryCard.svelte";
  import GalleryRow from "$lib/components/GalleryRow.svelte";
  import UploadModal from "$lib/components/UploadModal.svelte";
  import ManageAccessModal from "$lib/components/ManageAccessModal.svelte";
  import AddToCollectionModal from "$lib/components/AddToCollectionModal.svelte";
  import CollectionEditorModal from "$lib/components/CollectionEditorModal.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import VisibilityControl from "$lib/components/VisibilityControl.svelte";
  import MoreMenu from "$lib/components/MoreMenu.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import AuthScreen from "$lib/components/AuthScreen.svelte";

  const SORTS = ["updated", "title", "size"] as const;
  // Funnel glyph for the "All access" (no specific tier) state of the filter.
  const FILTER_ICON = ["M22 3H2l8 9.46V19l4 2v-8.54L22 3"];

  const session = useSession();

  // ---- view / control state ----
  // Remember the dashboard's view controls across reloads — a full refresh
  // otherwise dropped every choice back to its default. Stored in the admin
  // SPA's own localStorage (not an artefact's hijacked store). Each value is
  // validated on read so a stale/unknown stored key falls back to its default.
  const STORE_PREFIX = "artefactor:";
  function restore<T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    try {
      const v = localStorage.getItem(STORE_PREFIX + key);
      return v !== null && (allowed as readonly string[]).includes(v)
        ? (v as T)
        : fallback;
    } catch {
      return fallback;
    }
  }

  // The active view. Only the two tabs are restored across reloads — a
  // collection/archive view isn't (its target id wouldn't be).
  let view = $state<"dashboard" | "gallery" | "collection" | "archive">(
    restore("view", ["dashboard", "gallery"], "dashboard"),
  );
  let density = $state<"grid" | "list">(
    restore("density", ["grid", "list"], "grid"),
  );
  let kindFilter = $state<"all" | ArtefactKind>(
    restore<"all" | ArtefactKind>("kind", ["all", ...KIND_ORDER], "all"),
  );
  // Orthogonal to kindFilter: narrow by visibility/access tier (S16+).
  let accessFilter = $state<"all" | Visibility>(
    restore<"all" | Visibility>("access", ["all", ...VIS_ORDER], "all"),
  );
  let sort = $state<"updated" | "title" | "size">(
    restore("sort", SORTS, "updated"),
  );
  let query = $state("");
  // S25 — the collections/bookmarks sidebar. Closed by default; remembered.
  let sidebarOpen = $state(restore("sidebar", ["open", "closed"], "closed") === "open");
  let currentCollectionId = $state<string | null>(null);
  let expanded = $state<Record<string, boolean>>({});

  // ---- data ----
  let owned = $state<ArtefactSummary[]>([]);
  let archived = $state<ArtefactSummary[]>([]);
  let shared = $state<SharedArtefactSummary[]>([]);
  let collections = $state<CollectionSummary[]>([]); // active
  let archivedCollections = $state<CollectionSummary[]>([]);
  let bookmarkedArtefacts = $state<ArtefactSummary[]>([]);
  let bookmarkedCollections = $state<CollectionSummary[]>([]);

  // ---- upload / edit modal ----
  let uploadOpen = $state(false);
  let editing = $state<ArtefactSummary | null>(null);
  let uploadBusy = $state(false);
  let uploadError = $state<string | null>(null);

  // ---- permanent-delete confirmation (archived only) ----
  let pendingDelete = $state<
    | { kind: "artefact"; a: ArtefactSummary }
    | { kind: "collection"; c: CollectionSummary; artefacts: number; collections: number }
    | null
  >(null);
  let deleteBusy = $state(false);

  // ---- manage-access panel (the `selected` tier, S16/S25) ----
  let managing = $state<{ kind: "artefact" | "collection"; id: string; title: string } | null>(null);

  // ---- add/move-to-collection modal (S25) ----
  let movingArtefact = $state<ArtefactSummary | null>(null);
  let moveBusy = $state(false);

  // ---- collection editor (create / rename & access) ----
  let editorOpen = $state(false);
  let editorEditing = $state<CollectionSummary | null>(null);
  let editorParent = $state<CollectionSummary | null>(null);
  let editorBusy = $state(false);
  let editorError = $state<string | null>(null);

  const user = $derived(
    $session.data
      ? { name: $session.data.user.name, email: $session.data.user.email }
      : { name: "", email: "" },
  );

  // ---- loading ----
  async function loadOwned() {
    try {
      owned = await api.listOwn();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401)
        toast.show("Could not load your artefacts", TOAST_ICONS.alert);
    }
  }
  async function loadArchived() {
    try {
      archived = await api.listArchived();
    } catch {
      /* non-fatal */
    }
  }
  async function loadShared() {
    try {
      shared = await api.listShared();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401)
        toast.show("Could not load shared artefacts", TOAST_ICONS.alert);
    }
  }
  async function loadCollections() {
    try {
      [collections, archivedCollections] = await Promise.all([
        api.listCollections(),
        api.listCollections(true),
      ]);
    } catch {
      /* non-fatal */
    }
  }
  async function loadBookmarks() {
    try {
      const b = await api.listBookmarks();
      bookmarkedArtefacts = b.artefacts;
      bookmarkedCollections = b.collections;
    } catch {
      /* non-fatal */
    }
  }
  function refreshAll() {
    return Promise.all([
      loadOwned(),
      loadArchived(),
      loadShared(),
      loadCollections(),
      loadBookmarks(),
    ]);
  }

  $effect(() => {
    if ($session.data) {
      refreshAll();
    }
  });

  // Persist the dashboard's view controls so a refresh restores them (see
  // STORE_PREFIX / restore above). Reading them here re-runs the effect
  // whenever any one changes.
  $effect(() => {
    try {
      if (view === "dashboard" || view === "gallery")
        localStorage.setItem(STORE_PREFIX + "view", view);
      localStorage.setItem(STORE_PREFIX + "density", density);
      localStorage.setItem(STORE_PREFIX + "kind", kindFilter);
      localStorage.setItem(STORE_PREFIX + "access", accessFilter);
      localStorage.setItem(STORE_PREFIX + "sort", sort);
      localStorage.setItem(STORE_PREFIX + "sidebar", sidebarOpen ? "open" : "closed");
    } catch {
      /* storage unavailable — the choices just won't persist */
    }
  });

  // ---- collections lookups ----
  const collectionById = $derived(
    new Map([...collections, ...archivedCollections].map((c) => [c.id, c])),
  );
  const collectionNameOf = $derived(
    (id: string | null) => (id ? (collectionById.get(id)?.name ?? "") : ""),
  );
  const currentCollection = $derived(
    currentCollectionId ? (collectionById.get(currentCollectionId) ?? null) : null,
  );
  // The tree root a collection inherits from (CL4) — itself when top-level.
  function rootOf(c: CollectionSummary): CollectionSummary {
    return c.parentId === null ? c : (collectionById.get(c.rootId) ?? c);
  }
  // Ancestor chain for the breadcrumb, root-first (excludes the node itself).
  const breadcrumb = $derived.by(() => {
    const chain: CollectionSummary[] = [];
    let node = currentCollection?.parentId
      ? collectionById.get(currentCollection.parentId)
      : undefined;
    while (node) {
      chain.unshift(node);
      node = node.parentId ? collectionById.get(node.parentId) : undefined;
    }
    return chain;
  });
  const bookmarkedArtefactIds = $derived(new Set(bookmarkedArtefacts.map((a) => a.id)));
  const bookmarkedCollectionIds = $derived(
    new Set(bookmarkedCollections.map((c) => c.id)),
  );

  // ---- derived lists ----
  function matchesQuery(title: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || title.toLowerCase().includes(q);
  }
  function sortList<T extends ArtefactSummary>(list: T[]): T[] {
    const a = [...list];
    if (sort === "title") a.sort((x, y) => x.title.localeCompare(y.title));
    else if (sort === "size") a.sort((x, y) => y.payloadBytes - x.payloadBytes);
    else
      a.sort(
        (x, y) =>
          new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
      );
    return a;
  }

  const isDash = $derived(view === "dashboard");
  const isColl = $derived(view === "collection");
  const collArtefacts = $derived(
    isColl ? owned.filter((a) => a.collectionId === currentCollectionId) : [],
  );
  const baseList = $derived(
    isColl ? collArtefacts : isDash ? owned : shared,
  );

  const visibleOwned = $derived(
    sortList(
      (isColl ? collArtefacts : owned)
        .filter((a) => kindFilter === "all" || a.kind === kindFilter)
        .filter(
          (a) =>
            isColl ||
            accessFilter === "all" ||
            a.effectiveVisibility === accessFilter,
        )
        .filter((a) => matchesQuery(a.title)),
    ),
  );
  const visibleShared = $derived(
    sortList(
      shared
        .filter((g) => kindFilter === "all" || g.kind === kindFilter)
        .filter((g) => accessFilter === "all" || g.effectiveVisibility === accessFilter)
        .filter((g) => matchesQuery(g.title)),
    ),
  );

  // Kind chips with counts, from the active view's base list. Counts are per
  // dimension (independent of the access filter) so toggling access never makes
  // a type pill vanish; a zero-result combination is handled by the empty state.
  const kindChips = $derived.by(() => {
    const counts: Record<string, number> = { all: baseList.length };
    for (const k of KIND_ORDER)
      counts[k] = baseList.filter((x) => x.kind === k).length;
    const chips: { key: "all" | ArtefactKind; label: string; count: number }[] = [
      { key: "all", label: "All types", count: counts.all ?? 0 },
    ];
    for (const k of KIND_ORDER) {
      const n = counts[k] ?? 0;
      if (n > 0) chips.push({ key: k, label: KINDS[k].label, count: n });
    }
    return chips;
  });
  // On a collection page, kind chips appear only when it holds >1 kind.
  const showKindChips = $derived(
    view !== "archive" && (!isColl || kindChips.length > 2),
  );

  // Access chips, mirroring kindChips but over the *effective* tiers (AH20).
  const accessChips = $derived.by(() => {
    const chips: {
      key: "all" | Visibility;
      label: string;
      count: number;
      icon: string[] | null;
    }[] = [{ key: "all", label: "All access", count: baseList.length, icon: null }];
    for (const v of VIS_ORDER) {
      const n = baseList.filter((x) => x.effectiveVisibility === v).length;
      if (n > 0) chips.push({ key: v, label: VIS[v].label, count: n, icon: VIS[v].icon });
    }
    return chips;
  });

  const showEmpty = $derived(
    isDash || isColl ? visibleOwned.length === 0 : visibleShared.length === 0,
  );
  const isFiltered = $derived(
    query.trim() !== "" || kindFilter !== "all" || (!isColl && accessFilter !== "all"),
  );
  const empty = $derived.by(() => {
    if (isColl) {
      if (isFiltered)
        return {
          title: "No matches",
          sub: "No artefacts in this collection match your current kind filter or search.",
          cta: false,
        };
      return {
        title: "No artefacts here yet",
        sub: "Add an artefact to this collection from its ⋯ menu. It will inherit this collection's access.",
        cta: false,
      };
    }
    if (isFiltered)
      return {
        title: "No matches",
        sub: "No artefacts match your current filter or search. Try clearing them.",
        cta: false,
      };
    if (isDash)
      return {
        title: "No artefacts yet",
        sub: "Upload an HTML deliverable from Claude — a prototype, deck, form or doc — and it lives here.",
        cta: true,
      };
    return {
      title: "Nothing shared with you",
      sub: "When teammates share artefacts with members or the public, they’ll show up here.",
      cta: false,
    };
  });

  const sortLabels: Record<typeof sort, string> = {
    updated: "Recently updated",
    title: "Title A–Z",
    size: "Largest first",
  };

  // ---- collection page bits ----
  const subCollections = $derived(
    isColl
      ? collections
          .filter((c) => c.parentId === currentCollectionId)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );
  function directCounts(c: CollectionSummary) {
    const arts = owned.filter((a) => a.collectionId === c.id).length;
    const colls = collections.filter((x) => x.parentId === c.id).length;
    return { arts, colls };
  }
  const collSub = $derived.by(() => {
    if (!currentCollection) return "";
    const { arts, colls } = directCounts(currentCollection);
    const parts = [`${arts} artefact${arts === 1 ? "" : "s"}`];
    if (colls > 0) parts.push(`${colls} collection${colls === 1 ? "" : "s"}`);
    return parts.join(" · ");
  });

  // ---- archive view (S26) ----
  const archivedCollById = $derived(new Map(archivedCollections.map((c) => [c.id, c])));
  // Only the top of each archived subtree is listed; its descendants restore /
  // delete with it.
  const archivedTops = $derived(
    archivedCollections
      .filter((c) => c.parentId === null || !archivedCollById.has(c.parentId))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  // Every collection id in an archived node's subtree (within the archive set).
  function archivedSubtreeIds(id: string): string[] {
    const out = [id];
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const c of archivedCollections) {
        if (c.parentId === cur) {
          out.push(c.id);
          queue.push(c.id);
        }
      }
    }
    return out;
  }
  function archiveCascade(c: CollectionSummary) {
    const ids = new Set(archivedSubtreeIds(c.id));
    const arts = archived.filter((a) => a.collectionId && ids.has(a.collectionId)).length;
    return { arts, colls: ids.size - 1 };
  }
  // Individually-archived artefacts whose collection is not itself archived.
  const archivedLoose = $derived(
    archived.filter((a) => !a.collectionId || !archivedCollById.has(a.collectionId)),
  );
  const archivedCount = $derived(archivedTops.length + archivedLoose.length);

  // ---- navigation ----
  function resetFilters() {
    kindFilter = "all";
    accessFilter = "all";
    query = "";
  }
  function goDashboard() {
    view = "dashboard";
    currentCollectionId = null;
    resetFilters();
    overlay.close();
  }
  function goGallery() {
    view = "gallery";
    currentCollectionId = null;
    resetFilters();
    overlay.close();
  }
  function openCollection(id: string) {
    view = "collection";
    currentCollectionId = id;
    resetFilters();
    // Auto-expand the ancestors + the node so the sidebar shows where you are.
    const open = { ...expanded, [id]: true };
    let node = collectionById.get(id);
    while (node?.parentId) {
      open[node.parentId] = true;
      node = collectionById.get(node.parentId);
    }
    expanded = open;
    overlay.close();
  }
  function openArchive() {
    view = "archive";
    currentCollectionId = null;
    resetFilters();
    overlay.close();
  }

  // ---- actions ----
  function openItem(a: ArtefactSummary) {
    overlay.close();
    window.open(ownOpenUrl(a), "_blank", "noopener");
  }
  function openShared(g: SharedArtefactSummary) {
    window.open(`/a/${g.publicSlug}`, "_blank", "noopener");
  }
  async function copyLink(a: ArtefactSummary) {
    const url = shareUrl(a);
    if (url) {
      try {
        await navigator.clipboard?.writeText(url);
      } catch {
        /* clipboard may be unavailable */
      }
      toast.show(`Link copied · ${url.replace(/^https?:\/\//, "")}`, TOAST_ICONS.check);
    }
  }
  async function changeVisibility(a: ArtefactSummary, v: Visibility) {
    try {
      await api.setVisibility(a.id, v);
      await Promise.all([loadOwned(), loadShared()]);
      toast.show(`Visibility set to ${VIS[v].label}`, VIS[v].icon);
      // Switching to "Specific people" jumps straight into the member picker.
      if (v === "selected") managing = { kind: "artefact", id: a.id, title: a.title };
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not update visibility",
        TOAST_ICONS.alert,
      );
    }
  }

  // Closing the panel reloads so any access-driven `updatedAt` reorder shows.
  function closeManaging() {
    managing = null;
    loadOwned();
    loadShared();
    loadCollections();
  }
  async function archiveItem(a: ArtefactSummary) {
    try {
      await api.archive(a.id);
      await Promise.all([loadOwned(), loadShared(), loadArchived()]);
      toast.show(
        `“${a.title}” archived`,
        TOAST_ICONS.archive,
        () => restoreItem(a.id),
        "Undo",
      );
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not archive",
        TOAST_ICONS.alert,
      );
    }
  }
  async function restoreItem(id: string) {
    try {
      await api.restore(id);
      await Promise.all([loadOwned(), loadShared(), loadArchived()]);
      toast.show("Restored", TOAST_ICONS.restore);
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not restore",
        TOAST_ICONS.alert,
      );
    }
  }

  // ---- bookmarks (S27) ----
  async function toggleArtefactBookmark(a: ArtefactSummary) {
    const on = !bookmarkedArtefactIds.has(a.id);
    try {
      await api.setArtefactBookmark(a.id, on);
      await loadBookmarks();
    } catch {
      toast.show("Could not update the bookmark", TOAST_ICONS.alert);
    }
  }
  async function toggleCollectionBookmark(c: CollectionSummary) {
    const on = !bookmarkedCollectionIds.has(c.id);
    try {
      await api.setCollectionBookmark(c.id, on);
      await loadBookmarks();
    } catch {
      toast.show("Could not update the bookmark", TOAST_ICONS.alert);
    }
  }
  function removeBookmark(kind: "artefact" | "collection", id: string) {
    (kind === "artefact"
      ? api.setArtefactBookmark(id, false)
      : api.setCollectionBookmark(id, false)
    )
      .then(loadBookmarks)
      .catch(() => toast.show("Could not update the bookmark", TOAST_ICONS.alert));
  }

  // ---- collections (S25/S26) ----
  function openNewCollection(parent: CollectionSummary | null) {
    editorEditing = null;
    editorParent = parent;
    editorError = null;
    editorOpen = true;
    overlay.close();
  }
  function openEditCollection(c: CollectionSummary) {
    editorEditing = c;
    editorParent = null;
    editorError = null;
    editorOpen = true;
    overlay.close();
  }
  async function submitEditor(input: { name: string; visibility?: Visibility }) {
    editorBusy = true;
    editorError = null;
    try {
      if (editorEditing) {
        const updated = await api.editCollection(editorEditing.id, input);
        toast.show("Collection updated", TOAST_ICONS.check);
        editorOpen = false;
        await Promise.all([loadCollections(), loadOwned(), loadShared()]);
        if (input.visibility === "selected")
          managing = { kind: "collection", id: updated.id, title: updated.name };
      } else {
        const created = await api.createCollection({
          name: input.name,
          parentId: editorParent?.id ?? null,
          visibility: input.visibility,
        });
        toast.show(`Collection “${created.name}” created`, TOAST_ICONS.check);
        editorOpen = false;
        sidebarOpen = true;
        if (editorParent) expanded = { ...expanded, [editorParent.id]: true };
        await loadCollections();
        if (input.visibility === "selected")
          managing = { kind: "collection", id: created.id, title: created.name };
      }
    } catch (e) {
      editorError = e instanceof ApiError ? e.message : "Something went wrong";
    } finally {
      editorBusy = false;
    }
  }
  async function changeCollectionVisibility(c: CollectionSummary, v: Visibility) {
    try {
      await api.editCollection(c.id, { visibility: v });
      await Promise.all([loadCollections(), loadOwned(), loadShared()]);
      toast.show(
        `Collection access set to ${VIS[v].label} — artefacts inside follow`,
        VIS[v].icon,
      );
      if (v === "selected") managing = { kind: "collection", id: c.id, title: c.name };
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not update access",
        TOAST_ICONS.alert,
      );
    }
  }
  async function archiveCollection(c: CollectionSummary) {
    try {
      const { cascade } = await api.archiveCollection(c.id);
      // Navigating from inside the archived subtree would strand the view.
      if (view === "collection") goDashboard();
      await refreshAll();
      const suffix =
        cascade.artefacts > 0
          ? ` with ${cascade.artefacts} artefact${cascade.artefacts === 1 ? "" : "s"}`
          : "";
      toast.show(
        `“${c.name}” archived${suffix}`,
        TOAST_ICONS.archive,
        () => restoreCollection(c),
        "Undo",
      );
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not archive",
        TOAST_ICONS.alert,
      );
    }
  }
  async function restoreCollection(c: CollectionSummary) {
    try {
      await api.restoreCollection(c.id);
      await refreshAll();
      toast.show(`“${c.name}” restored`, TOAST_ICONS.restore);
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : "Could not restore",
        TOAST_ICONS.alert,
      );
    }
  }

  // ---- move to collection (S25) ----
  function openMove(a: ArtefactSummary) {
    movingArtefact = a;
    overlay.close();
  }
  async function confirmMove(targetId: string | null) {
    if (!movingArtefact) return;
    moveBusy = true;
    try {
      const moved = await api.moveToCollection(movingArtefact.id, targetId);
      const title = movingArtefact.title;
      movingArtefact = null;
      await Promise.all([loadOwned(), loadShared(), loadBookmarks()]);
      if (targetId) {
        const target = collectionById.get(targetId);
        const eff = VIS[moved.effectiveVisibility].label;
        toast.show(
          `“${title}” added to ${target?.name ?? "collection"} — now inherits ${eff} access`,
          TOAST_ICONS.check,
        );
      } else {
        toast.show("Moved to top level", TOAST_ICONS.check);
      }
    } catch (e) {
      movingArtefact = null;
      toast.show(
        e instanceof ApiError ? e.message : "Could not move the artefact",
        TOAST_ICONS.alert,
      );
    } finally {
      moveBusy = false;
    }
  }
  async function createFromPicker(name: string, parentId: string | null) {
    const created = await api.createCollection({ name, parentId });
    await loadCollections();
    return created;
  }

  // ---- permanent delete (S15/S26) ----
  async function confirmDelete() {
    if (!pendingDelete) return;
    deleteBusy = true;
    try {
      if (pendingDelete.kind === "artefact") {
        await api.delete(pendingDelete.a.id);
        toast.show(`“${pendingDelete.a.title}” deleted`, TOAST_ICONS.trash);
      } else {
        await api.deleteCollection(pendingDelete.c.id);
        toast.show(`“${pendingDelete.c.name}” deleted`, TOAST_ICONS.trash);
      }
      pendingDelete = null;
      await refreshAll();
    } catch (e) {
      pendingDelete = null;
      toast.show(
        e instanceof ApiError ? e.message : "Could not delete",
        TOAST_ICONS.alert,
      );
    } finally {
      deleteBusy = false;
    }
  }
  const deleteDialog = $derived.by(() => {
    if (!pendingDelete) return null;
    if (pendingDelete.kind === "artefact")
      return {
        title: `Delete “${pendingDelete.a.title}” permanently?`,
        message:
          "This artefact and all its saved data will be permanently deleted. This can’t be undone.",
        confirmLabel: "Delete artefact",
      };
    const { artefacts, collections: colls } = pendingDelete;
    const cascade =
      artefacts > 0 || colls > 0
        ? ` ${artefacts} artefact${artefacts === 1 ? "" : "s"}${
            colls > 0 ? ` and ${colls} sub-collection${colls === 1 ? "" : "s"}` : ""
          } will be deleted with it.`
        : "";
    return {
      title: `Delete “${pendingDelete.c.name}” permanently?`,
      message: `Everything inside this collection will be permanently deleted too.${cascade} This can’t be undone.`,
      confirmLabel: "Delete collection",
    };
  });

  // ---- upload / edit ----
  function openUpload() {
    editing = null;
    uploadError = null;
    uploadOpen = true;
    overlay.close();
  }
  function openEdit(a: ArtefactSummary) {
    editing = a;
    uploadError = null;
    uploadOpen = true;
    overlay.close();
  }
  function closeUpload() {
    uploadOpen = false;
    editing = null;
  }
  async function submitUpload(input: {
    title: string;
    kind: ArtefactKind;
    file: File | null;
  }) {
    uploadBusy = true;
    uploadError = null;
    try {
      if (editing) {
        await api.update(editing.id, input);
        toast.show("Changes saved", TOAST_ICONS.check);
      } else {
        const created = await api.create({
          title: input.title,
          kind: input.kind,
          file: input.file!,
        });
        toast.show(`“${created.title}” uploaded`, TOAST_ICONS.check);
        goDashboard();
      }
      uploadOpen = false;
      editing = null;
      await Promise.all([loadOwned(), loadShared(), loadArchived()]);
    } catch (e) {
      uploadError = e instanceof ApiError ? e.message : "Something went wrong";
    } finally {
      uploadBusy = false;
    }
  }

  async function doSignOut() {
    overlay.close();
    // signOut() clears the session cookie server-side but does not reset the
    // useSession store, so the UI wouldn't switch back to the sign-in screen.
    // A full reload re-resolves the (now absent) session and clears all state.
    await signOut();
    window.location.href = "/";
  }

  // Shared per-artefact card/row props (dashboard + collection page).
  function cardProps(a: ArtefactSummary) {
    return {
      a,
      onOpen: () => openItem(a),
      onCopy: () => copyLink(a),
      onEdit: () => openEdit(a),
      onArchive: () => archiveItem(a),
      onVisibility: (v: Visibility) => changeVisibility(a, v),
      onManage: () => (managing = { kind: "artefact", id: a.id, title: a.title }),
      collectionName: a.collectionId ? collectionNameOf(a.collectionId) : null,
      onOpenCollection: a.collectionId
        ? () => openCollection(a.collectionId!)
        : undefined,
      bookmarked: bookmarkedArtefactIds.has(a.id),
      onBookmark: () => toggleArtefactBookmark(a),
      onMoveToCollection: () => openMove(a),
      showCollectionChip: !isColl,
    };
  }

  // control-row styles
  const segActive =
    "width:30px;height:28px;display:flex;align-items:center;justify-content:center;border:none;border-radius:7px;cursor:pointer;background:var(--card);color:var(--fg);box-shadow:var(--shadow);";
  const segIdle =
    "width:30px;height:28px;display:flex;align-items:center;justify-content:center;border:none;border-radius:7px;cursor:pointer;background:none;color:var(--muted-fg);";
  const archiveRowBtn =
    "display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;";
</script>

{#if $session.isPending}
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:var(--muted-fg);font-size:13px;">
    Loading…
  </div>
{:else if !$session.data}
  <AuthScreen />
{:else}
  <div style="display:flex;min-height:100vh;background:var(--bg);color:var(--fg);">
    {#if sidebarOpen}
      <Sidebar
        {view}
        {collections}
        activeCollectionId={currentCollectionId}
        {expanded}
        {bookmarkedArtefacts}
        {bookmarkedCollections}
        {archivedCount}
        onHome={goDashboard}
        onOpenCollection={openCollection}
        onOpenArchive={openArchive}
        onNewCollection={() => openNewCollection(null)}
        onToggleExpand={(id) => (expanded = { ...expanded, [id]: !expanded[id] })}
        onOpenArtefact={openItem}
        onRemoveBookmark={removeBookmark}
      />
    {/if}
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
      <TopBar
        {view}
        {query}
        searchPlaceholder={isColl
          ? "Search this collection…"
          : isDash || view === "archive"
            ? "Search your artefacts…"
            : "Search shared artefacts…"}
        {user}
        onSearch={(q) => (query = q)}
        onGoDashboard={goDashboard}
        onGoGallery={goGallery}
        onOpenUpload={openUpload}
        onSignOut={doSignOut}
        onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
      />

      <main style="flex:1;padding:26px 24px 64px;max-width:1280px;width:100%;margin:0 auto;">
        {#if view === "archive"}
          <!-- Archive view (S26): archived subtree tops + loose artefacts. -->
          <div style="margin-bottom:18px;">
            <h1 style="margin:0;font-size:21px;font-weight:600;letter-spacing:-0.02em;">Archive</h1>
            <p style="margin:5px 0 0;font-size:13.5px;color:var(--muted-fg);">
              Restore items, or delete them permanently. Deleting a collection also deletes everything inside it.
            </p>
          </div>

          {#if archivedCount === 0}
            <div style="border:1.5px dashed var(--border-strong);border-radius:16px;padding:64px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <div style="font-size:16px;font-weight:600;">Archive is empty</div>
              <div style="font-size:13.5px;color:var(--muted-fg);">Archived collections and artefacts show up here.</div>
            </div>
          {:else}
            {#if archivedTops.length > 0}
              <div style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);margin-bottom:10px;">
                Collections
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:26px;">
                {#each archivedTops as c (c.id)}
                  {@const cascade = archiveCascade(c)}
                  <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--border);border-radius:11px;background:var(--card);">
                    <div style="width:30px;height:30px;border-radius:7px;background:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                      <Icon paths={FOLDER_ICON} size={15} width={1.8} color={collectionColor(c.id)} />
                    </div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13.5px;font-weight:500;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        {c.name}
                      </div>
                      <div style="font-size:11.5px;color:var(--muted-fg);opacity:.8;">
                        {cascade.arts} artefact{cascade.arts === 1 ? "" : "s"}{cascade.colls > 0
                          ? ` · ${cascade.colls} sub-collection${cascade.colls === 1 ? "" : "s"}`
                          : ""} · {VIS[c.visibility].label}
                      </div>
                    </div>
                    <button onclick={() => restoreCollection(c)} style={archiveRowBtn}>
                      <Icon paths={["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"]} size={14} />
                      Restore
                    </button>
                    <button
                      onclick={() =>
                        (pendingDelete = {
                          kind: "collection",
                          c,
                          artefacts: cascade.arts,
                          collections: cascade.colls,
                        })}
                      title="Delete permanently"
                      aria-label="Delete permanently"
                      style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--border);background:var(--card);color:var(--destructive);border-radius:8px;cursor:pointer;font-family:inherit;"
                    >
                      <Icon paths={["M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M10 11v6", "M14 11v6"]} size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            {#if archivedLoose.length > 0}
              <div style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);margin-bottom:10px;">
                Artefacts
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                {#each archivedLoose as r (r.id)}
                  {@const m = kindMeta(r.kind)}
                  <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--border);border-radius:11px;background:var(--card);">
                    <div style="width:30px;height:30px;border-radius:7px;background:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                      <Icon paths={m.icon} size={15} width={1.8} color={m.color} />
                    </div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13.5px;font-weight:500;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        {r.title}
                      </div>
                      <div style="font-size:11.5px;color:var(--muted-fg);opacity:.8;">
                        {m.label}
                      </div>
                    </div>
                    <button onclick={() => restoreItem(r.id)} style={archiveRowBtn}>
                      <Icon paths={["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"]} size={14} />
                      Restore
                    </button>
                    <button
                      onclick={() => (pendingDelete = { kind: "artefact", a: r })}
                      title="Delete permanently"
                      aria-label="Delete permanently"
                      style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--border);background:var(--card);color:var(--destructive);border-radius:8px;cursor:pointer;font-family:inherit;"
                    >
                      <Icon paths={["M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M10 11v6", "M14 11v6"]} size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {:else}
          <!-- View header -->
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;">
            <div style="min-width:0;">
              {#if isColl && currentCollection}
                <!-- Breadcrumb -->
                <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted-fg);margin-bottom:7px;flex-wrap:wrap;">
                  <button
                    onclick={goDashboard}
                    style="background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:12px;color:var(--muted-fg);"
                  >
                    Collections
                  </button>
                  {#each breadcrumb as crumb (crumb.id)}
                    <Icon paths={["M9 18l6-6-6-6"]} size={11} style="opacity:.6;" />
                    <button
                      onclick={() => openCollection(crumb.id)}
                      style="background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:12px;color:var(--muted-fg);"
                    >
                      {crumb.name}
                    </button>
                  {/each}
                  <Icon paths={["M9 18l6-6-6-6"]} size={11} style="opacity:.6;" />
                  <span style="font-weight:600;color:var(--fg);">{currentCollection.name}</span>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                  <div
                    style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:color-mix(in srgb, {collectionColor(currentCollection.id)} 14%, transparent);"
                  >
                    <Icon paths={FOLDER_ICON} size={20} width={1.7} color={collectionColor(currentCollection.id)} />
                  </div>
                  <div style="min-width:0;">
                    <h1 style="margin:0;font-size:21px;font-weight:600;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                      {currentCollection.name}
                    </h1>
                    <p style="margin:3px 0 0;font-size:13px;color:var(--muted-fg);">{collSub}</p>
                  </div>
                  <!-- Access control: editable on a root; Inherited on a nested one (CL4). -->
                  <VisibilityControl
                    id={`coll:${currentCollection.id}`}
                    visibility={rootOf(currentCollection).visibility}
                    variant="pill"
                    onChoose={(v) => changeCollectionVisibility(currentCollection!, v)}
                    onManage={() =>
                      (managing = {
                        kind: "collection",
                        id: currentCollection!.id,
                        title: currentCollection!.name,
                      })}
                    inherited={currentCollection.parentId !== null}
                    inheritedFrom={rootOf(currentCollection).name}
                    onOpenCollection={() => openCollection(rootOf(currentCollection!).id)}
                    note="Members of this collection — and every artefact inside — inherit this access."
                  />
                  <!-- Bookmark toggle -->
                  <button
                    onclick={() => toggleCollectionBookmark(currentCollection!)}
                    title={bookmarkedCollectionIds.has(currentCollection.id)
                      ? "Remove bookmark"
                      : "Bookmark collection"}
                    aria-label={bookmarkedCollectionIds.has(currentCollection.id)
                      ? "Remove bookmark"
                      : "Bookmark collection"}
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:var(--card);border-radius:8px;cursor:pointer;flex-shrink:0;color:{bookmarkedCollectionIds.has(currentCollection.id) ? 'var(--primary)' : 'var(--muted-fg)'};"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill={bookmarkedCollectionIds.has(currentCollection.id) ? "currentColor" : "none"}
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linejoin="round"
                    >
                      <path d={BOOKMARK_ICON[0]} />
                    </svg>
                  </button>
                  <!-- ⋯ menu -->
                  <div style="position:relative;flex-shrink:0;">
                    <button
                      onclick={() => overlay.toggle("collmenu")}
                      title="More"
                      style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:var(--card);color:var(--muted-fg);border-radius:8px;cursor:pointer;"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </button>
                    {#if overlay.isOpen("collmenu")}
                      <div style="position:absolute;right:0;top:36px;z-index:35;min-width:198px;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;">
                        <button
                          onclick={() => openEditCollection(currentCollection!)}
                          style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:none;color:var(--fg);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;"
                        >
                          <Icon paths={["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"]} size={15} />
                          Rename & access
                        </button>
                        <button
                          onclick={() => openNewCollection(currentCollection!)}
                          style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:none;color:var(--fg);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;"
                        >
                          <Icon paths={FOLDER_ICON} size={15} />
                          New sub-collection
                        </button>
                        <div style="height:1px;background:var(--border);margin:5px 6px;"></div>
                        <button
                          onclick={() => {
                            overlay.close();
                            archiveCollection(currentCollection!);
                          }}
                          style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:none;color:var(--destructive);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;"
                        >
                          <Icon paths={ARCHIVE_ICON} size={15} />
                          Archive collection
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              {:else}
                <h1 style="margin:0;font-size:21px;font-weight:600;letter-spacing:-0.02em;">
                  {isDash ? "Your artefacts" : "Shared with you"}
                </h1>
                <p style="margin:5px 0 0;font-size:13.5px;color:var(--muted-fg);">
                  {isDash
                    ? "Manage, share and organise the artefacts you own."
                    : "Artefacts teammates have shared with you — open to view."}
                </p>
              {/if}
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
              <!-- Access filter (by effective visibility tier) — hidden on a collection page (one tier tree-wide). -->
              {#if !isColl && accessChips.length > 1}
                {@const cur = accessFilter === "all" ? null : VIS[accessFilter]}
                <div style="position:relative;">
                  <button
                    onclick={() => overlay.toggle("access")}
                    style="display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;"
                  >
                    <Icon paths={cur ? cur.icon : FILTER_ICON} size={14} />
                    {cur ? cur.label : "All access"}
                    <Icon paths={["M6 9l6 6 6-6"]} size={13} style="color:var(--muted-fg);" />
                  </button>
                  {#if overlay.isOpen("access")}
                    <div style="position:absolute;right:0;top:40px;z-index:40;min-width:208px;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;">
                      {#each accessChips as chip (chip.key)}
                        {@const active = accessFilter === chip.key}
                        <button
                          onclick={() => {
                            accessFilter = chip.key;
                            overlay.close();
                          }}
                          style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:{active
                            ? 'var(--accent-soft)'
                            : 'none'};color:var(--fg);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;"
                        >
                          <Icon
                            paths={chip.icon ?? FILTER_ICON}
                            size={14}
                            style="flex-shrink:0;color:var(--muted-fg);"
                          />
                          <span style="flex:1;{active ? 'font-weight:600;' : ''}">{chip.label}</span>
                          <span style="font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--muted);color:var(--muted-fg);">
                            {chip.count}
                          </span>
                          {#if active}
                            <Icon paths={["M20 6L9 17l-5-5"]} size={14} width={2.4} color="var(--primary)" style="flex-shrink:0;" />
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              <!-- Sort (hidden on an artefact-less collection page) -->
              {#if !isColl || collArtefacts.length > 0}
                <div style="position:relative;">
                  <button
                    onclick={() => overlay.toggle("sort")}
                    style="display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;"
                  >
                    <Icon paths={["M3 6h12M3 12h9M3 18h6M17 8l4-4 4 4M21 4v16"]} size={14} />
                    {sortLabels[sort]}
                    <Icon paths={["M6 9l6 6 6-6"]} size={13} style="color:var(--muted-fg);" />
                  </button>
                  {#if overlay.isOpen("sort")}
                    <div style="position:absolute;right:0;top:40px;z-index:40;min-width:172px;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;">
                      {#each SORTS as opt (opt)}
                        {@const active = sort === opt}
                        <button
                          onclick={() => {
                            sort = opt;
                            overlay.close();
                          }}
                          style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;border:none;background:none;color:var(--fg);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;{active
                            ? 'font-weight:600;'
                            : ''}"
                        >
                          <span>{sortLabels[opt]}</span>
                          {#if active}
                            <Icon paths={["M20 6L9 17l-5-5"]} size={15} width={2.4} color="var(--primary)" />
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              <!-- Density -->
              <div style="display:flex;align-items:center;background:var(--muted);padding:3px;border-radius:9px;">
                <button onclick={() => (density = "grid")} title="Grid" style={density === "grid" ? segActive : segIdle}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </button>
                <button onclick={() => (density = "list")} title="List" style={density === "list" ? segActive : segIdle}>
                  <Icon paths={["M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"]} size={15} />
                </button>
              </div>
            </div>
          </div>

          <!-- Sub-collections (collection page only) -->
          {#if isColl && subCollections.length > 0}
            <div style="margin-bottom:22px;">
              <div style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);margin-bottom:10px;">
                Collections
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:12px;">
                {#each subCollections as c (c.id)}
                  {@const counts = directCounts(c)}
                  <button
                    onclick={() => openCollection(c.id)}
                    style="display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:var(--shadow);cursor:pointer;font-family:inherit;text-align:left;"
                  >
                    <div style="width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:color-mix(in srgb, {collectionColor(c.id)} 14%, transparent);">
                      <Icon paths={FOLDER_ICON} size={16} width={1.7} color={collectionColor(c.id)} />
                    </div>
                    <div style="min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        {c.name}
                      </div>
                      <div style="font-size:11.5px;color:var(--muted-fg);">
                        {counts.arts} artefact{counts.arts === 1 ? "" : "s"}{counts.colls > 0
                          ? ` · ${counts.colls} collection${counts.colls === 1 ? "" : "s"}`
                          : ""}
                      </div>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#if isColl}
            <div style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);margin-bottom:10px;">
              Artefacts
            </div>
          {/if}

          <!-- Kind chips (filter by type); access is filtered via the dropdown above. -->
          {#if showKindChips}
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px;">
              {#each kindChips as chip (chip.key)}
                {@const active = kindFilter === chip.key}
                <button
                  onclick={() => (kindFilter = chip.key)}
                  style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;border:1px solid {active
                    ? 'transparent'
                    : 'var(--border)'};background:{active
                    ? 'var(--primary)'
                    : 'var(--card)'};color:{active ? 'var(--primary-fg)' : 'var(--fg)'};"
                >
                  {chip.label}
                  <span
                    style="font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;background:{active
                      ? 'rgba(255,255,255,0.22)'
                      : 'var(--muted)'};color:{active ? 'var(--primary-fg)' : 'var(--muted-fg)'};"
                  >
                    {chip.count}
                  </span>
                </button>
              {/each}
            </div>
          {/if}

          {#if showEmpty}
            <div style="border:1.5px dashed var(--border-strong);border-radius:16px;padding:64px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <div style="width:56px;height:56px;border-radius:14px;background:var(--muted);display:flex;align-items:center;justify-content:center;margin-bottom:8px;color:var(--muted-fg);">
                <Icon
                  paths={["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M12 11v6", "M9 14h6"]}
                  size={26}
                  width={1.7}
                />
              </div>
              <div style="font-size:16px;font-weight:600;">{empty.title}</div>
              <div style="font-size:13.5px;color:var(--muted-fg);max-width:340px;">{empty.sub}</div>
              {#if empty.cta}
                <button
                  onclick={openUpload}
                  style="margin-top:14px;display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 16px;border-radius:9px;background:var(--primary);color:var(--primary-fg);font-weight:600;font-size:13px;border:none;cursor:pointer;font-family:inherit;"
                >
                  <Icon paths={["M12 5v14M5 12h14"]} size={16} width={2.2} />
                  Upload your first artefact
                </button>
              {/if}
            </div>
          {:else if (isDash || isColl) && density === "grid"}
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px;">
              {#each visibleOwned as a (a.id)}
                <ArtefactCard {...cardProps(a)} />
              {/each}
            </div>
          {:else if (isDash || isColl) && density === "list"}
            <div style="display:flex;flex-direction:column;gap:10px;">
              {#each visibleOwned as a (a.id)}
                <ArtefactRow {...cardProps(a)} />
              {/each}
            </div>
          {:else if view === "gallery" && density === "grid"}
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px;">
              {#each visibleShared as g (g.id)}
                <GalleryCard {g} onOpen={() => openShared(g)} />
              {/each}
            </div>
          {:else}
            <div style="display:flex;flex-direction:column;gap:10px;">
              {#each visibleShared as g (g.id)}
                <GalleryRow {g} onOpen={() => openShared(g)} />
              {/each}
            </div>
          {/if}
        {/if}
      </main>
    </div>
  </div>

  <!-- Click-away for transient menus. Sits ABOVE page content (z 0) but BELOW the
       sticky header (z 20): the header's backdrop-filter + z-index create a stacking
       context that traps the account menu, so the click-away must stay under the
       header for that menu to remain clickable. All menus (35–40) render above it. -->
  {#if overlay.any}
    <div
      onclick={() => overlay.close()}
      role="presentation"
      style="position:fixed;inset:0;z-index:15;"
    ></div>
  {/if}

  {#if uploadOpen}
    <UploadModal
      {editing}
      busy={uploadBusy}
      serverError={uploadError}
      onClose={closeUpload}
      onSubmit={submitUpload}
    />
  {/if}

  {#if managing}
    <ManageAccessModal target={managing} onClose={closeManaging} />
  {/if}

  {#if movingArtefact}
    <AddToCollectionModal
      artefact={movingArtefact}
      {collections}
      busy={moveBusy}
      onClose={() => (movingArtefact = null)}
      onConfirm={confirmMove}
      onCreate={createFromPicker}
    />
  {/if}

  {#if editorOpen}
    <CollectionEditorModal
      editing={editorEditing}
      parent={editorParent}
      busy={editorBusy}
      serverError={editorError}
      onClose={() => (editorOpen = false)}
      onSubmit={submitEditor}
    />
  {/if}

  {#if pendingDelete && deleteDialog}
    <ConfirmDialog
      title={deleteDialog.title}
      message={deleteDialog.message}
      confirmLabel={deleteDialog.confirmLabel}
      busy={deleteBusy}
      onConfirm={confirmDelete}
      onClose={() => (pendingDelete = null)}
    />
  {/if}

  <Toast />
{/if}
