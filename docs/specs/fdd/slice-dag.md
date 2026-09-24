# FDD — Feature Slice DAG (v0.2)

Each slice is a **vertical cut** through the stack: BFF endpoint (Hono) + domain logic +
Drizzle persistence + Svelte UI where relevant. Built **test-first** (TDD) against the
invariants it touches. A slice is only started once its dependencies are done.

**This catalog and the context files it lists are the single source of truth for slice status
and dependencies.** The slices live in [`slices/`](slices/), one file per context; this file
holds none. Every slice heading (`### <id> — <title>`) is followed, after one blank line, by a
metadata block — `Status` (`specced | in progress | done | dropped`), `Depends on` (hard edges,
bare ids, `—` for none), and the optional `Optional` (non-blocking edges) and `Linear` fields. A
dependency may name a slice in any context file. `src/specs/slice-dag.test.ts` fails the build
when a block is missing or inconsistent (unknown or dropped dependency, a cycle, a done slice
built on an unfinished one) or when this catalog and the context files drift apart, and
`pnpm spec:dag` prints the graph, the parallel build waves and the next free id. Format details:
[`../README.md`](../README.md).

Acceptance criteria are the seed for each slice's unit tests. Invariant numbers reference
`ddd/artefact-hosting.md` (AH), `ddd/identity-access.md` (IA), and `ddd/artefact-data.md` (AD).

## Contexts

| Context | File | Slices |
| --- | --- | --- |
| Platform & enabler seams | [platform.md](slices/platform.md) | S0, S22, S23, S24, S39 |
| Identity & Access | [identity-access.md](slices/identity-access.md) | S1, S8, S9, S38 |
| Artefact Hosting | [artefact-hosting.md](slices/artefact-hosting.md) | S2, S3, S4, S5, S6, S7, S10, S14, S15, S16, S19b, S32a, S32b, S33, S35, S36, S37 |
| Artefact Data | [artefact-data.md](slices/artefact-data.md) | S11, S12, S13, S17, S19a, S20, S41 |
| Artefact Views | [artefact-views.md](slices/artefact-views.md) | S21 |
| MCP connector | [mcp-connector.md](slices/mcp-connector.md) | S18, S30, S31, S40 |
| Artefact Collections | [artefact-collections.md](slices/artefact-collections.md) | S25, S26, S27, S28, S29 |
| Artefact Feedback | [artefact-feedback.md](slices/artefact-feedback.md) | S34, S34b |

## High-water marks

The highest number ever allocated per id prefix; a sub-lettered id (`S34b`) counts by its number.
A number is never reused, so a mark may sit above the highest slice but never below it.

- **S:** S41
