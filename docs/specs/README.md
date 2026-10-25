# Artefactor — Specifications

These specs are the **source of truth**. Implementation and unit tests are kept in sync
with them at all times (spec ↔ tests ↔ code change together).

## Layout

- `ddd/` — **Domain-Driven Design**: the model. Bounded contexts, aggregates, value
  objects, invariants, and state transitions. The *what* and the *rules*. Its terms are defined
  once, in the [ubiquitous language](ddd/ubiquitous-language.md).
- `fdd/` — **Feature-Driven Design**: the build plan. Vertical slices of the DDD model,
  organized as a dependency DAG with per-slice acceptance criteria. The *how* and the
  *order*.

## How to use them

1. **Before coding**, find the DDD aggregate + invariants and the FDD slice that govern
   the work.
2. **TDD**: write unit tests that encode the invariants for the slice, then implement.
3. **No drift**: if behavior changes, the DDD spec, the tests, and the code change in the
   same commit. If no spec covers the work, extend the spec first.
4. **Respect the DAG**: don't start a slice before its dependency slices are done.

## Slice metadata

The slice DAG is the **single source of truth for slice status and dependencies** — nothing
else (not `CLAUDE.md`, not a diagram, not prose) records them. It is split in two layers:

- **The catalog** — `fdd/slice-dag.md`. Intro prose, a `## Contexts` table and the
  `## High-water marks`. It holds no slice headings.
- **Context files** — `fdd/slices/<context>.md`, one per context. Each opens with a
  `# <Context>` H1 and holds that context's slices in id order under a `## Slices` heading (so
  heading levels step `#` → `##` → `###`). A dependency may name a slice in any context file.

A slice is a heading matching `### <id> — <title>`, where `<id>` is 1–3 capital letters, a
number and an optional lowercase suffix (`S19a`, `S34b`, `E1`, `ET2`). The heading is the title
only; a fixed metadata block of contiguous fields follows it after one blank line (the blank line
may be omitted, but never doubled):

```markdown
### S31 — Agent edits data: `set_artefact_data` MCP tool

- **Status:** done
- **Depends on:** S11, S18, S30
- **Optional:** S19a
- **Linear:** ALI-268
```

- **Status** — one of `specced | in progress | done | dropped`.
- **Depends on** — hard edges: bare ids, comma-separated, or `—` for none. A slice can't
  start before these are done.
- **Optional** — non-blocking edges (a slice that sharpens this one without being required).
  Omit when empty.
- **Linear** — the tracking issue. Optional.
- **Delivers** — the requirement ids (see *Requirements*) the slice delivers that it doesn't
  define in its own section, typically DDD requirements: comma-separated, continuation lines
  indented two spaces. Optional.

The *why* of an edge belongs in the slice body. Other headings (`# <Context>`,
`### Out of scope`, …) are ignored, so a context file can keep prose sections.

### The catalog

```markdown
## Contexts

| Context | File | Slices |
|---|---|---|
| Artefact Data | [artefact-data.md](fdd/slices/artefact-data.md) | S11, S12, S13, S17, S19a, S20 |

## High-water marks

- **S:** S34
```

- **Context** equals the file's H1; **File** is a link whose target is the file's path,
  relative to the catalog; **Slices** lists the file's slice ids in file order. (The sample row
  above targets `fdd/slices/…` so that it resolves from *this* README; inside the catalog itself
  the cell reads `slices/artefact-data.md`.)
- **High-water marks** — one `- **<prefix>:** <id>` line per id prefix in use. A mark is the
  highest number ever allocated for that prefix; a sub-lettered id counts by its number (`S34b`
  sits at `S34`). A number is never reused, so a mark may sit above the highest slice, never
  below it.

### Adding a slice

1. Take the next free id from `pnpm spec:dag` (`Next free id: S35`), or sub-letter a split
   slice (`S19a`/`S19b`).
