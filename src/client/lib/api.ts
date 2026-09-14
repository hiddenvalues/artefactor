import type {
  AccessListResponse,
  ArtefactSummary,
  ArtefactListResponse,
  BookmarksResponse,
  CollectionLifecycleResponse,
  CollectionListResponse,
  CollectionSummary,
  CreateCollectionRequest,
  EditCollectionRequest,
  MeResponse,
  PublicConfigResponse,
  SharedArtefactSummary,
  SharedCollectionSummary,
  SharedCollectionsResponse,
  SharedListResponse,
  UserRef,
  UserSearchResponse,
} from "../../shared/contracts";
import type { ArtefactKind } from "../../domain/artefact/kind";
import type { Visibility } from "./format";

/** Thrown by every client call when the BFF responds non-2xx. `status` lets
 *  callers special-case 401 (no session) without string matching. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  const message =
    typeof body.error === "string" ? body.error : `${res.status} ${res.statusText}`;
  throw new ApiError(res.status, message);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) await fail(res);
  return res.json() as Promise<T>;
}

export const api = {
  config(): Promise<PublicConfigResponse> {
    return fetch("/api/config").then(json<PublicConfigResponse>);
  },

  me(): Promise<MeResponse> {
    return fetch("/api/me").then(json<MeResponse>);
  },

  listOwn(): Promise<ArtefactSummary[]> {
    return fetch("/api/artefacts")
      .then(json<ArtefactListResponse>)
      .then((r) => r.artefacts);
  },

  listArchived(): Promise<ArtefactSummary[]> {
    return fetch("/api/artefacts?archived=true")
      .then(json<ArtefactListResponse>)
      .then((r) => r.artefacts);
  },

  listShared(): Promise<SharedArtefactSummary[]> {
    return fetch("/api/shared")
      .then(json<SharedListResponse>)
      .then((r) => r.artefacts);
  },

  // S4 — one owned artefact's summary (S35 polls it for a fresh thumbnail).
  getOwn(id: string): Promise<ArtefactSummary> {
    return fetch(`/api/artefacts/${id}`).then(json<ArtefactSummary>);
  },

  create(input: {
    title: string;
    kind: ArtefactKind;
    file: File;
  }): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", input.title);
    form.set("kind", input.kind);
    form.set("payload", input.file);
    return fetch("/api/artefacts", { method: "POST", body: form }).then(
      json<ArtefactSummary>,
    );
  },

  update(
    id: string,
    input: { title: string; kind: ArtefactKind; file?: File | null },
  ): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", input.title);
    form.set("kind", input.kind);
    if (input.file) form.set("payload", input.file);
    return fetch(`/api/artefacts/${id}`, { method: "PATCH", body: form }).then(
      json<ArtefactSummary>,
    );
  },

  async setVisibility(id: string, visibility: Visibility): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    if (!res.ok) await fail(res);
  },

  // S16 — Share with specific people. Search the directory for the add-member
  // picker; list/grant/revoke an artefact's `selected`-tier members (owner-only).
  searchUsers(query: string): Promise<UserRef[]> {
    return fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      .then(json<UserSearchResponse>)
      .then((r) => r.users);
  },

  getAccess(id: string): Promise<UserRef[]> {
    return fetch(`/api/artefacts/${id}/access`)
      .then(json<AccessListResponse>)
      .then((r) => r.members);
  },

  async grantAccess(id: string, userId: string): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) await fail(res);
  },

  async revokeAccess(id: string, userId: string): Promise<void> {
    const res = await fetch(
      `/api/artefacts/${id}/access/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) await fail(res);
  },

  async archive(id: string): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}/archive`, { method: "POST" });
    if (!res.ok) await fail(res);
  },

  async restore(id: string): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}/restore`, { method: "POST" });
    if (!res.ok) await fail(res);
  },

  // Permanently delete an archived artefact (S15). 204 No Content on success.
  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}`, { method: "DELETE" });
    if (!res.ok) await fail(res);
  },

  // S28 — the collection trees shared *to* the caller (every node, with the
  // per-tree contributor flag and the owner's identity).
  listSharedCollections(): Promise<SharedCollectionSummary[]> {
    return fetch("/api/shared/collections")
      .then(json<SharedCollectionsResponse>)
      .then((r) => r.collections);
  },

  // S29 — eject an artefact from the caller's collection (CL13).
  ejectArtefact(collectionId: string, artefactId: string): Promise<ArtefactSummary> {
    return fetch(
      `/api/collections/${collectionId}/artefacts/${encodeURIComponent(artefactId)}`,
      { method: "DELETE" },
    ).then(json<ArtefactSummary>);
  },

  // S25/S26 — Artefact Collections (owner-only folder tree, cascades).
  listCollections(archived = false): Promise<CollectionSummary[]> {
    return fetch(`/api/collections${archived ? "?archived=true" : ""}`)
      .then(json<CollectionListResponse>)
      .then((r) => r.collections);
  },

  createCollection(input: CreateCollectionRequest): Promise<CollectionSummary> {
    return fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<CollectionSummary>);
  },

  editCollection(
    id: string,
    input: EditCollectionRequest,
  ): Promise<CollectionSummary> {
    return fetch(`/api/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<CollectionSummary>);
  },

  getCollectionAccess(id: string): Promise<UserRef[]> {
    return fetch(`/api/collections/${id}/access`)
      .then(json<AccessListResponse>)
      .then((r) => r.members);
  },

  async grantCollectionAccess(id: string, userId: string): Promise<void> {
    const res = await fetch(`/api/collections/${id}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) await fail(res);
  },

  async revokeCollectionAccess(id: string, userId: string): Promise<void> {
    const res = await fetch(
      `/api/collections/${id}/access/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) await fail(res);
  },

  archiveCollection(id: string): Promise<CollectionLifecycleResponse> {
    return fetch(`/api/collections/${id}/archive`, { method: "POST" }).then(
      json<CollectionLifecycleResponse>,
    );
  },

  restoreCollection(id: string): Promise<CollectionLifecycleResponse> {
    return fetch(`/api/collections/${id}/restore`, { method: "POST" }).then(
      json<CollectionLifecycleResponse>,
    );
  },

  async deleteCollection(id: string): Promise<void> {
    const res = await fetch(`/api/collections/${id}`, { method: "DELETE" });
    if (!res.ok) await fail(res);
  },

  // Move an artefact into a collection (null = back to top level).
  moveToCollection(
    id: string,
    collectionId: string | null,
  ): Promise<ArtefactSummary> {
    return fetch(`/api/artefacts/${id}/collection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectionId }),
    }).then(json<ArtefactSummary>);
  },

  // S27 — Bookmarks (per-user pins of owned items).
  listBookmarks(): Promise<BookmarksResponse> {
    return fetch("/api/bookmarks").then(json<BookmarksResponse>);
  },

  async setArtefactBookmark(id: string, on: boolean): Promise<void> {
    const res = await fetch(`/api/artefacts/${id}/bookmark`, {
      method: on ? "PUT" : "DELETE",
    });
    if (!res.ok) await fail(res);
  },

  async setCollectionBookmark(id: string, on: boolean): Promise<void> {
    const res = await fetch(`/api/collections/${id}/bookmark`, {
      method: on ? "PUT" : "DELETE",
    });
    if (!res.ok) await fail(res);
  },
};

/** Absolute share URL for a shared artefact, or null while private. */
export function shareUrl(a: ArtefactSummary): string | null {
  return a.publicSlug ? `${location.origin}/a/${a.publicSlug}` : null;
}

/** Whether the artefact is reachable by link right now — a slug exists and the
 *  tier it is actually served under (its own, or the collection tree root's,
 *  AH20) is not private. */
export function isLinkShared(a: ArtefactSummary): boolean {
  return !!a.publicSlug && a.effectiveVisibility !== "private";
}

/** Where "Open" points for an artefact you own: the hosted shell when it has a
 *  slug, otherwise the owner-only raw preview. */
export function ownOpenUrl(a: ArtefactSummary): string {
  return a.publicSlug ? `/a/${a.publicSlug}` : `/api/artefacts/${a.id}/raw`;
}
