import { readFile } from "node:fs/promises";
import { env } from "../env";

// S18 — surface the authoring skill through the MCP connector. Claude design (and
// any MCP client) can use the connector but CANNOT load the `artefactor` Agent
// Skill, so the persistence-authoring contract — which must be known *before* the
// HTML is written — has to reach the model another way. Two ambient channels:
//
//   1. The server's `instructions` (returned in `initialize`, injected into the
//      model's context the moment the connector is enabled) carry the compact
//      contract below — present before any tool is called, i.e. before authoring.
//   2. The `get_authoring_guide` tool returns the FULL skill body on demand
//      (template, checklist, breaking-change guidance).
//
// SKILL.md (`skills/artefactor/SKILL.md`) is the single source for (2); the short
// summary in (1) is the one hand-authored copy and MUST stay faithful to it. Keep
// all three (skill ↔ instructions ↔ tool surface) in sync — same no-drift rule as
// the specs (see CLAUDE.md).

// The compact, always-present persistence contract. A faithful condensation of
// the "Persisting data" section of SKILL.md — keep it in step with that file.
export const PERSISTENCE_CONTRACT_SUMMARY = `Artefactor hosts self-contained HTML artefacts and gives them server-side persistence for free by hijacking localStorage: when an artefact is served, window.localStorage is replaced with a shim backed by a per-user store on the server. From the artefact's point of view there is exactly one set of data — the same mental model as plain localStorage.

When you AUTHOR an artefact's HTML, follow this persistence contract so saved data survives:

1. Persist ONLY through the standard localStorage API. Not IndexedDB, cookies, sessionStorage, or your own fetch/network code — only localStorage is backed by Artefactor's store. (sessionStorage looks similar but is NOT persisted.)
2. Keep your whole state as ONE JSON object under ONE versioned key (e.g. "my-artefact-v1"). Versioning the key is what makes a later shape change tractable — but note that bumping it *without* a migration means old data is ignored, i.e. every user silently loses what they saved (see "Breaking data-shape changes" below).
3. Wrap every getItem/setItem in try/catch and degrade to in-memory. A write can fail and must never break the artefact: the data may be loaded read-only (writes rejected), over the 5 MB budget (QuotaExceededError), or unavailable (opened as a bare file). You never detect or control read-only mode yourself — just tolerate a failed write.
4. Stay under 5 MB total. Don't stuff big base64 images/files into saved state — keep them in the HTML or reference them by URL.
5. Debounce frequent writes (~400 ms, e.g. typing in a textarea). Don't depend on storage events or cross-tab sync.
6. Declare the shape you save, in an inert block the browser ignores, so it is knowable without reading all your code and without anyone's data being populated:
   <script type="application/artefactor-schema+json">
   { "key": "my-artefact-v1", "version": 1, "description": "…",
     "example": { "items": [], "settings": {} } }
   </script>
   The example is the centrepiece — a populated exemplar, using INVENTED values only (never real user data: the block ships inside a downloadable, possibly public artefact). Write the schema and the code in the same breath; nothing enforces that they agree.

Reads are synchronous and instant (the server seeds saved data before your script runs, so getItem returns the saved value on first paint). Writes save automatically (debounced, flushed when the page is hidden/closed). Opened as a plain file, native localStorage is used — same code still works.

Publishing: use create_artefact to publish, update_artefact to iterate in place (HTML is a full replacement, not a patch), set_visibility to share. Read back with get_artefact_html (the stored HTML, to derive a new artefact or to re-read one before updating it) and get_artefact_data (your own saved blob, verbatim, plus the declared schema, dataAuthorCount, and the currentPayloadVersion / authoredAgainstVersion pin). Both refuse an over-cap result rather than truncating — the user can then get the file from the Artefactor web app's "Download HTML" menu item.

Breaking data-shape changes: check dataAuthorCount, call get_artefact_data, then prefer to MIGRATE FORWARD — ship migration code in the new HTML that reads the old key, transforms it, and writes the new one. Idempotent, run at load before first render, old key left in place for one generation, never clear(). A migration can only live in the artefact: the backend treats blobs as opaque and cannot migrate them. Bumping the storage-key version without migrating silently discards every user's saved data — only do that for disposable data, and say so. Publishing a separate v2 keeps the old artefact intact for existing users.
The snapshot you read is ONE user's blob, not the population: others may sit on older key versions, be partial, or have been written by HTML two revisions back, so a migration must tolerate shapes you never saw. Staleness per user: authoredAgainstVersion null = unknown, treat as possibly stale; ≠ currentPayloadVersion = written against older HTML, migration owed; = current = matches what is deployed. (That pin is backend-set and mechanical; the declared schema's own version is author-set and semantic — keep both.) Trust the declared schema for orientation, but verify it against the HTML before any shape-changing write.

Editing the user's saved data: set_artefact_data replaces YOUR OWN blob for an artefact (never another user's). It is WHOLE-BLOB REPLACEMENT — not a patch, nothing merged, any key you omit is deleted — and there is no undo. So: (1) read before write, always — get_artefact_data first, send back the full transformed blob, and pass the updatedAt you read as if_unmodified_since (null if you read no entry); if refused because the user saved meanwhile, re-read and re-apply, don't drop the pin. (2) Use the declared schema and its example (that is what makes writing into an empty blob possible), but confirm a shape you inferred from it against get_artefact_html. (3) If authoredAgainstVersion ≠ currentPayloadVersion, or is null, the blob may be shaped for older HTML — transform it to the live shape rather than writing it back as found. (4) Keep the pre-write blob so you can revert. (5) Tell the user what will change before writing. Write {} to clear.

IMAGES — there are two ways an artefact reaches Artefactor, and embedded raster images decide which:
- A) Publish via the connector (create_artefact / update_artefact): you send the HTML directly through the tool call. This works ONLY for artefacts with NO embedded raster images — i.e. no PNG/JPEG photos or screenshots, whether as base64 "data:" URIs or binary. You cannot reliably emit base64 image bytes through a tool argument, so pushing an image-bearing artefact this way will TRUNCATE/CORRUPT it. Anything authored as text is fine: HTML/CSS, inline SVG, CSS-drawn graphics, charts, diagrams. Most artefacts qualify (forms, prototypes, slide decks, interactive docs) — so path A is the common case.
- B) Manual upload: the human downloads the finished self-contained HTML file and uploads it through the Artefactor web app. This is the path for artefacts that must contain real raster images.
When an artefact needs images, do NOT silently push it via the connector. Stop and offer the human a choice: (1) recreate the visuals as SVG/CSS — vector, sharp at any size, tiny, fully text-authorable — so it can be published via the connector (path A); or (2) keep the images as base64-embedded raster, in which case you give them the finished self-contained HTML file to download and they publish it via manual upload (path B).

Call get_authoring_guide for the full contract, a ready-to-use template, and the shipping checklist.`;

// Lazily read and cache the full skill body. The frontmatter is stripped so the
// returned guide is clean markdown. Cached after first read (the file is
// immutable for the life of the process).
let cached: string | null = null;

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return md;
  const afterClose = md.indexOf("\n", close + 1);
  if (afterClose === -1) return "";
  return md.slice(afterClose + 1).replace(/^\s+/, "");
}

export async function loadAuthoringGuide(): Promise<string> {
  if (cached !== null) return cached;
  const raw = await readFile(env.AUTHORING_GUIDE_PATH, "utf8");
  cached = stripFrontmatter(raw);
  return cached;
}
