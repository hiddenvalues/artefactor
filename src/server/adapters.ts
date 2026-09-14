import { db } from "../infra/db/client";
import { DrizzleArtefactRepository } from "../infra/db/artefact-repository.drizzle";
import { DrizzleCollectionRepository } from "../infra/db/collection-repository.drizzle";
import { DrizzleBookmarkRepository } from "../infra/db/bookmark-repository.drizzle";
import { DrizzleDataRepository } from "../infra/db/data-repository.drizzle";
import { DrizzleViewRepository } from "../infra/db/view-repository.drizzle";
import { DrizzleUserDirectory } from "../infra/db/user-directory.drizzle";
import { FilesystemPayloadStore } from "../infra/storage/payload-store";
import { FilesystemThumbnailStore } from "../infra/storage/thumbnail-store";
import { PlaywrightThumbnailRenderer } from "../infra/render/playwright-thumbnail-renderer";
import { env } from "./env";
import type { ArtefactRepository } from "../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../domain/collection/collection-repository";
import type { BookmarkRepository } from "../domain/bookmark/bookmark-repository";
import type { DataRepository } from "../domain/data/data-repository";
import type { ViewRepository } from "../domain/views/view-repository";
import type {
  PayloadStore,
  ThumbnailRenderer,
  ThumbnailStore,
} from "../domain/artefact/ports";
import type { UserDirectory } from "./data/user-directory";

// S24 — the domain-port adapter set, threaded into the BFF composition
// (`createApp`/`createApiRoutes`) as injected dependencies rather than imported
// as ambient singletons. OSS wires the SQLite + filesystem `defaultAdapters`
// below; a closed superset can pass a different set (e.g. Postgres + object
// storage) without forking the composition. The domain ports are the seam.
export interface Adapters {
  artefactRepository: ArtefactRepository;
  // S25/S27 — Artefact Collections + Bookmarks.
  collectionRepository: CollectionRepository;
  bookmarkRepository: BookmarkRepository;
  dataRepository: DataRepository;
  viewRepository: ViewRepository;
  payloadStore: PayloadStore;
  // S35 — rendered card thumbnails (read by the thumbnail route, removed by
  // permanent delete).
  thumbnailStore: ThumbnailStore;
  userDirectory: UserDirectory;
}

// The OSS default adapters: Drizzle-over-SQLite repositories + a filesystem
// payload store. Constructed once and shared by every route module so they
// operate on the same backing stores.
export const artefactRepository = new DrizzleArtefactRepository(db);
// S25/S27 — Collections + Bookmarks.
export const collectionRepository = new DrizzleCollectionRepository(db);
export const bookmarkRepository = new DrizzleBookmarkRepository(db);
export const dataRepository = new DrizzleDataRepository(db);
// S21 — Artefact Views: per-(artefact, viewer) last-viewed records.
export const viewRepository = new DrizzleViewRepository(db);
export const payloadStore = new FilesystemPayloadStore(
  env.ARTEFACTOR_PAYLOAD_DIR,
);
// S35 — thumbnails beside the payloads, and the renderer that makes them: none
// when `ARTEFACTOR_THUMBNAILS=off` (cards show the kind placeholder). The browser
// launches lazily on the first render, so constructing it costs nothing.
export const thumbnailStore = new FilesystemThumbnailStore(
  env.ARTEFACTOR_THUMBNAIL_DIR,
);
export const thumbnailRenderer: ThumbnailRenderer | null =
  env.ARTEFACTOR_THUMBNAILS === "on" ? new PlaywrightThumbnailRenderer() : null;
// S12 — host data-context switcher: resolve author ids → name/email for the
// picker label (reads the BetterAuth user table).
export const userDirectory = new DrizzleUserDirectory(db);

// The default set the OSS entry injects into `createApp`.
export const defaultAdapters: Adapters = {
  artefactRepository,
  collectionRepository,
  bookmarkRepository,
  dataRepository,
  viewRepository,
  payloadStore,
  thumbnailStore,
  userDirectory,
};
