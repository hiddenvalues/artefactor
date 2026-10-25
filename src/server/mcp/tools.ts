import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ARTEFACT_KINDS } from "../../domain/artefact/kind";
import { DATA_VISIBILITIES, VISIBILITIES } from "../../domain/artefact/visibility";
import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { loadArtefactRoot } from "../collections/effective";
import { effectiveVisibility } from "../../domain/collection/effective-access";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { PayloadStore } from "../../domain/artefact/ports";
import type { DataRepository } from "../../domain/data/data-repository";
import {
  ArtefactConflict,
  ArtefactNotFound,
  LinkGateChallenge,
  InvariantViolation,
} from "../../domain/artefact/errors";
import { createArtefactCommand } from "../artefacts/create-artefact.command";
import { editArtefactCommand } from "../artefacts/edit-artefact.command";
import { setArtefactVisibilityCommand } from "../artefacts/set-visibility.command";
import { setDataVisibilityCommand } from "../artefacts/set-data-visibility.command";
import {
  archiveArtefactCommand,
  restoreArtefactCommand,
} from "../artefacts/lifecycle.command";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { loadOwnCollection } from "../collections/get-own-collection";
import { moveArtefactCommand } from "../collections/move-artefact.command";
import { listPlaceableCollections } from "../collections/placeable-collections.query";
import {
  createCollectionCommand,
  editCollectionCommand,
} from "../collections/collections.command";
import {
  archiveCollectionCommand,
  restoreCollectionCommand,
} from "../collections/lifecycle.command";
import type { Collection } from "../../domain/collection/collection";
import { chainToRoot } from "../../domain/collection/tree";
import { toCollectionSummary } from "../routes/collections";
import {
  CollectionInvariantViolation,
  CollectionNotFound,
} from "../../domain/collection/errors";
import { getOwnDataEntry, putOwnDataEntry } from "../data/own-data.command";
import {
  getAuthorDataEntry,
  listDataAuthors,
} from "../data/author-data.command";
import type { UserDirectory, UserIdentity } from "../data/user-directory";
import type { DataAuthorRef } from "../../domain/data/data-repository";
import { MAX_BLOB_BYTES } from "../../domain/data/data-entry";
import {
  BlobTooLarge,
  DataConflict,
  InvalidBlob,
} from "../../domain/data/errors";
import { extractDeclaredSchema } from "../../domain/data/declared-schema";
import { toArtefactSummary } from "../routes/artefacts";
import { loadAuthoringGuide } from "./authoring-guide";
import { env } from "../env";
import type { ThumbnailQueue } from "../thumbnails/thumbnail-service";
import { shareLinkPath } from "../../shared/share-link";

// S18 — the MCP tool surface. Each tool is a thin adapter over the existing
// Hosting / Data application commands, attributed to the OAuth token's Account
// (`userId`). The tools add NO new authority: every invariant (ownership,
// access matrix, kind/payload/blob bounds) is enforced by the same commands the
// BFF uses. See docs/specs/fdd/slice-dag.md S18.

export interface McpToolDeps {
  repo: ArtefactRepository;
  // S25 (hosting.access.effective-from-tree-root) — summaries report the *effective* tier and link
  // reachability, which for a contained artefact comes from its collection tree root.
  collectionRepo: CollectionRepository;
  payloadStore: PayloadStore;
  dataRepo: DataRepository;
  // S40 — names/emails for the author listing and for resolving `author` by
  // email, as the host switcher's `/data/authors` route does.
  userDirectory: UserDirectory;
  // S35 — create/update enqueue a thumbnail render through the same commands.
  thumbnails?: ThumbnailQueue;
}

// S30 — caps on what a read-back tool may return. An MCP result lands in the
// model's context, but payloads are capped at 100 MB
// (hosting.payload.size-bounds) and blobs at 5 MB (data.blob.bounded-opaque-json) — orders of magnitude
// more than a context can take. Each tool therefore hard-errors above its cap,
// naming the real byte size and pointing at the GUI download, rather than
// truncating: truncated HTML is unusable for editing and truncated JSON is
// unparseable, and either invites the model to act on a fragment as though it
// were whole. (Same shape of refusal as create_artefact's base64-raster-image
// rule.)
// r[impl mcp.read.over-cap-refused+2]
export const MAX_MCP_HTML_BYTES = 1024 * 1024; // 1 MB
export const MAX_MCP_BLOB_BYTES = 256 * 1024; // 256 KB

// A read-back result that is too big to put in the model's context. Carried as
// an error so it reaches the model as an `isError` result it can act on.
class ResultTooLarge extends Error {}

// S31 — a write the domain refused (bad blob, stale pin), restated with the
// detail the model needs to correct its input.
class ToolInputRejected extends Error {}

// The JSON parser's own message for an unparseable blob — what `InvalidBlob`
// deliberately does not carry.
function jsonParseError(text: string): string {
  try {
    JSON.parse(text);
    return "unknown parse error";
  } catch (e) {
    return (e as Error).message;
  }
}