2. For a new number, bump the prefix's high-water mark in the catalog to it. A sub-lettered
   split keeps its number, so the mark stays put.
3. Add the id to its context's Slices cell, in file order.
4. Write the section (heading + metadata block + body) in that context file.

A new context is a new file under `slices/` plus a catalog row.

### Drift test

`src/specs/slice-dag.test.ts` runs in `pnpm test`.

**Slices.** It fails when a slice heading is indented instead of starting at column 0, lacks the
block, or has a missing or invalid Status or no `Depends on` field; ids are duplicated across
the context files; a dependency or optional id doesn't exist, or a hard dependency is `dropped`;
the hard-dependency graph has a cycle; or a `done` or `in progress` slice depends on one that
isn't `done`.

**Catalog.** It fails when a File cell isn't a Markdown link; a catalogued file doesn't exist; a
`.md` file in `slices/` is missing
from the catalog; a file sits in two rows; a Slices cell and its file disagree on ids or their
order; a Context cell differs from the file's H1; the catalog itself holds a slice heading; or a
high-water mark is malformed, duplicated, below a slice's number, or missing for a prefix in use
(or present for a prefix with no slices).

**`CLAUDE.md`.** It fails when the root `CLAUDE.md` carries slice status again — a `## Status`
section, bold markers like `**done**`, or a slice heading or metadata field (`- **Status:**`,
`- **Depends on:**`, …) copied out of the DAG. Headings and fields inside a fenced code block
are allowed, so the format can be documented by example.

Violations name `file:line`.

**`pnpm spec:dag [catalog]`** loads a catalog (default: the core one) and its context files, then
prints a mermaid graph (dropped slices omitted), the parallel build waves — the not-done slices
whose hard dependencies are done or in an earlier wave — and the next free id per prefix. It
exits 1 on any catalog or DAG violation. Its output is never committed.

## Requirements

