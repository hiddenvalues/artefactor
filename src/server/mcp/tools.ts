import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ARTEFACT_KINDS } from "../../domain/artefact/kind";
import { VISIBILITIES } from "../../domain/artefact/visibility";
import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { loadArtefactRoot } from "../collections/effective";
import { effectiveVisibility } from "../../domain/collection/effective-access";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { PayloadStore } from "../../domain/artefact/ports";
import type { DataRepository } from "../../domain/data/data-repository";
import {
  ArtefactNotFound,
  InvariantViolation,
} from "../../domain/artefact/errors";
import { createArtefactCommand } from "../artefacts/create-artefact.command";
import { editArtefactCommand } from "../artefacts/edit-artefact.command";
import { setArtefactVisibilityCommand } from "../artefacts/set-visibility.command";
import {
  archiveArtefactCommand,
  restoreArtefactCommand,
} from "../artefacts/lifecycle.command";
import { loadOwnActiveArtefact } from "../artefacts/get-own-artefact";
import { getOwnDataEntry, putOwnDataEntry } from "../data/own-data.command";
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

// S18 — the MCP tool surface. Each tool is a thin adapter over the existing
// Hosting / Data application commands, attributed to the OAuth token's Account
// (`userId`). The tools add NO new authority: every invariant (ownership,
// access matrix, kind/payload/blob bounds) is enforced by the same commands the
// BFF uses. See docs/specs/fdd/slice-dag.md S18.

export interface McpToolDeps {
  repo: ArtefactRepository;
  // S25 (AH20) — summaries report the *effective* tier and link reachability,
  // which for a contained artefact comes from its collection tree root.
  collectionRepo: CollectionRepository;
  payloadStore: PayloadStore;
  dataRepo: DataRepository;
}

// S30 — caps on what a read-back tool may return. An MCP result lands in the
// model's context, but payloads are capped at 100 MB (AH2) and blobs at 5 MB
// (AD8) — orders of magnitude more than a context can take. Each tool therefore
// hard-errors above its cap, naming the real byte size and pointing at the GUI
// download, rather than truncating: truncated HTML is unusable for editing and
// truncated JSON is unparseable, and either invites the model to act on a
// fragment as though it were whole. (Same shape of refusal as create_artefact's
// base64-raster-image rule.)
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
// access, AH20, and the slug 404s while effectively private).
function makeSummarize(deps: McpToolDeps) {
  return async function summarize(a: Artefact) {
    const effVis = effectiveVisibility(
      a,
      await loadArtefactRoot(a, deps.collectionRepo),
    );
    const summary = toArtefactSummary(a, effVis);
    const url =
      a.publicSlug && effVis !== "private"
        ? `${env.BETTER_AUTH_URL}/a/${a.publicSlug}`
        : null;
    return { ...summary, url };
  };
}

// Run a tool body, translating known domain errors into `isError` results.
async function run<T>(body: () => Promise<T>) {
  try {
    return ok(await body());
  } catch (err) {
    if (
      err instanceof ArtefactNotFound ||
      err instanceof InvariantViolation ||
      err instanceof ResultTooLarge ||
      err instanceof ToolInputRejected
    ) {
      return fail(err.message);
    }
    throw err;
  }
}