// An MCP tool result wrapping a JSON value as text content.
function ok(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

// A failed tool call. Domain rejections (bad input, not-found, blob errors) are
// surfaced to the model as `isError` text so it can adjust, rather than crashing
// the connection. Unexpected errors propagate (becoming a protocol error).
function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// Map an artefact to the summary the BFF returns, plus the shareable URL when it
// is actually reachable by link (a slug exists and the **effective** tier is not
// private — a contained artefact is served under its collection tree root's
// access, hosting.access.effective-from-tree-root, and the slug 404s while effectively private).
// S32a — `viewerId` is the token's Account: the owner's summaries carry
// `linkGate` (never the hash), anyone else's never do.
function makeSummarize(deps: McpToolDeps, viewerId: string) {
  return async function summarize(a: Artefact) {
    const effVis = effectiveVisibility(
      a,
      await loadArtefactRoot(a, deps.collectionRepo),
    );
    const summary = toArtefactSummary(a, effVis, viewerId);
    const url =
      a.publicSlug && effVis !== "private"
        ? `${env.BETTER_AUTH_URL}${shareLinkPath(a.publicSlug)}`
        : null;
    return { ...summary, url };
  };
}

// S40 — resolve `get_artefact_data`'s `author` against the authors who hold an
// entry: an exact id, else a case-insensitive email among those authors only.
// A registered user without an entry is therefore refused exactly like an
// unknown value, so the tool is no email-existence probe.
// r[impl mcp.authors.resolve-author]
// r[impl mcp.authors.no-email-probe+2]
async function resolveDataAuthor(
  refs: DataAuthorRef[],
  author: string,
  directory: UserDirectory,
): Promise<{ id: string } & UserIdentity> {
  const identities = await directory.lookup(refs.map((r) => r.authorId));
  const wanted = author.toLowerCase();
  const id =
    refs.find((r) => r.authorId === author)?.authorId ??
    refs.find((r) => identities.get(r.authorId)?.email.toLowerCase() === wanted)
      ?.authorId;
  if (id === undefined) {
    throw new ToolInputRejected(
      `No user with saved data on this artefact matches '${author}'. Call list_artefact_data_authors to see who has data.`,
    );
  }
  const who = identities.get(id);
  return { id, name: who?.name ?? "", email: who?.email ?? "" };
}

// Run a tool body, translating known domain errors into `isError` results.
// r[impl mcp.tools.refusal-is-error-result]
async function run<T>(body: () => Promise<T>) {
  try {
    return ok(await body());
  } catch (err) {
    // S60 — the save lost the race on every retry; the model rereads and retries.
    // r[impl mcp.tools.save-conflict]
    if (err instanceof ArtefactConflict) {
      return fail(
        "The artefact changed while this was being saved. Read it again with get_artefact, then retry.",
      );
    }
    // S75/S76 — one refusal for every collection argument the caller can't use (a move target,
    // a parent, a write's id), echoing only the id, so it never tells whether the collection
    // exists (collections.access.no-existence-leak).
    // r[impl mcp.collections.target-refusal+2]
    if (err instanceof CollectionNotFound) {
      return fail(
        `No collection '${err.message}' that you can use here. Call list_collections to find one: you can place an artefact into any listed collection, and create under or change only your own (own: true). Archived collections aren't listed: restore one by the id archive_collection returned.`,
      );
    }
    if (
      err instanceof ArtefactNotFound ||
      err instanceof LinkGateChallenge ||
      err instanceof InvariantViolation ||
      err instanceof CollectionInvariantViolation ||
      err instanceof ResultTooLarge ||
      err instanceof ToolInputRejected
    ) {
      return fail(err.message);
    }
    throw err;
  }
}

// r[impl mcp.tools.surface+4]
export function registerArtefactTools(
  server: McpServer,
  userId: string,
  deps: McpToolDeps,
  scope: TenantScope,
): void {
  const { repo, payloadStore, dataRepo, thumbnails } = deps;
  const dataDeps = {
    artefactRepo: repo,
    collectionRepo: deps.collectionRepo,
    dataRepo,
  };
  const summarize = makeSummarize(deps, userId);

  // Artefacts accumulate per-user data blobs (what the running artefact reads /
  // writes via localStorage). The backend treats those blobs as opaque, so it
  // cannot tell whether an HTML change breaks the data shape — that is the
  // author's call. We surface how many authors already hold data (`dataAuthorCount`)
  // so the model can warn and suggest bumping the storage-key version or
  // publishing a new artefact (v2) on a breaking change. See the authoring skill.
  // r[impl mcp.tools.data-author-count]
  const withDataCount = async (a: Artefact) => ({
    ...(await summarize(a)),
    dataAuthorCount: (await dataRepo.listAuthorsByArtefact(a.id)).length,
  });

  server.registerTool(
    "create_artefact",
    {
      title: "Create artefact",
      description:
        "Publish a self-contained HTML artefact to Artefactor. Returns the new artefact (id, slug, url — the share link, null while private — and appUrl, the Artefactor web app where the owner opens it). Always leave visibility unset: create it private, verify the published result, then share it with set_visibility at the tier the user asked for — even when they asked for a shared tier up front. Never share just to get a link — give the user appUrl instead. The HTML must follow Artefactor's persistence contract so any data it saves survives — persist only through localStorage (which Artefactor hijacks to a server-side store). Do NOT use this for an artefact with embedded raster images (PNG/JPEG as base64 data: URIs or binary): base64 image bytes can't be sent reliably through a tool call and will be truncated/corrupted — instead offer the user SVG/CSS visuals (publishable here) or manual upload of the self-contained file. Call get_authoring_guide if unsure.",
      inputSchema: {
        title: z.string().min(1).describe("Human-readable title."),
        kind: z
          .enum(ARTEFACT_KINDS)
          .describe("Artefact kind (metadata for grouping)."),
        html: z
          .string()
          .min(1)
          .describe("The complete HTML document, served as-is."),
        visibility: z
          .enum(VISIBILITIES)
          .optional()
          .describe(
            "private (owner only), authenticated (any signed-in user), public (anyone with the link), or selected. Default private. Leave it unset: create private, verify, then share with set_visibility — even when the user asked for a shared tier up front; public only when they asked for public.",
          ),
      },
    },
    // r[impl mcp.tools.create-app-url]
    async ({ title, kind, html, visibility }) =>
      run(async () => {
        const withAppUrl = async (a: Artefact) => ({
          ...(await summarize(a)),
          appUrl: `${env.BETTER_AUTH_URL}/`,
        });
        const created = await createArtefactCommand(
          {
            ownerId: userId,
            title,
            kind,
            payload: new TextEncoder().encode(html),
            tenantId: scope.tenantId,
          },
          { repo, payloadStore, thumbnails },
        );
        if (!visibility || visibility === "private") return withAppUrl(created);
        // Fold the initial share into create as one logical operation: if the
        // share fails, roll the just-created artefact back so the tool is
        // all-or-nothing. (Leaving an orphaned private artefact behind would make
        // a retrying client create duplicates.) No data entries exist yet.
        try {
          const shared = await setArtefactVisibilityCommand(
            { artefactId: created.id, requesterId: userId, visibility, scope },
            { repo },
          );
          return withAppUrl(shared);
        } catch (err) {
          await repo.delete(created.id).catch(() => {});
          await payloadStore.delete(created.payloadRef).catch(() => {});
          throw err;
        }
      }),
  );

  server.registerTool(
    "update_artefact",
    {
      title: "Update artefact",
      description:
        "Replace the title, kind, and/or HTML of an existing artefact you own (HTML is a full replacement, not a patch). As with create_artefact, do NOT send HTML containing embedded raster images (base64/binary PNG/JPEG) — it can't be carried reliably through a tool call; use SVG/CSS visuals or manual upload instead. Existing per-user data blobs are left untouched. The result includes dataAuthorCount: if it is > 0 and your HTML change alters the data shape the artefact reads from localStorage, that saved data may be misread — bump the artefact's storage-key version (so old data is ignored) or publish a new artefact (a v2) instead of editing in place.",
      inputSchema: {
        id: z.string().min(1).describe("The artefact id."),
        title: z.string().min(1).optional(),
        kind: z.enum(ARTEFACT_KINDS).optional(),
        html: z
          .string()
          .min(1)
          .optional()
          .describe("New complete HTML document (full replace)."),
      },
    },
    async ({ id, title, kind, html }) =>
      run(async () => {
        const updated = await editArtefactCommand(
          {
            artefactId: id,
            requesterId: userId,
            scope,
            title,
            kind,
            // r[impl mcp.tools.update-replaces-html]
            payload: html === undefined ? undefined : new TextEncoder().encode(html),
          },
          { repo, payloadStore, thumbnails },
        );
        return withDataCount(updated);
      }),
  );

  server.registerTool(
    "list_artefacts",
    {
      title: "List artefacts",
      description:
        "List the artefacts you own, most-recently-updated first. Archived ones are hidden unless include_archived is true.",
      inputSchema: {
        include_archived: z.boolean().optional(),
      },
    },
    async ({ include_archived }) =>
      run(async () => {
        const owned = await repo.listByOwner(userId, scope, {
          includeArchived: include_archived ?? false,
        });
        return { artefacts: await Promise.all(owned.map(summarize)) };
      }),
  );

  server.registerTool(
    "get_artefact",
    {
      title: "Get artefact",
      description:
        "Get one of your active artefacts by id (metadata, share URL, and dataAuthorCount — how many users have saved data). Unknown / not yours / archived → not found. Check dataAuthorCount before a breaking update.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, {
          id,
          ownerId: userId,
          scope,
        });
        return withDataCount(a);
      }),
  );

  // S30 — read-back. Until now an agent could write artefacts but never read one,
  // which blocks two things: (A) deriving a new artefact from an existing one,
  // and (B) updating one in place after losing the original from context. (B) is
  // a correctness problem, not a convenience: `update_artefact` replaces the HTML
  // and leaves every per-user data blob untouched, and the backend treats blobs
  // as opaque (data.blob.bounded-opaque-json), so it cannot migrate them — only the author's own HTML can.
  // Both tools are owner-scoped via `loadOwnActiveArtefact`, like every other
  // tool here: unknown / not yours / archived / out-of-scope → not found.

  server.registerTool(
    "get_artefact_html",
    {
      title: "Get artefact HTML",
      description:
        "Return the stored HTML of one of your active artefacts, exactly as served. Use it to derive a new artefact from an existing one, or to re-read an artefact you are about to update after losing the original from context (update_artefact replaces the HTML wholesale, so you need the current source to change it safely). Also returns dataAuthorCount — if it is > 0, call get_artefact_data before any change to the data shape. Refuses an artefact whose HTML is too large for a tool result; download that one from the Artefactor web app instead.",
      inputSchema: { id: z.string().min(1).describe("The artefact id.") },
    },
    async ({ id }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        if (a.payloadBytes > MAX_MCP_HTML_BYTES) {
          throw new ResultTooLarge(
            `This artefact's HTML is ${a.payloadBytes} bytes, over the ${MAX_MCP_HTML_BYTES}-byte limit for a tool result. It is not truncated, because partial HTML cannot be edited safely — download the file from the Artefactor web app ("Download HTML" on the artefact) and work from that instead.`,
          );
        }
        // r[impl mcp.read.html-exact]
        const html = new TextDecoder().decode(
          await payloadStore.get(a.payloadRef),
        );
        return {
          id: a.id,
          title: a.title,
          kind: a.kind,
          html,
          dataAuthorCount: (await dataRepo.listAuthorsByArtefact(a.id)).length,
        };
      }),
  );

  server.registerTool(
    "get_artefact_data",
    {
      title: "Get artefact data snapshot",
      description:
        "Return saved data for one of your active artefacts, verbatim, plus the data shape the artefact declares for itself. Without `author` it returns YOUR OWN entry; with `author` (a user id or email from list_artefact_data_authors) it returns that user's entry plus `author: { id, name, email }` — to get everyone's data, call list_artefact_data_authors, then this tool once per author, and aggregate on your side. Another user's entry is READ-ONLY: set_artefact_data only ever writes your own, so never try to \"fix\" someone else's data. Read this before an HTML change that alters the shape the artefact reads from localStorage: `schema` is the artefact's own declaration (trust it for orientation, verify it against the HTML before acting — nothing enforces that they agree), `blob` is the entry (null if there is none), and `dataAuthorCount` says how many users hold data in total. Each read is ONE user's blob, not the population: entries may sit on older key versions, be partial, or have been written by HTML two revisions back, so any migration or aggregate must tolerate shapes you never saw. Compare authoredAgainstVersion with currentPayloadVersion to judge staleness (null = unknown, treat as possibly stale). Refuses a blob too large for a tool result.",
      inputSchema: {
        id: z.string().min(1).describe("The artefact id."),
        author: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Whose entry to read: a user id or email as listed by list_artefact_data_authors. Omit for your own.",
          ),
      },
    },
    async ({ id, author }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        // Through the same commands the BFF uses — returned verbatim, never
        // summarised (data.blob.bounded-opaque-json opacity). Without `author`, the caller's OWN entry
        // (data.write.author-is-caller); with it (S40), any author's, as the host
        // switcher loads it for the owner (data.read.follows-artefact-access) — read-only,
        // nothing here writes it (data.write.own-context-only).
        let named: ({ id: string } & UserIdentity) | undefined;
        let entry;
        if (author === undefined) {
          // r[impl mcp.read.own-entry-default]
          entry = await getOwnDataEntry(
            { ref: a.id, authorId: userId, scope },
            dataDeps,
          );
        } else {
          named = await resolveDataAuthor(
            await listDataAuthors(a.id, userId, scope, dataDeps),
            author,
            deps.userDirectory,
          );
          entry = await getAuthorDataEntry(a.id, userId, named.id, scope, dataDeps);
        }
        const bytes = entry
          ? new TextEncoder().encode(entry.blob).byteLength
          : 0;
        // r[impl mcp.authors.over-cap-refused+2]
        if (bytes > MAX_MCP_BLOB_BYTES) {
          const whose =
            named && named.id !== userId
              ? `This user's (${named.email || named.id}) saved data`
              : "Your saved data";
          throw new ResultTooLarge(
            `${whose} for this artefact is ${bytes} bytes, over the ${MAX_MCP_BLOB_BYTES}-byte limit for a tool result. It is not truncated, because partial JSON cannot be parsed — inspect it from the artefact itself, or download the artefact from the Artefactor web app.`,
          );
        }
        // The declared schema is lifted from the trusted HTML as a string, the
        // same class of operation as locating <head> to inject the bootstrap.
        // The server forwards it and NEVER validates a blob against it.
        const schema = extractDeclaredSchema(
          new TextDecoder().decode(await payloadStore.get(a.payloadRef)),
        );
        return {
          id: a.id,
          blob: entry?.blob ?? null,
          bytes,
          // Returned so a later write can be pinned against it (S31/ALI-268);
          // without it an agent's write blindly overwrites whatever the user has
          // saved since.
          updatedAt: entry?.updatedAt.toISOString() ?? null,
          dataAuthorCount: (await dataRepo.listAuthorsByArtefact(a.id)).length,
          schema,
          // Two version notions, deliberately kept apart (data.pin.stamped-on-write): the *mechanical*
          // pin below is the payload hash the backend stamps on a write, while
          // the schema's own `version` is *semantic* and author-declared.
          // r[impl mcp.read.version-pair+2]
          currentPayloadVersion: a.payloadHash,
          // Stamped by every `putOwnDataEntry` write (S19a). null ⇒ no entry, or
          // one written before the pin existed — unknown, treat as possibly
          // stale; ≠ current ⇒ written against older HTML, migration owed;
          // = current ⇒ matches what is deployed.
          authoredAgainstVersion: entry?.authoredAgainstVersion ?? null,
          // S40 — only when `author` was named, so the own read keeps its shape.
          ...(named ? { author: named } : {}),
        };
      }),
  );

  // S40 — who holds saved data on one of the owner's artefacts: identity, the
  // stored size, freshness and version pin per author — never a blob. The
  // entries themselves are fetched one at a time with `get_artefact_data`, since
  // 5 MB blobs × N authors cannot fit one tool result. Owner-scoped like every
  // tool here, though data.read.follows-artefact-access would let any viewer read (the S31 follow-up).
  server.registerTool(
    "list_artefact_data_authors",
    {
      title: "List artefact data authors",
      description:
        "List every user who has saved data on one of your active artefacts (including you, if you have), newest first: authorId, name, email, bytes (the stored size), updatedAt and authoredAgainstVersion. No data is returned here — to get everyone's data, call get_artefact_data with `author` set to each authorId, one at a time, and aggregate on your side. Entries may be on older storage-key versions or written by older HTML: compare each authoredAgainstVersion with currentPayloadVersion (null = unknown, possibly stale) and tolerate shapes that differ per author. Names, emails and answers are personal data you are reading on the owner's behalf — report them to the owner, don't republish them into an artefact.",
      inputSchema: { id: z.string().min(1).describe("The artefact id.") },
    },
    async ({ id }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        const refs = await listDataAuthors(a.id, userId, scope, dataDeps);
        const identities = await deps.userDirectory.lookup(
          refs.map((r) => r.authorId),
        );
        return {
          id: a.id,
          currentPayloadVersion: a.payloadHash,
          // r[impl mcp.authors.listing+2]
          authors: [...refs]
            .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
            .map((r) => {
              const who = identities.get(r.authorId);
              return {
                authorId: r.authorId,
                name: who?.name ?? "",
                email: who?.email ?? "",
                bytes: r.bytes,
                updatedAt: r.updatedAt.toISOString(),
                authoredAgainstVersion: r.authoredAgainstVersion,
              };
            }),
        };
      }),
  );

  // S31 — the write half of the read-modify-write loop. Not the dropped S17: the
  // agent reads the WHOLE blob, transforms it in the session, and writes the
  // WHOLE blob back through the same `putOwnDataEntry` as `PUT …/data/me`, which
  // parses only to enforce data.blob.bounded-opaque-json. The server still never interprets the blob. The
  // author is always the token's user (data.write.author-is-caller, data.write.requires-auth) — there is no way to name
  // another author's entry. Owner-scoped like the read tools, so the write never
  // reaches further than the read it depends on.
  server.registerTool(
    "set_artefact_data",
    {
      title: "Set artefact data",
      description:
        "Replace YOUR OWN saved data for one of your active artefacts. WHOLE-BLOB REPLACEMENT: the blob you send becomes the entire saved dataset — this is not a patch and nothing is merged, so any key you leave out is deleted. Always call get_artefact_data first, transform the full blob, send all of it back, and pass the updatedAt you read as if_unmodified_since (null if you read no entry) so a save the user made in the meantime is not silently overwritten — an artefact merely open in their browser doesn't count, it only saves on a real edit. The blob is a JSON object mapping localStorage keys to string values (≤ 5 MB). There is no undo: keep the previous blob so you can revert, tell the user what will change before writing, and verify a shape you took from the declared schema against get_artefact_html. Afterwards, tell the user to reload the artefact if they have it open — it only shows your change after a reload. Writing {} clears your data. Returns { id, bytes, updatedAt }.",
      inputSchema: {
        id: z.string().min(1).describe("The artefact id."),
        blob: z
          .string()
          .describe(
            "The complete JSON text to store — replaces the whole entry.",
          ),
        if_unmodified_since: z
          .string()
          .datetime()
          .nullable()
          .optional()
          .describe(
            "The updatedAt returned by get_artefact_data (null if it returned no entry). The write is refused if your saved data changed since. Omit to overwrite unconditionally.",
          ),
      },
    },
    async ({ id, blob, if_unmodified_since }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        const bytes = new TextEncoder().encode(blob).byteLength;
        try {
          // r[impl mcp.data-write.round-trip+2]
          const entry = await putOwnDataEntry(
            { ref: a.id, authorId: userId, scope },
            blob,
            { artefactRepo: repo, collectionRepo: deps.collectionRepo, dataRepo },
            {
              // r[impl mcp.data-write.no-pin-unconditional+2]
              ifUnmodifiedSince:
                if_unmodified_since === undefined
                  ? undefined
                  : if_unmodified_since === null
                    ? null
                    : new Date(if_unmodified_since),
            },
          );
          return {
            id: a.id,
            bytes,
            updatedAt: entry.updatedAt.toISOString(),
          };
        } catch (err) {
          // The domain errors are phrased for the HTTP route; the model needs
          // the specifics to fix its input, so they are restated here.
          // r[impl mcp.data-write.refusal-names-fix]
          if (err instanceof BlobTooLarge) {
            throw new ToolInputRejected(
              `The blob is ${bytes} bytes, over the ${MAX_BLOB_BYTES}-byte (5 MB) cap for saved data. Nothing was written.`,
            );
          }
          if (err instanceof InvalidBlob) {
            throw new ToolInputRejected(
              `The blob is not valid JSON (${jsonParseError(blob)}). Nothing was written.`,
            );
          }
          if (err instanceof DataConflict) {
            throw new ToolInputRejected(
              `${err.message} Re-read it with get_artefact_data, re-apply your change to that blob, and write again with the new updatedAt.`,
            );
          }
          throw err;
        }
      }),
  );

  server.registerTool(
    "set_visibility",
    {
      title: "Set artefact visibility",
      description:
        "Only on the user's request: say who will be able to open it before sharing, and set public only when they asked for public. Share or unshare an artefact. A shareable tier mints (and retains) a slug; private retains the slug but the link 404s. Changing a public artefact to any other tier clears its link protection (password and expiry). Link protection is set only in the Artefactor web app, never over this connector.",
      inputSchema: {
        id: z.string().min(1),
        visibility: z.enum(VISIBILITIES),
      },
    },
    async ({ id, visibility }) =>
      run(async () => {
        const updated = await setArtefactVisibilityCommand(
          { artefactId: id, requesterId: userId, visibility, scope },
          { repo },
        );
        return summarize(updated);
      }),
  );

  // S41 (hosting.data-visibility.owner-set, data.visibility.narrows-reads) — owner-set data visibility. Owner, active and in
  // scope, like every other tool: anything else is not found.
  server.registerTool(
    "set_data_visibility",
    {
      title: "Set data visibility",
      description:
        "Choose whether viewers of an artefact can load each other's saved data (\"shared\") or only their own (\"own\"; the owner always sees everyone's). New artefacts start \"own\" — keep it for surveys and forms, where respondents shouldn't read each other's answers.",
      inputSchema: {
        id: z.string().min(1),
        dataVisibility: z.enum(DATA_VISIBILITIES),
      },
    },
    async ({ id, dataVisibility }) =>
      run(async () => {
        await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        const updated = await setDataVisibilityCommand(
          { artefactId: id, requesterId: userId, dataVisibility, scope },
          { repo },
        );
        return summarize(updated);
      }),
  );

  server.registerTool(
    "archive_artefact",
    {
      title: "Archive artefact",
      description: "Soft-delete (archive) an active artefact you own.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) =>
      run(async () => {
        const updated = await archiveArtefactCommand(
          { artefactId: id, requesterId: userId, scope },
          { repo },
        );
        return summarize(updated);
      }),
  );

  server.registerTool(
    "restore_artefact",
    {
      title: "Restore artefact",
      description: "Restore an archived artefact to active at its prior tier.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) =>
      run(async () => {
        const updated = await restoreArtefactCommand(
          { artefactId: id, requesterId: userId, scope },
          { repo },
        );
        return summarize(updated);
      }),
  );

  // S75 — placement. `list_collections` reads the targets `move_artefact` accepts; the move runs
  // the app's own command, so ownership, contribution, tenant, lifecycle and slug minting hold
  // exactly as on `PUT /api/artefacts/:id/collection`.
  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the collections you can place an artefact into: your own, and those of trees shared with you as a contributor. Each row has id, name, parentId, path (the names from the tree root down), own, and visibility — the tier an artefact placed there is served under. Use it to find the collection_id for move_artefact, and — among your own rows (own: true) — the parent_id for create_collection and the id for the other collection tools.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const rows = await listPlaceableCollections(userId, scope, {
          collectionRepo: deps.collectionRepo,
        });
        return {
          collections: rows.map(({ collection, path, own, visibility }) => ({
            id: collection.id,
            name: collection.name,
            parentId: collection.parentId,
            path,
            own,
            visibility,
          })),
        };
      }),
  );

  server.registerTool(
    "move_artefact",
    {
      title: "Move artefact",
      description:
        "Put one of your active artefacts into a collection, move it to another, or take it back to top level with collection_id null. Find the collection_id with list_collections. A move changes how the artefact is served: inside a collection it takes the tree's visibility and link protection (password, expiry), at top level its own. So a move can SHARE it and mint its link (a collection whose visibility is not private), stop a working link (a private collection, or top level when its own tier is private), or add or drop link protection — tell the user before any of these. Returns the artefact's summary with its new collectionId and effectiveVisibility.",
      inputSchema: {
        id: z.string().min(1).describe("The artefact id."),
        collection_id: z
          .string()
          .min(1)
          .nullable()
          .describe("The target collection's id, or null for top level."),
      },
    },
    async ({ id, collection_id }) =>
      run(async () => {
        // r[impl mcp.collections.move-runs-command]
        const moved = await moveArtefactCommand(
          { artefactId: id, requesterId: userId, collectionId: collection_id, scope },
          { artefactRepo: repo, collectionRepo: deps.collectionRepo },
        );
        return withDataCount(moved);
      }),
  );

  registerCollectionWriteTools(server, userId, deps, scope);

  // S18 — the authoring skill, on demand. Clients that can use the connector but
  // can't load Agent Skills (e.g. Claude design) read the FULL contract here:
  // how to write HTML that persists (the localStorage rules, a template, the
  // shipping checklist) and how to publish / handle breaking data-shape changes.
  // The server `instructions` carry the compact summary; this is the manual.
  server.registerTool(
    "get_authoring_guide",
    {
      title: "Get authoring guide",
      description:
        "Return the full Artefactor authoring guide: how to write HTML whose data persists (the localStorage contract, a ready-to-use template, the shipping checklist) and how to publish/update/share + handle breaking data-shape changes. Read this before writing or updating an artefact's HTML.",
      inputSchema: {},
    },
    async () => {
      try {
        return {
          content: [
            // r[impl mcp.guide.full-guide-tool]
            { type: "text" as const, text: await loadAuthoringGuide() },
          ],
        };
      } catch {
        // The guide file is missing/unreadable — fall back to the compact
        // contract the server already advertises rather than erroring out, so
        // the model still gets the rules that matter.
        return fail(
          "The full authoring guide is unavailable. Follow the persistence contract in the connector's instructions: persist only via localStorage (one versioned JSON key), wrap every read/write in try/catch with an in-memory fallback, stay under 5 MB, and debounce frequent writes.",
        );
      }
    },
  );
}

