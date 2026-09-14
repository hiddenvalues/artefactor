# Artefactor — Specifications

These specs are the **source of truth**. Implementation and unit tests are kept in sync
with them at all times (spec ↔ tests ↔ code change together).

## Layout

- `ddd/` — **Domain-Driven Design**: the model. Bounded contexts, aggregates, value
  objects, invariants, and state transitions. The *what* and the *rules*.
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
  `# <Context>` H1 and holds that context's slices in id order. A dependency may name a slice in
  any context file.

A slice is a heading matching `### <id> — <title>`, where `<id>` is 1–3 capital letters, a
number and an optional lowercase suffix (`S19a`, `S34b`, `E1`, `ET2`). The heading is the title
only; a fixed metadata block follows it directly:

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

The *why* of an edge belongs in the slice body. Other headings (`# <Context>`,
`### Out of scope`, …) are ignored, so a context file can keep prose sections.

### The catalog

```markdown
## Contexts

| Context | File | Slices |
|---|---|---|
| Artefact Data | [artefact-data.md](slices/artefact-data.md) | S11, S12, S13, S17, S19a, S20 |

## High-water marks

- **S:** S34
```

- **Context** equals the file's H1; **File** is a link whose target is the file's path,
  relative to the catalog; **Slices** lists the file's slice ids in file order.
- **High-water marks** — one `- **<prefix>:** <id>` line per id prefix in use. A mark is the
  highest number ever allocated for that prefix; a sub-lettered id counts by its number (`S34b`
  sits at `S34`). A number is never reused, so a mark may sit above the highest slice, never
  below it.

### Adding a slice

1. Take the next free id from `pnpm spec:dag` (`Next free id: S35`), or sub-letter a split
   slice (`S19a`/`S19b`).
2. Bump the prefix's high-water mark in the catalog.
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

**Catalog.** It fails when a catalogued file doesn't exist; a `.md` file in `slices/` is missing
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

## Status

Slice status lives in the context files catalogued by [`fdd/slice-dag.md`](fdd/slice-dag.md);
in-flight work lives in Linear.
