// S30 — the **declared data schema**: an authoring convention by which an
// artefact states its own data shape inside its HTML, so the shape is knowable
// without inferring it from the code and without a populated blob.
//
//   <script type="application/artefactor-schema+json">
//   { "key": "habit-tracker-v2", "version": 2,
//     "description": "…", "example": { … } }
//   </script>
//
// The browser ignores an unknown script `type`, so the block is inert, and it
// lives in the trusted HTML — so it travels with an export automatically
// (download → edit → re-upload keeps it, no extra plumbing).
//
// This is a **payload convention**, not a domain rule: the backend may forward
// the declaration but never validates a blob against it (that would make the
// backend interpret the blob and collapse AD8 opacity). Extraction is therefore
// best-effort — absent, malformed, or non-object → `null`, never an error, and
// the caller falls back to reading the HTML itself. It is also only a *second*
// representation of a truth that lives in the JS, so a reader trusts it for
// orientation and verifies against the HTML before any shape-changing write.

export const DECLARED_SCHEMA_TYPE = "application/artefactor-schema+json";

// The opening `<script …>` tag carrying our type, in any attribute order and
// with the type value quoted either way or bare. `[^>]*?` stays inside the tag,
// so a `type=` elsewhere in the document cannot be matched into it.
const TYPE = DECLARED_SCHEMA_TYPE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OPEN_TAG = new RegExp(
  `<script[^>]*?\\stype\\s*=\\s*(?:"${TYPE}"|'${TYPE}'|${TYPE}(?=[\\s>]))[^>]*>`,
  "i",
);

// The artefact's declared data schema, or `null` when it does not have a
// readable one. A declaration must be a JSON **object** — an array, a scalar, or
// `null` is not a shape description, so it reads as "no declaration".
export function extractDeclaredSchema(html: string): Record<string, unknown> | null {
  const open = OPEN_TAG.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = html.indexOf("</script", start);
  if (end === -1) return null;

  const body = html.slice(start, end).trim();
  if (body === "") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null; // Malformed → no declaration; never an error.
  }
}
