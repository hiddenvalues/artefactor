import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import type {
  ArtefactSummary,
  CollectionSummary,
  SharedArtefactSummary,
  SharedCollectionSummary,
} from "../../shared/contracts";
import { api, ApiError } from "./api";
import { mergeViews } from "./home";
import { notify } from "./toast";

/** Everything the signed-in user's screens list, and the loaders that refresh
 *  each slice of it after an action. */
export function useLibrary(signedIn: boolean) {
  const [owned, setOwned] = useState<ArtefactSummary[]>([]);
  const [archived, setArchived] = useState<ArtefactSummary[]>([]);
  const [shared, setShared] = useState<SharedArtefactSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]); // active, own
  const [archivedCollections, setArchivedCollections] = useState<CollectionSummary[]>([]);
  // S28 — trees shared *to* the user (every node, with canContribute + owner).
  const [sharedCollections, setSharedCollections] = useState<SharedCollectionSummary[]>([]);
  const [bookmarkedArtefacts, setBookmarkedArtefacts] = useState<ArtefactSummary[]>([]);
  const [bookmarkedCollections, setBookmarkedCollections] = useState<CollectionSummary[]>([]);
  // S47 — your own views (artefact id → viewedAt), for Home's Recent and sort.
  const [views, setViews] = useState<ReadonlyMap<string, string>>(new Map());
  // S47 — true once the owned and shared lists first answer (Home's skeletons).
  const [loaded, setLoaded] = useState(false);
  // S59 — true once a live collections load has answered (or failed), so a
  // path waiting on a collection page resolves against them (S61); a load
  // dropped as stale never sets it.
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  // S53 — `refreshAll` starts a new generation (e.g. after an org switch); an
  // answer to a request from an older one is dropped, never committed.
  const generation = useRef(0);
  const current = useCallback(() => {
    const g = generation.current;
    return () => g === generation.current;
  }, []);

  const loadOwned = useCallback(async () => {
    const live = current();
    try {
      const list = await api.listOwn();
      if (live()) setOwned(list);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) notify("Could not load your artefacts", CircleAlert);
    }
  }, [current]);
  const loadArchived = useCallback(async () => {
    const live = current();
    try {
      const list = await api.listArchived();
      if (live()) setArchived(list);
    } catch {
      /* non-fatal */
    }
  }, [current]);
  const loadShared = useCallback(async () => {
    const live = current();
    try {
      const list = await api.listShared();
      if (live()) setShared(list);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) notify("Could not load shared artefacts", CircleAlert);
    }
  }, [current]);
  const loadCollections = useCallback(async () => {
    const live = current();
    try {
      const [own, arch, sh] = await Promise.all([
        api.listCollections(),
        api.listCollections(true),
        api.listSharedCollections(),
      ]);
      if (!live()) return;
      setCollections(own);
      setArchivedCollections(arch);
      setSharedCollections(sh);
      setCollectionsLoaded(true);
    } catch {
      // Non-fatal; a failed live load still answers, so a held route resolves.
      if (live()) setCollectionsLoaded(true);
    }
  }, [current]);
  const loadBookmarks = useCallback(async () => {
    const live = current();
    try {
      const b = await api.listBookmarks();
      if (!live()) return;
      setBookmarkedArtefacts(b.artefacts);
      setBookmarkedCollections(b.collections);
    } catch {
      /* non-fatal */
    }
  }, [current]);
  const loadViews = useCallback(async () => {
    const live = current();
    try {
      const list = await api.listMyViews();
      if (live()) setViews((v) => mergeViews(v, list));
    } catch {
      /* non-fatal — Recent falls back to your own edits */
    }
  }, [current]);
  // Opening an artefact stamps its view locally, so Recent moves before the
  // server's record reaches the next reload.
  const markViewed = useCallback((id: string) => {
    setViews((v) => new Map(v).set(id, new Date().toISOString()));
  }, []);
  const refreshAll = useCallback(() => {
    generation.current += 1;
    return Promise.all([loadOwned(), loadArchived(), loadShared(), loadCollections(), loadBookmarks(), loadViews()]);
  },
    [loadOwned, loadArchived, loadShared, loadCollections, loadBookmarks, loadViews],
  );

  useEffect(() => {
    if (!signedIn) return;
    void Promise.all([loadOwned(), loadShared()]).then(() => setLoaded(true));
    void loadCollections();
    void Promise.all([loadArchived(), loadBookmarks(), loadViews()]);
  }, [signedIn, loadOwned, loadShared, loadArchived, loadCollections, loadBookmarks, loadViews]);

  // Views recorded in another tab (an opened artefact) land when you come back.
  useEffect(() => {
    if (!signedIn) return;
    const onFocus = () => void loadViews();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [signedIn, loadViews]);

  // Own (active + archived) and shared nodes in one lookup — names, chains and
  // the unified collection page resolve through this.
  const collectionById = useMemo(
    () =>
      new Map<string, CollectionSummary>(
        [...collections, ...archivedCollections, ...sharedCollections].map((c) => [c.id, c]),
      ),
    [collections, archivedCollections, sharedCollections],
  );
  const bookmarkedArtefactIds = useMemo(() => new Set(bookmarkedArtefacts.map((a) => a.id)), [bookmarkedArtefacts]);
  const bookmarkedCollectionIds = useMemo(
    () => new Set(bookmarkedCollections.map((c) => c.id)),
    [bookmarkedCollections],
  );

  return {
    owned,
    setOwned,
    archived,
    shared,
    collections,
    archivedCollections,
    sharedCollections,
    bookmarkedArtefacts,
    bookmarkedCollections,
    collectionById,
    bookmarkedArtefactIds,
    bookmarkedCollectionIds,
    views,
    loaded,
    collectionsLoaded,
    markViewed,
    loadViews,
    loadOwned,
    loadArchived,
    loadShared,
    loadCollections,
    loadBookmarks,
    refreshAll,
  };
}

export type Library = ReturnType<typeof useLibrary>;