A **requirement** is one checkable rule — a DDD invariant or a slice's acceptance criterion — with
a stable id, so tests and code can cite it and a change to it flags every citation. The format is
[tracey](https://github.com/bearcove/tracey)'s; `src/specs/trace/` checks it.

### Markers

A requirement starts at a line that is exactly `r[<id>]`, or `r[<id>+<N>]` for version `N ≥ 2`
(no suffix is version 1; `+1` is an error). Its **body** is the lines that follow, up to the first
blank line, the next marker or a heading: a paragraph, plus a list attached directly to it. `r[…]`
anywhere else in a line, or inside a fenced code block, is not a marker.

```markdown
r[hosting.access.no-existence-leak]
A request for an artefact the caller may not read gets the same 404 as one for an artefact that
doesn't exist.
```

**Ids** are 2–4 dot-separated kebab-case segments, written as a **claim** — what holds, not a
topic (`hosting.access.no-existence-leak`, not `hosting.access.rule-3`). The first segment is a
namespace registered in a catalog's `## Requirement contexts` table
([`fdd/slice-dag.md`](fdd/slice-dag.md), and the EE catalog); a requirement is defined only in its
namespace's DDD file or slice file — which of the two is *Placement*'s rule — and ids are unique
across the core and EE trees.

### Placement

**The test:** would the rule still hold if the slice were rebuilt on another surface? Then the
context's DDD file defines it. Domain rules — aggregate and value-object rules, access and
lifecycle rules — live there. So does the **published language**, under `## Published language`:
what consumers outside the codebase depend on, such as the MCP tool contract, the export bundle
format and public URLs like `/a/:slug`.

A **slice** defines only criteria tied to its own surface or a scenario. A surface is a BFF
endpoint (private to the SPA, per the locked BFF decision), a shell widget, a client module or
tooling. The slice claims the DDD rules it builds with `Delivers:`.

**Verdicts** for an existing requirement:

- **surface:** it stays in the slice.
- **domain:** it moves to DDD.
- **duplicate:** it only restates a DDD rule. The slice marker is removed and the slice claims the
  DDD id in `Delivers:`; its `verify` citations move to the DDD id, and its `impl` is dropped,
  because the DDD id's `impl` stays the one owning site.
- **split:** DDD gets the invariant under a new id; the slice body narrows to the scenario and is
  bumped.
- **unclear:** it is rewritten until it is checkable, and bumped.

**Moves.** Within a namespace (slice file → DDD file), a move keeps the id and the body: the lock
line is unchanged and no citation is edited. Across namespaces, the rule gets a new id in the
target namespace, the old id is removed and its citations are rewritten. A move adds no
`legacy-ids.md` row, because dotted ids are not legacy ids.

**DDD shape.** A rule exists only as a marker under an **Invariants heading**: `## Invariants`, or
`### Invariants` under an aggregate, under `## Published language` or under an amendment (any
heading whose text starts with `Invariants`). The heading's block runs to the next heading of the
same or a higher level.

- Every block under an Invariants heading is a requirement body — a marker and its text, with any
  list attached directly — never free prose or a table. An HTML comment is ignored.
- Every marker in a DDD file sits under an Invariants heading.
- No rule lives in a table cell: a table that states a guard or "immutable" moves that rule into a
  marker and keeps only description.
- Prose outside an Invariants heading is descriptive by definition.
- **Interfaces:** BFF endpoint tables live in the slice that builds them; published language stays
  in DDD.

The check runs on every registered context's DDD file in both trees, and every violation —
prose or a table under an Invariants heading, a marker outside one — fails it. A context with no
DDD file passes.

### References

Code cites a requirement in a **comment** — never a string:

```ts
// r[verify hosting.access.no-existence-leak]
it("answers 404 for an artefact the caller can't read", …);

// r[impl hosting.access.no-existence-leak]
export function canRead(…) { … }
```

- `r[verify <id>]` sits above a test and counts only in a `*.test.ts` / `*.test.tsx` file.
- `r[impl <id>]` marks the **one** site that decides the rule.
- Either may name a version, `r[verify <id>+2]`; without one it cites version 1. A reference to an
  unknown id is **broken**, one to an older version **stale**; both fail the check, naming the
  `file:line`.
- Scanned: files under `src/`, `deploy/` and `ee/`, and the repository root's own files (its tool
  configs, `Dockerfile` and `docker-entrypoint.sh`); `src/`, `deploy/` and the root belong to the
  core tree. Files ending `.ts`, `.tsx`, `.js`, `.mjs`, `.sql`, `.sh`, `.yml`, and `Dockerfile*`
  (comment leaders `//`, `/* */`, `#`, `--`), minus `node_modules/`, `dist/` and build output.
- **Direction:** a core file (outside `ee/`) never references or defines an EE-namespace id; an
  `ee/` file may verify and implement core requirements.

### Versions, the lock and `spec:bump`

Each tree has a lock — `requirements.lock` here, `ee/docs/specs/requirements.lock` for EE — with
one sorted line per requirement the tree defines: `<id> <version> <sha256>`, hashing the body with
whitespace runs collapsed and trimmed, so reflowing a paragraph changes nothing. A body that
changes at the same version fails the check (*changed without a version bump*). Then:

- `pnpm spec:bump` raises each changed requirement's marker (`+N` → `+N+1`, in place) and rewrites
  the lock. References stay on the old version on purpose: the check now lists every test and
  impl site to revisit, and each is updated to the new version once it has been judged.
- `pnpm spec:bump --editorial <id>` records a typo fix's new hash without a bump, and says so.
- A new or removed requirement is recorded by `pnpm spec:bump` too.

Both locks are `merge=union` (`.gitattributes`, `ee/.gitattributes`), so parallel CRs never
conflict on them; a union merge can leave a duplicated id line, which the check reports — re-run
`pnpm spec:bump` to rewrite the lock. EE twins run through `pnpm --filter @artefactor/ee`.

### Coverage

