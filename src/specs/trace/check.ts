// `traceCheck` — one gate's whole traceability check over its trees (`docs/specs/README.md`
// *Requirements*): markers and where they are defined, DDD placement, each tree's lock, references,
// the direction rule, coverage, and completeness with the legacy-id ban. Pure over `TraceInput`.
import { checkCompleteness } from "./completeness";
import { checkCoverage, claimsOf } from "./coverage";
import { checkDefinitions, namespaceOf } from "./definitions";
import { checkDirection } from "./direction";
import { checkLegacyBan, parseLegacy } from "./legacy";
import { checkLock } from "./lock";
import { parseMarkers } from "./markers";
import { ownerTree, type Requirement, type TraceInput } from "./model";
import { checkPlacement } from "./placement";
import { checkReferences, parseReferences } from "./references";
import { parseRegistry } from "./registry";
import { traceReport, type TraceReport } from "./report";

export interface TraceResult {
  errors: string[];
  report: TraceReport;
}

export function traceCheck(input: TraceInput): TraceResult {
  const errors: string[] = [];
  const registry = parseRegistry(input.trees.map((t) => ({ tree: t.name, catalog: t.catalog })));
  errors.push(...registry.errors);

  const specs = input.trees.flatMap((t) => t.specs);
  const requirements: Requirement[] = [];
  for (const file of specs) {
    const parsed = parseMarkers(file);
    requirements.push(...parsed.requirements);
    errors.push(...parsed.errors);
  }

  const definitions = checkDefinitions(requirements, registry);
  errors.push(...definitions.errors);
  const defined = [...definitions.byId.values()];

  // Each tree's lock holds the requirements its own spec files define, once per id.
  const firsts = new Map<string, Requirement>();
  for (const r of requirements) if (!firsts.has(r.id)) firsts.set(r.id, r);
  for (const tree of input.trees) {
    const own = [...firsts.values()].filter((r) => ownerTree(r.file) === tree.name);
    errors.push(...checkLock(own, tree.lock));
  }

  const refs = input.sources.flatMap(parseReferences);
  const references = checkReferences(refs, definitions.byId);
  errors.push(...references.errors);
  errors.push(...checkDirection(requirements, refs, registry));
  // A core file citing an EE requirement never counts toward its coverage.
  const current = references.current.filter(
    (r) => ownerTree(r.file) === "ee" || registry.byNamespace.get(namespaceOf(r.id))?.tree !== "ee",
  );

  const claims = claimsOf(specs, definitions.byId);
  errors.push(...claims.errors);
  const coverage = checkCoverage(defined, claims, current);
  errors.push(...coverage.errors);

  errors.push(...checkCompleteness(registry, specs, claims));
  errors.push(...checkPlacement(registry, input.trees));
  const legacy = parseLegacy(
    input.trees.map((t) => ({ tree: t.name, file: t.legacy })),
    registry,
  );
  errors.push(...legacy.errors);
  errors.push(
    ...checkLegacyBan(
      registry,
      legacy.rows,
      { markdown: input.markdown, sources: input.sources },
      input.trees.map((t) => t.legacy.path),
    ),
  );

  return {
    errors,
    report: traceReport({
      registry,
      requirements: defined,
      traces: coverage.traces,
      stale: references.stale,
      broken: references.broken,
      sources: input.sources,
    }),
  };
}
