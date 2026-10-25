import { Hono } from "hono";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { CollectionNotFound } from "../../domain/collection/errors";
import { readPublicCollectionTree } from "../collections/public-tree.query";
import type { AuthEnv } from "../middleware/auth";
import type { PublicCollectionResponse } from "../../shared/contracts";

export interface PublicCollectionRoutesDeps {
  collectionRepo: CollectionRepository;
  artefactRepo: ArtefactRepository;
}

// S44 — the anonymous read of a public collection tree, for a site built
// without a login. Mounted under `/api/public`, and deliberately **without**
// `requireAuth`: the answer is the same with or without a session. Every
// failure is one flat 404 (`collections.public-link.anonymous-tree-read`), and a
// tree may be cached publicly for five minutes, so it stops being served soon
// after its root leaves `public`.
// r[impl collections.url.public-tree-read+2]
export function createPublicCollectionRoutes(deps: PublicCollectionRoutesDeps) {
  const r = new Hono<AuthEnv>();

  r.get("/:slug", async (c) => {
    try {
      const tree = await readPublicCollectionTree(c.req.param("slug"), deps);
      c.header("Cache-Control", "public, max-age=300");
      return c.json<PublicCollectionResponse>(tree);
    } catch (err) {
      if (err instanceof CollectionNotFound) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // A path under this prefix that names no single slug (a trailing slash, the
  // bare prefix, an extra segment) is the same 404, never the SPA's HTML.
  r.all("*", (c) => c.json({ error: "not found" }, 404));

  return r;
}