A requirement is **claimed** by every non-dropped slice that defines it in its own section or lists
it under `- **Delivers:**`. The strictest claimant's status decides what it needs:

| Strictest claimant | Current `verify` | Current `impl` |
| --- | --- | --- |
| none (*unclaimed*) or `specced` (*planned*) | — | — |
| `in progress` | ≥ 1 | ≤ 1 |
| `done` | ≥ 1 | exactly 1 |

A `Delivers:` id that names no requirement is an error. Tests that cite no requirement are listed
as *untraced* in the report, never failed.

### Gates and the report

- `src/specs/requirements.test.ts` (`pnpm test`) checks the core tree alone: `docs/specs`, `src/`
  and the core lock. An `ee/` test verifying a core requirement doesn't count here.
- `ee/specs/requirements.test.ts` (`pnpm --filter @artefactor/ee test`) checks both trees and
  both locks together, with the direction rule.
- `pnpm spec:trace` prints the report — coverage per namespace, stale and broken references, each
  requirement's verify and impl sites and untraced tests per file (`--untraced` lists each one) —
  and exits non-zero on any error.
  `pnpm --filter @artefactor/ee spec:trace` covers both trees.

### Looking one up

To read a requirement, look it up rather than open the spec file that defines it:
`pnpm spec:req [--refs] <query>…` prints each one's `<id>+<N>  <file>:<line>` header and its body,
and with `--refs` its verify and impl sites. A query is an id, `<id>+<N>` (a version other than
the current one is flagged stale) or a marker or reference pasted as-is (`r[impl <id>]`). It exits
1 when any id is unknown. `pnpm --filter @artefactor/ee spec:req` finds core and EE ids alike.

### Completeness

Every context in a `## Requirement contexts` table is checked in full, from the commit that
registers it; there is no opt-out, and a table with a `Migrated` column is an error. So, for every
context:

- its DDD file has no numbered list under an `## Invariants…` heading;
- its legacy ids — the `Old` cells of its section in [`legacy-ids.md`](legacy-ids.md) (EE:
  `ee/docs/specs/legacy-ids.md`), matched word-bounded — appear nowhere in either tree outside
  the two `legacy-ids.md` files. A one-letter-prefix id (`T`, `P`, `M`, `A`, `Q`) is matched only
  in Markdown, comments and `it`/`describe`/`test` titles, so an SVG path command or a quarter
  named in a string never trips it;
- every `done` or `in progress` slice in its slice file claims at least one requirement.

A new context is registered complete: its first commit writes its rules as markers, placed.

### How contexts were migrated to requirement markers

Every context started with numbered invariants and positional ids (a prefix and a number, listed
in `legacy-ids.md`) and was converted by migration CRs. The recipe stays for a bulk import in the
old style, such as a context arriving from a design hand-back:

1. Convert every invariant (amendments included) in the DDD file, and every acceptance criterion
   of every non-dropped slice in the slice file, to a marker — the body is the existing text,
   reflowed only — and place each by its *Placement* verdict. A criterion that is narrative rather
   than a checkable rule stays prose (its slice must still claim at least one requirement).
2. Append one `legacy-ids.md` row per old id to the context's section.
3. Replace every citation of the old ids in both trees: test names go back to plain behaviour with
   `// r[verify …]` above; the owning code site gets `// r[impl …]`; other mentions become prose or
   the dotted id.
4. Run `pnpm spec:trace` and close every gap — write the missing tests, each seen failing against
   a deliberately broken impl site, and place each `impl` at the one site that decides the rule.
5. Set `Delivers:` on each `done` / `in progress` slice for the DDD requirements it delivers.
6. A finding where code contradicts a requirement stops the CR and goes to the human — never
   fixed silently.

The whole conversion lands in one change, since the check admits no partly converted context.

## Status

Slice status lives in the context files catalogued by [`fdd/slice-dag.md`](fdd/slice-dag.md);
in-flight work lives in Linear.