export function registerArtefactTools(
  server: McpServer,
  userId: string,
  deps: McpToolDeps,
  scope: TenantScope,
): void {
  const { repo, payloadStore, dataRepo } = deps;
  const summarize = makeSummarize(deps);

  // Artefacts accumulate per-user data blobs (what the running artefact reads /
  // writes via localStorage). The backend treats those blobs as opaque, so it
  // cannot tell whether an HTML change breaks the data shape — that is the
  // author's call. We surface how many authors already hold data (`dataAuthorCount`)
  // so the model can warn and suggest bumping the storage-key version or
  // publishing a new artefact (v2) on a breaking change. See the authoring skill.
  const withDataCount = async (a: Artefact) => ({
    ...(await summarize(a)),
    dataAuthorCount: (await dataRepo.listAuthorsByArtefact(a.id)).length,
  });

  server.registerTool(
    "create_artefact",
    {
      title: "Create artefact",
      description:
        "Publish a self-contained HTML artefact to Artefactor. Returns the new artefact (id, slug, share URL). Optionally set its visibility; default is private. The HTML must follow Artefactor's persistence contract so any data it saves survives — persist only through localStorage (which Artefactor hijacks to a server-side store). Do NOT use this for an artefact with embedded raster images (PNG/JPEG as base64 data: URIs or binary): base64 image bytes can't be sent reliably through a tool call and will be truncated/corrupted — instead offer the user SVG/CSS visuals (publishable here) or manual upload of the self-contained file. Call get_authoring_guide if unsure.",
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
            "private (owner only), authenticated (any signed-in user), public (anyone with the link), or selected. Default private.",
          ),
      },
    },
    async ({ title, kind, html, visibility }) =>
      run(async () => {
        const created = await createArtefactCommand(
          {
            ownerId: userId,
            title,
            kind,
            payload: new TextEncoder().encode(html),
            tenantId: scope.tenantId,
          },
          { repo, payloadStore },
        );
        if (!visibility || visibility === "private") return summarize(created);
        // Fold the initial share into create as one logical operation: if the
        // share fails, roll the just-created artefact back so the tool is
        // all-or-nothing. (Leaving an orphaned private artefact behind would make
        // a retrying client create duplicates.) No data entries exist yet.
        try {
          const shared = await setArtefactVisibilityCommand(
            { artefactId: created.id, requesterId: userId, visibility, scope },
            { repo },
          );
          return summarize(shared);
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
            payload: html === undefined ? undefined : new TextEncoder().encode(html),
          },
          { repo, payloadStore },
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
  // as opaque (AD8), so it cannot migrate them — only the author's own HTML can.
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
        "Return YOUR OWN saved data for one of your active artefacts, verbatim, plus the data shape the artefact declares for itself. Read this before an HTML change that alters the shape the artefact reads from localStorage: `schema` is the artefact's own declaration (trust it for orientation, verify it against the HTML before acting — nothing enforces that they agree), `blob` is your own entry (null if you have none), and `dataAuthorCount` says how many users hold data in total. The snapshot is ONE user's blob, not the population: other users' entries may sit on older key versions, be partial, or have been written by HTML two revisions back, so any migration you ship must tolerate shapes you never saw. Compare authoredAgainstVersion with currentPayloadVersion to judge staleness (null = unknown, treat as possibly stale). Refuses a blob too large for a tool result.",
      inputSchema: { id: z.string().min(1).describe("The artefact id.") },
    },
    async ({ id }) =>
      run(async () => {
        const a = await loadOwnActiveArtefact(repo, { id, ownerId: userId, scope });
        // The caller's OWN entry only (AD2/AD4), through the same command the
        // BFF uses — returned verbatim, never summarised (AD8 opacity).
        const entry = await getOwnDataEntry(
          { ref: a.id, authorId: userId, scope },
          { artefactRepo: repo, collectionRepo: deps.collectionRepo, dataRepo },
        );
        const bytes = entry
          ? new TextEncoder().encode(entry.blob).byteLength
          : 0;
        if (bytes > MAX_MCP_BLOB_BYTES) {
          throw new ResultTooLarge(
            `Your saved data for this artefact is ${bytes} bytes, over the ${MAX_MCP_BLOB_BYTES}-byte limit for a tool result. It is not truncated, because partial JSON cannot be parsed — inspect it from the artefact itself, or download the artefact from the Artefactor web app.`,
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
          // Two version notions, deliberately kept apart (AD9): the *mechanical*
          // pin below is the payload hash the backend stamps on a write, while
          // the schema's own `version` is *semantic* and author-declared.
          currentPayloadVersion: a.payloadHash,
          // Stamped by every `putOwnDataEntry` write (S19a). null ⇒ no entry, or
          // one written before the pin existed — unknown, treat as possibly
          // stale; ≠ current ⇒ written against older HTML, migration owed;
          // = current ⇒ matches what is deployed.
          authoredAgainstVersion: entry?.authoredAgainstVersion ?? null,
        };
      }),
  );

  // S31 — the write half of the read-modify-write loop. Not the dropped S17: the
  // agent reads the WHOLE blob, transforms it in the session, and writes the
  // WHOLE blob back through the same `putOwnDataEntry` as `PUT …/data/me`, which
  // parses only to enforce AD8. The server still never interprets the blob. The
  // author is always the token's user (AD2/AD3) — there is no way to name
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
          const entry = await putOwnDataEntry(
            { ref: a.id, authorId: userId, scope },
            blob,
            { artefactRepo: repo, collectionRepo: deps.collectionRepo, dataRepo },
            {
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
        "Share or unshare an artefact. A shareable tier mints (and retains) a slug; private retains the slug but the link 404s.",
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
