import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import type {
  ArtefactSummary,
  CollectionSummary,
  SharedArtefactSummary,
  SharedCollectionSummary,
} from "../../shared/contracts";
import { api, ApiError } from "./api";
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

  const loadOwned = useCallback(async () => {
    try {
      setOwned(await api.listOwn());
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) notify("Could not load your artefacts", CircleAlert);
    }
  }, []);
  const loadArchived = useCallback(async () => {
    try {
      setArchived(await api.listArchived());
    } catch {
      /* non-fatal */
    }
  }, []);
  const loadShared = useCallback(async () => {
    try {
      setShared(await api.listShared());
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) notify("Could not load shared artefacts", CircleAlert);
    }
  }, []);
  const loadCollections = useCallback(async () => {
    try {
      const [own, arch, sh] = await Promise.all([
        api.listCollections(),
        api.listCollections(true),
        api.listSharedCollections(),
      ]);
      setCollections(own);
      setArchivedCollections(arch);
      setSharedCollections(sh);
    } catch {
      /* non-fatal */
    }
  }, []);
  const loadBookmarks = useCallback(async () => {
    try {
      const b = await api.listBookmarks();
      setBookmarkedArtefacts(b.artefacts);
      setBookmarkedCollections(b.collections);
    } catch {
      /* non-fatal */
    }
  }, []);
  const refreshAll = useCallback(
    () => Promise.all([loadOwned(), loadArchived(), loadShared(), loadCollections(), loadBookmarks()]),
    [loadOwned, loadArchived, loadShared, loadCollections, loadBookmarks],
  );

  useEffect(() => {
    if (signedIn) void refreshAll();
  }, [signedIn, refreshAll]);

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
    loadOwned,
    loadArchived,
    loadShared,
    loadCollections,
    loadBookmarks,
    refreshAll,
  };
}

export type Library = ReturnType<typeof useLibrary>;
