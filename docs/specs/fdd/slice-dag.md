# FDD — Feature Slice DAG (v0.2)

Each slice is a **vertical cut** through the stack: BFF endpoint (Hono) + domain logic +
Drizzle persistence + client UI where relevant. Built **test-first** (TDD) against the
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
`ddd/artefact-hosting.md` (AH), `ddd/identity-access.md` (IA), `ddd/artefact-data.md` (AD), and
`ddd/deployment-export.md` (DX).

## Contexts

| Context | File | Slices |
| --- | --- | --- |
| Platform & enabler seams | [platform.md](slices/platform.md) | S0, S22, S23, S24, S39, S43, S45, S46, S49a, S49b, S52, S53, S57, S58, S59, S61, S68, S69, S70, S71, S77, S80 |
| Identity & Access | [identity-access.md](slices/identity-access.md) | S1, S8, S9, S38, S42, S48, S50, S51, S67 |
| Artefact Hosting | [artefact-hosting.md](slices/artefact-hosting.md) | S2, S3, S4, S5, S6, S7, S10, S14, S15, S16, S19b, S32a, S32b, S33a, S33b, S35, S36, S37, S47, S54, S55, S56, S60, S62, S64, S65, S66, S72, S79 |
| Artefact Data | [artefact-data.md](slices/artefact-data.md) | S11, S12, S13, S17, S19a, S20, S41 |
| Artefact Views | [artefact-views.md](slices/artefact-views.md) | S21 |
| MCP connector | [mcp-connector.md](slices/mcp-connector.md) | S18, S30, S31, S40, S63, S75, S76, S78 |
| Artefact Collections | [artefact-collections.md](slices/artefact-collections.md) | S25, S26, S27, S28, S29, S44, S73, S74 |
| Artefact Feedback | [artefact-feedback.md](slices/artefact-feedback.md) | S34, S34b |

## Requirement contexts

The namespaces a requirement id may start with (`docs/specs/README.md` *Requirements*): each
context's DDD file and slice file and its legacy id prefix. Every registered context is checked
in full (`src/specs/trace/`), from its first commit. A requirement is defined only in its
namespace's files.

| Namespace | DDD | Slices | Legacy prefix |
| --- | --- | --- | --- |
| platform | — | [platform.md](slices/platform.md) | — |
| export | [ddd/deployment-export.md](../ddd/deployment-export.md) | [platform.md](slices/platform.md) | DX |
| identity | [ddd/identity-access.md](../ddd/identity-access.md) | [identity-access.md](slices/identity-access.md) | IA |
| hosting | [ddd/artefact-hosting.md](../ddd/artefact-hosting.md) | [artefact-hosting.md](slices/artefact-hosting.md) | AH |
| data | [ddd/artefact-data.md](../ddd/artefact-data.md) | [artefact-data.md](slices/artefact-data.md) | AD |
| views | [ddd/artefact-views.md](../ddd/artefact-views.md) | [artefact-views.md](slices/artefact-views.md) | VT |
| collections | [ddd/artefact-collections.md](../ddd/artefact-collections.md) | [artefact-collections.md](slices/artefact-collections.md) | CL |
| feedback | [ddd/artefact-feedback.md](../ddd/artefact-feedback.md) | [artefact-feedback.md](slices/artefact-feedback.md) | FB |
| mcp | [ddd/mcp-connector.md](../ddd/mcp-connector.md) | [mcp-connector.md](slices/mcp-connector.md) | — |

## High-water marks

The highest number ever allocated per id prefix; a sub-lettered id (`S34b`) counts by its number.
A number is never reused, so a mark may sit above the highest slice but never below it.

- **S:** S80
