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

`fdd/slice-dag.md` is the **single source of truth for slice status and dependencies** —
nothing else (not `CLAUDE.md`, not a diagram, not prose) records them. A slice is a heading
matching `### <id> — <title>`, where `<id>` is 1–3 capital letters, a number and an optional
lowercase suffix (`S19a`, `S34b`, `E1`, `ET2`). The heading is the title only; a fixed
metadata block follows it directly:

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

The *why* of an edge belongs in the slice body. Other headings (`## Context: …`,
`### Out of scope`, …) are ignored, so a DAG file can keep prose sections.

**Drift test.** `src/specs/slice-dag.test.ts` runs in `pnpm test` and fails when a slice heading
is indented instead of starting at column 0, lacks the block, or has a missing or invalid Status
or no `Depends on` field; ids are duplicated; a dependency or optional id doesn't
exist, or a hard dependency is `dropped`; the hard-dependency graph has a cycle; a `done` or
`in progress` slice depends on one that isn't `done`; or the root `CLAUDE.md` carries slice
status again — a `## Status` section, bold markers like `**done**`, or a slice heading or
metadata field (`- **Status:**`, `- **Depends on:**`, …) copied out of the DAG. Headings and
fields inside a fenced code block are allowed, so the format can be documented by example.

**`pnpm spec:dag [file]`** prints a mermaid graph of a DAG file (dropped slices omitted) and
its parallel build waves — the not-done slices whose hard dependencies are done or in an
earlier wave. Its output is never committed.

## Status

Slice status lives in [`fdd/slice-dag.md`](fdd/slice-dag.md); in-flight work lives in
Linear.