// S76 — the agent builds and manages its own collection trees. Each tool runs the app's own
// command for the token's Account, so ownership, tree shape, slug minting and back-fill and the
// lifecycle cascades hold exactly as on the `/api/collections` routes. People, contributors, link
// protection and permanent deletion have no tool: they stay in the web app.
// r[impl mcp.collections.writes-run-commands]
function registerCollectionWriteTools(
  server: McpServer,
  userId: string,
  deps: McpToolDeps,
  scope: TenantScope,
): void {
  const commandDeps = { collectionRepo: deps.collectionRepo, artefactRepo: deps.repo };

  // The owner's summary plus the names from the tree root down, as `list_collections` gives them.
  // `visibility` is the tier the collection is served under — its tree root's
  // (collections.access.root-governs-tree) — never a nested row's unused stored one.
  const summarize = async (collection: Collection) => {
    const own = toCollectionSummary(collection, userId);
    if (collection.parentId === null) return { ...own, path: [collection.name] };
    const tree = await deps.collectionRepo.listByOwner(collection.ownerId, scope, {
      includeArchived: true,
    });
    const ancestors = chainToRoot(tree, collection.parentId).reverse();
    const root = ancestors[0];
    return {
      ...own,
      ...(root ? { visibility: root.visibility } : {}),
      path: [...ancestors.map((c) => c.name), collection.name],
    };
  };

  // r[impl mcp.collections.archive-reports-cascade]
  const withCascade = async (result: {
    collection: Collection;
    cascade: { collections: number; artefacts: number; evicted: number };
  }) => ({ collection: await summarize(result.collection), cascade: result.cascade });

  server.registerTool(
    "create_collection",
    {
      title: "Create collection",
      description:
        "Create a collection you own: a top-level one, or one under parent_id — your own collection, found with list_collections. A top-level collection's visibility governs its whole tree and defaults to private; a shared tier mints its link. A nested one takes its root's tier, so visibility with parent_id is refused. \"selected\" shares with no one until the user adds people in the Artefactor web app. Returns the collection's summary with its path; its visibility is the tier it is served under (its tree root's).",
      inputSchema: {
        name: z.string().describe("The collection's name."),
        parent_id: z
          .string()
          .min(1)
          .optional()
          .describe("Your own collection to create this under; omit for top level."),
        visibility: z
          .enum(VISIBILITIES)
          .optional()
          .describe("Top level only: the tier the whole tree is served under."),
        description: z.string().optional().describe("An optional short description."),
      },
    },
    async ({ name, parent_id, visibility, description }) =>
      run(async () => {
        // A nested collection takes its root's tier (collections.access.set-on-root-only): a tier
        // given with a parent would be stored, unused, and reported back as if it applied.
        if (parent_id !== undefined && visibility !== undefined) {
          throw new ToolInputRejected(
            "A nested collection takes its tree root's tier: omit visibility, or set the root's with set_collection_visibility.",
          );
        }
        return summarize(
          await createCollectionCommand(
            {
              requesterId: userId,
              name,
              description,
              parentId: parent_id ?? null,
              visibility,
              scope,
            },
            commandDeps,
          ),
        );
      }),
  );

  server.registerTool(
    "update_collection",
    {
      title: "Update collection",
      description:
        "Rename a collection you own or change its description (a string sets it, null clears it). Give at least one. Visibility is set_collection_visibility's. Returns the collection's summary with its path; its visibility is the tier it is served under (its tree root's).",
      inputSchema: {
        id: z.string().min(1).describe("Your collection's id."),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
      },
    },
    async ({ id, name, description }) =>
      run(async () => {
        if (name === undefined && description === undefined) {
          throw new ToolInputRejected("Nothing to update: give a name, a description, or both.");
        }
        return summarize(
          await editCollectionCommand(
            { collectionId: id, requesterId: userId, name, description, scope },
            commandDeps,
          ),
        );
      }),
  );

  server.registerTool(
    "set_collection_visibility",
    {
      title: "Set collection visibility",
      description:
        "Set the tier of a top-level collection you own. It applies to the WHOLE tree: every artefact in it, at any depth, is served under it, so a shared tier shares them all and mints their links, and private stops every link working — tell the user before. A nested collection takes its tree root's tier: set the root's instead. \"selected\" shares with exactly the people the user has granted in the Artefactor web app, any granted earlier included, and with no one if none are. Leaving public clears the tree's link protection (password and expiry), which is set only in the Artefactor web app. Returns the collection's summary with its path; its visibility is the tier it is served under (its tree root's).",
      inputSchema: {
        id: z.string().min(1).describe("Your top-level collection's id."),
        visibility: z.enum(VISIBILITIES),
      },
    },
    async ({ id, visibility }) =>
      run(async () =>
        summarize(
          // r[impl mcp.collections.web-app-only]
          // The tier alone: a link gate is never passed, so the connector never sets one.
          await editCollectionCommand(
            { collectionId: id, requesterId: userId, visibility, scope },
            commandDeps,
          ),
        ),
      ),
  );

  server.registerTool(
    "archive_collection",
    {
      title: "Archive collection",
      description:
        "Archive a collection you own with everything under it: its sub-collections and your artefacts in them are archived too, and other users' artefacts in the tree are moved out to their own top level. Confirm with the user first. Restore with restore_collection and the id. Returns { collection, cascade: { collections, artefacts, evicted } }.",
      inputSchema: { id: z.string().min(1).describe("Your collection's id.") },
    },
    async ({ id }) =>
      run(async () =>
        withCascade(
          await archiveCollectionCommand(
            { collectionId: id, requesterId: userId, scope },
            commandDeps,
          ),
        ),
      ),
  );

  server.registerTool(
    "restore_collection",
    {
      title: "Restore collection",
      description:
        "Restore an archived collection you own, with its sub-collections and your artefacts in them, by the id archive_collection returned (archived collections are not listed here). One inside a still-archived tree is refused: restore the archived ancestor the refusal names. Returns { collection, cascade: { collections, artefacts, evicted } }.",
      inputSchema: { id: z.string().min(1).describe("Your archived collection's id.") },
    },
    async ({ id }) =>
      run(async () => {
        // A collection under an archived ancestor stays archived: restoring it alone would leave
        // an active node inside an inert tree (collections.lifecycle.archived-inert), unlisted yet
        // writable. Point at the topmost archived ancestor, whose restore brings this one back too.
        const target = await loadOwnCollection(deps.collectionRepo, {
          id,
          ownerId: userId,
          scope,
        });
        if (target.parentId !== null) {
          const tree = await deps.collectionRepo.listByOwner(userId, scope, {
            includeArchived: true,
          });
          const archivedAncestor = chainToRoot(tree, target.parentId)
            .reverse()
            .find((c) => c.status === "archived");
          if (archivedAncestor) {
            throw new ToolInputRejected(
              `Collection '${id}' sits under an archived collection: restore '${archivedAncestor.id}' (${archivedAncestor.name}) instead, which restores this one with it. Nothing was restored.`,
            );
          }
        }
        return withCascade(
          await restoreCollectionCommand(
            { collectionId: id, requesterId: userId, scope },
            commandDeps,
          ),
        );
      }),
  );
}
