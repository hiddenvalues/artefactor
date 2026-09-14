import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";
import { defaultAdapters, thumbnailRenderer } from "./adapters";
import { ThumbnailService } from "./thumbnails/thumbnail-service";

// S35 — the in-process thumbnail queue: create/edit enqueue into it, and the
// startup sweep backfills whatever is missing or stale.
const thumbnails = new ThumbnailService({
  repo: defaultAdapters.artefactRepository,
  payloadStore: defaultAdapters.payloadStore,
  thumbnailStore: defaultAdapters.thumbnailStore,
  renderer: thumbnailRenderer,
});

const app = createApp(
  defaultAdapters,
  undefined,
  undefined,
  undefined,
  undefined,
  thumbnails,
);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `Artefactor listening on http://localhost:${info.port} (${env.NODE_ENV})`,
  );
});

void thumbnails.start();
