import { Hono } from "hono";
import { ArtefactNotFound } from "../../domain/artefact/errors";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import {
  BlobTooLarge,
  DataConflict,
  InvalidBlob,
} from "../../domain/data/errors";
import type { DataRepository } from "../../domain/data/data-repository";
import {
  deleteOwnDataEntry,
  getOwnDataEntry,
  putOwnDataEntry,
  type OwnDataDeps,
} from "../data/own-data.command";
import {
  getAuthorDataEntry,
  listDataAuthors,
} from "../data/author-data.command";
import type { UserDirectory } from "../data/user-directory";
import type { AccessPolicy } from "../../domain/artefact/access";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type {
  DataAuthorsResponse,
  DataEntryResponse,
} from "../../shared/contracts";

export interface DataRoutesDeps {
  artefactRepo: ArtefactRepository;
  // AH20 — the access decision needs the effective tier (collection tree root).
  collectionRepo: CollectionRepository;
  dataRepo: DataRepository;
  userDirectory: UserDirectory;
  // S22 (AH17) — resolves the request's tenant scope for the id-fallback resolve.
  resolveScope: TenantScopeResolver;
  // S22 (AH18) — decides the `authenticated` tier for the slug-resolved artefact.
  accessPolicy?: AccessPolicy;
}

// S11 — Artefact Data: the caller's own blob. Mounted at
// `/api/artefacts/:ref/data`, where `:ref` is the artefact's slug or its id (the
// id form is the alias that gives a never-shared artefact a data store, and is
// what the owner-preview serving path uses). All three require auth (no
// anonymous writes — AD3; reads here are the caller's own entry). Ref resolution
// + the access matrix + archived→404 live in the commands; this module just maps
// the domain outcome to HTTP.
export function createDataRoutes(deps: DataRoutesDeps) {
  const r = new Hono<AuthEnv>();
  const commandDeps: OwnDataDeps = {
    artefactRepo: deps.artefactRepo,
    collectionRepo: deps.collectionRepo,
    dataRepo: deps.dataRepo,
    accessPolicy: deps.accessPolicy,
  };

  // `:ref` comes from the mount path (`/api/artefacts/:ref/data`), so it is
  // always present at runtime though Hono types it as optional.
  const refOf = (c: { req: { param: (k: "ref") => string | undefined } }) =>
    c.req.param("ref") ?? "";

  // S12 — Host data-context switcher. These two reads follow the artefact access
  // matrix, NOT the caller's identity (AD4): a public artefact's authors are
  // readable by anyone, including the anonymous — so they are gated by
  // `canViewArtefact` inside the command, not by `requireAuth`. They exist only
  // to power the host picker; the served artefact never calls them.

  // Authors who have an entry, enriched with name/email for the picker label.
  r.get("/authors", async (c) => {
    try {
      const refs = await listDataAuthors(
        refOf(c),
        c.get("user")?.id ?? null,
        await deps.resolveScope(c),
        commandDeps,
      );
      const identities = await deps.userDirectory.lookup(
        refs.map((a) => a.authorId),
      );
      return c.json<DataAuthorsResponse>({
        authors: refs.map((a) => {
          const who = identities.get(a.authorId);
          return {
            authorId: a.authorId,
            name: who?.name ?? "",
            email: who?.email ?? "",
            updatedAt: a.updatedAt.toISOString(),
          };
        }),
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  // The caller's own entry (AD-table `/data/me`). 200 with `blob: null` when none.
  r.get("/me", requireAuth, async (c) => {
    try {
      const entry = await getOwnDataEntry(
        { ref: refOf(c), authorId: ownerId(c), scope: await deps.resolveScope(c) },
        commandDeps,
      );
      return c.json<DataEntryResponse>({
        blob: entry?.blob ?? null,
        updatedAt: entry?.updatedAt.toISOString() ?? null,
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  // Upsert the caller's blob. The request body is the raw opaque JSON.
  // S31 — optionally conditional: `If-Match: "<updatedAt ISO>"` or
  // `If-None-Match: *` (the served shim always sends one) → 412 when stale.
  r.put("/me", requireAuth, async (c) => {
    const blob = await c.req.text();
    const precondition = parsePrecondition(
      c.req.header("If-Match"),
      c.req.header("If-None-Match"),
    );
    if (precondition === "invalid") {
      return c.json({ error: "If-Match must be a quoted ISO-8601 updatedAt" }, 400);
    }
    try {
      const entry = await putOwnDataEntry(
        { ref: refOf(c), authorId: ownerId(c), scope: await deps.resolveScope(c) },
        blob,
        commandDeps,
        { ifUnmodifiedSince: precondition },
      );
      return c.json<DataEntryResponse>({
        blob: entry.blob,
        updatedAt: entry.updatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      if (err instanceof InvalidBlob) return c.json({ error: err.message }, 400);
      if (err instanceof BlobTooLarge) return c.json({ error: err.message }, 413);
      if (err instanceof DataConflict) return c.json({ error: err.message }, 412);
      throw err;
    }
  });

  // Remove the caller's entry.
  r.delete("/me", requireAuth, async (c) => {
    try {
      await deleteOwnDataEntry(
        { ref: refOf(c), authorId: ownerId(c), scope: await deps.resolveScope(c) },
        commandDeps,
      );
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  // S12 — Load one author's blob for the host switcher to re-seed the artefact
  // read-only. Defined last so the static `/me` and `/authors` routes win. Like
  // `/authors`, gated by the access matrix (AD4), not `requireAuth`.
  r.get("/:authorId", async (c) => {
    try {
      const entry = await getAuthorDataEntry(
        refOf(c),
        c.get("user")?.id ?? null,
        c.req.param("authorId")!,
        await deps.resolveScope(c),
        commandDeps,
      );
      return c.json<DataEntryResponse>({
        blob: entry?.blob ?? null,
        updatedAt: entry?.updatedAt.toISOString() ?? null,
      });
    } catch (err) {
      if (err instanceof ArtefactNotFound) return c.notFound();
      throw err;
    }
  });

  return r;
}

// S31 — map the conditional-request headers onto the command's pin.
// `If-Match: "<ISO updatedAt>"` → that instant; `If-None-Match: *` → null ("no
// entry expected"); neither → undefined (unconditional). An If-Match that is not
// a quoted timestamp is rejected rather than silently written unconditionally.
function parsePrecondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined,
): Date | null | undefined | "invalid" {
  if (ifMatch !== undefined) {
    const m = /^"([^"]+)"$/.exec(ifMatch.trim());
    const at = m ? new Date(m[1]!) : null;
    return at && !Number.isNaN(at.getTime()) ? at : "invalid";
  }
  if (ifNoneMatch?.trim() === "*") return null;
  return undefined;
}
