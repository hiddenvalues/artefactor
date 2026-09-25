# Design system

This folder is where the design side of Artefactor lives in the repo: the theme, the product
component specs, the screen specs and the design rules that the designer hands back from Claude
design. It is documentation, not a DDD/FDD spec. The code and its tests still decide how the app
behaves.

## Source of truth

The repo is the **single source of truth**. The tokens (`src/client/app.css`), the components
(`src/client/lib/components/`) and the rules in this folder are the design system.

- **Repo → Claude design, one way.** Claude design gets a *copy* of the component library, synced
  from the repo with `/design-sync` after a change. Nobody edits that copy, so there are never two
  versions to drift apart.
- **Claude design → repo, as hand-backs.** The designer's work comes back as a **spec** (one of
  the templates below) plus a **Linear issue**, never as code to paste in. Engineering builds it,
  merges it, and the next sync carries it back to Claude design.

The loop, for every new screen or flow:

```text
prototype in Claude design → spec + Linear issue → build + merge → /design-sync → the next thing
```

## Hand-back formats

| Hand-back | Template | Lands in |
| --- | --- | --- |
| The theme: the shadcn variables, light and dark, plus radius and fonts | [`templates/theme-spec.md`](templates/theme-spec.md) | [`theme/`](theme/) |
| A product component, built from shadcn parts | [`templates/component-spec.md`](templates/component-spec.md) | [`components/`](components/) |
| A screen: layout, data, actions, states | [`templates/screen-spec.md`](templates/screen-spec.md) | [`screens/`](screens/) |
| A rule: voice and copy, navigation, mobile behaviour | Plain Markdown, one topic per page | [`rules/`](rules/) |

Each hand-back is one Linear issue, holding the filled spec (or a link to it) and, for a screen or
a component, a link to the prototype published on Artefactor, so both sides can click through it.

## Ground rules

- **Prototypes are for exploring.** Once a screen ships, the code and its spec are the truth, and
  the prototype is just history.
- **Need something the library doesn't have? Raise it as an issue.** A new colour, variant or
  component: flag it, it is added to the system, and it syncs back. Don't draw one-offs.
- **Build from shadcn parts.** A product component is composed from the stock primitives (Card,
  Badge, DropdownMenu, Dialog…), not from new basic controls.
- **Colours live in one tokens file.** `src/client/app.css` holds every colour; `pnpm lint` fails
  a raw colour or an inline style anywhere else in the client. A theme is a change to that file.

## The component catalog

Every component under `src/client/lib/components/` has a sibling `*.preview.tsx` that renders its
variants and states with fixture data. A test fails when one is missing.

```bash
pnpm design:catalog   # the catalog in dev, on http://localhost:5274 (light/dark toggle)
pnpm design:export    # dist/design: the catalog + one standalone page per preview
```

A standalone page is `dist/design/components/<id>.html`, or `?preview=<id>` in dev. Its first
line is Claude design's card marker (`<!-- @dsCard group="UI" -->` or `group="App"`), and it opens
the preview's main dialog or menu, so the card shows the thing itself. `/design-sync` uploads
these pages. The catalog is dev-only: nothing of it reaches `pnpm build`'s `dist/client`.

To add a component, add its `*.preview.tsx` beside it. Export one `definePreview({ title,
variants })` (from `src/client/design/preview.ts`), with one variant per visual variant or state.
Take the data from `src/client/design/fixtures.ts`.
