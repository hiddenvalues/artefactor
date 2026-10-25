// `lookupRequirements` — one requirement at a time (`pnpm spec:req`): its current version, the
// `file:line` of its marker and its body, and optionally its verify and impl sites. It reads the
// markers and references through the checker's own parsers and resolves ids against the same first
// definitions, so its view of a requirement cannot drift from `traceCheck`'s. Pure over `TraceInput`.
import { checkDefinitions } from "./definitions";
import { parseMarkers } from "./markers";
import { at, type Reference, type TraceInput } from "./model";
import { parseReferences, splitVersion } from "./references";
import { parseRegistry } from "./registry";

export interface FoundRequirement {
  query: string;
  found: true;
  id: string;
  version: number;
  file: string;
  line: number;
  body: string;
  /** The query named a version (`+N`) other than the current one. */
  stale: boolean;
  /** `file:line` sites, filled only with `refs`; a stale one carries its `+N`. */
  verify: string[];
  impl: string[];
}

export interface UnknownRequirement {
  query: string;
  found: false;
  id: string;
}

export type Lookup = FoundRequirement | UnknownRequirement;

/** `r[<id>]`, `r[verify <id>]` and `r[impl <id>]` as pasted; the inside is an id, maybe `+N`. */
const PASTED = /^r\[(?:(?:verify|impl)\s+)?([^\]\s]+)\]$/;

/** A query's id, and the version it names when it carries an explicit `+N`. */
function parseQuery(query: string): { id: string; version: number | null } {
  const raw = PASTED.exec(query.trim())?.[1] ?? query.trim();
  const { id, version } = splitVersion(raw);
  return { id, version: /\+\d+$/.test(raw) ? version : null };
}

const site = (ref: Reference, current: number) =>
  ref.version === current ? at(ref) : `${at(ref)} (+${ref.version}, stale)`;

// r[impl platform.trace.lookup]
export function lookupRequirements(
  input: TraceInput,
  queries: string[],
  options: { refs?: boolean } = {},
): Lookup[] {
  const registry = parseRegistry(input.trees.map((t) => ({ tree: t.name, catalog: t.catalog })));
  const requirements = input.trees.flatMap((t) => t.specs).flatMap((f) => parseMarkers(f).requirements);
  const { byId } = checkDefinitions(requirements, registry);
  const refs = options.refs ? input.sources.flatMap(parseReferences) : [];

  return queries.map((query) => {
    const { id, version } = parseQuery(query);
    const req = byId.get(id);
    if (!req) return { query, found: false, id };
    const sites = (kind: Reference["kind"]) =>
      refs.filter((r) => r.kind === kind && r.id === id).map((r) => site(r, req.version));
    return {
      query,
      found: true,
      id,
      version: req.version,
      file: req.file,
      line: req.line,
      body: req.body,
      stale: version !== null && version !== req.version,
      verify: sites("verify"),
      impl: sites("impl"),
    };
  });
}
