// S30 — download filenames. Turning an artefact's title into the name a browser
// saves it under is pure string work with no domain authority, so it lives here
// (shared between the BFF that sets the header and any client that shows it)
// rather than in a route handler.

// Base name budget, leaving room for the ".html" suffix inside a 100-char name.
const MAX_BASE_LENGTH = 95;

// The name used when a title folds away to nothing AND no usable ref is given.
const GENERIC_NAME = "artefact";

// Slugify a title: lowercase, keep letters/digits (in any script), collapse
// everything else to single hyphens. Path separators and dots go with the rest,
// so a title can never steer the saved file anywhere (`../etc/passwd` →
// `etc-passwd`).
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// The filename for an artefact download. `fallback` is the artefact's ref (slug
// or id) — used when the title carries no letters or digits at all (a
// symbol-only or blank title). Always ends in `.html`.
export function artefactFilename(title: string, fallback: string): string {
  const base = slugify(title) || slugify(fallback) || GENERIC_NAME;
  return `${base.slice(0, MAX_BASE_LENGTH).replace(/-+$/, "")}.html`;
}

// Fold a name to ASCII for the legacy `filename` parameter: decompose accented
// letters and drop the combining marks, then drop anything still non-ASCII.
function foldToAscii(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x20-\x7E]+/g, "");
}

// The `Content-Disposition` value for an artefact download. Carries both forms:
// the quoted ASCII `filename` every client understands, and the RFC 5987
// `filename*` that preserves non-ASCII titles in clients that read it.
export function attachmentDisposition(filename: string): string {
  // Fold the *base* name — the ".html" suffix is re-applied by the helper, so
  // folding the whole filename would turn "report.html" into "report-html".
  const ascii = artefactFilename(foldToAscii(filename.replace(/\.html$/i, "")), "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
