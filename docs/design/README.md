# Design system

This folder is where the design side of Artefactor lives in the repo: the foundations, the
component specs and the template specs that the designer hands back from Claude design, and the
blank forms they are handed back on. It is documentation, not a DDD/FDD spec. The code and its
tests still decide how the app behaves.

## Three layers

The design system has three layers, each built only from the one before it.

| Layer | What it is | Here | In the code |
| --- | --- | --- | --- |
| **Foundations** | A token family and its rules: colour, type, layout, icons | [`foundations/`](foundations/) | `src/client/app.css` |
| **Components** | The parts screens are built from, primitives to product components | [`components/`](components/) | `src/client/lib/components/` |
| **Templates** | The built screens, rendered with sample data | [`templates/`](templates/) | `src/client/screens/` |

The words, as both sides use them:

- **Foundation:** a token family and its rules. The values live in `src/client/app.css`; a
  foundation file describes them and points there, never copies them.
- **Component:** a reusable part. A **primitive** is stock shadcn/ui; a **product component**
  renders an Artefactor thing; a **layout** is a slotted frame that never looks inside its slots.
  A layout is a kind of component.
- **Template:** a built screen, rendered with the catalog's sample data. A screen that isn't built
  isn't a template.

### Component or screen

What a part is a function of decides what it is:

- of **props** alone (a label, a state, a callback): a primitive or a product component;
- of a **domain object** (an artefact, a collection, a member, an access level): a product
  component;
- of **slots** it never looks inside: a layout;
- of a **route** (it reads the URL, the session or the BFF, or owns a screen's data): a screen,
  and its spec is a template.

## Source of truth

The repo is the **single source of truth**. The tokens (`src/client/app.css`), the components
(`src/client/lib/components/`) and the docs in this folder are the design system.

- **Repo → the design system, one way.** The design system on claude.ai (a Design System
  artifact) gets a *copy* of the tokens and the component library, synced from the repo with
  `/design-sync` after a change. Its page editing is off and nobody edits that copy, so there are
  never two versions to drift apart.
- **Design → repo, as hand-backs.** The designer's work comes back as a **spec** (one of the
  forms below) plus a **Linear issue**, never as code to paste in. Engineering builds it, merges
  it, and the next sync carries it back to the design system.

The loop, for every new foundation, component or screen:

```text
prototype on claude.ai → spec + Linear issue → build + merge → /design-sync → the next thing
```

## Hand-back formats

<!-- The tree this table states is platform.design.docs-tree (docs/specs/fdd/slices/platform.md),
checked by src/client/design/docs.test.ts. -->

| Kind | Form | Lands in |
| --- | --- | --- |
| foundation | [`hand-back-forms/foundation-spec.md`](hand-back-forms/foundation-spec.md) | [`foundations/`](foundations/) |
| component | [`hand-back-forms/component-spec.md`](hand-back-forms/component-spec.md) | [`components/`](components/) |
| template | [`hand-back-forms/template-spec.md`](hand-back-forms/template-spec.md) | [`templates/`](templates/) |

- A **foundation** hand-back changes a foundation file, or adds one: a theme, a type or radius
  change, or a rule about voice and copy, navigation or mobile behaviour.
- A **component** hand-back is a product component built from shadcn parts, or a layout.
- A **template** hand-back is a screen: its layout, data, actions, states and navigation.

Each hand-back is one Linear issue, holding the filled spec (or a link to it). A component or a
template also links the prototype published on Artefactor, so both sides can click through it; a
foundation may. Each form carries the scope, what must not break and observable acceptance checks,
so engineering can build from it without an interview.

## Ground rules

- **Prototypes are for exploring.** Once a screen ships, the code and its spec are the truth, and
  the prototype is just history.
- **Need something the library doesn't have? Raise it as an issue.** A new colour, variant or
  component: flag it, it is added to the system, and it syncs back. Don't draw one-offs.
- **Build from shadcn parts.** A product component is composed from the stock primitives (Card,
  Badge, DropdownMenu, Dialog…), not from new basic controls. Radix is imported only inside
  `src/client/lib/components/ui/`; everything else imports the shadcn wrapper, and `pnpm lint`
  fails a direct `radix-ui` import. Raw controls fail it too: outside `ui/`, a `<button>`,
  `<input>`, `<select>`, `<textarea>`, `<label>` or `<dialog>` is the shadcn wrapper or a product
  component (such as `NavRow`) instead.
- **Colours live in one tokens file.** See [`foundations/color.md`](foundations/color.md): every
  colour is a token in `src/client/app.css`, and `pnpm lint` fails one anywhere else in the
  client.

## Rules engineering enforces

Each line is a rule a test checks on every change, with the requirement that states it and the
file that defines it. A new enforced rule is a new line here.

- **Text contrast.** Every token pair drawn as text on a background reads at least 4.5:1 (WCAG 2),
  in light and in dark → `platform.theme.text-contrast` (`docs/specs/fdd/slices/platform.md`);
  the pairs and the maths are in `src/shared/contrast.ts`.
- **Non-text contrast.** Every token pair drawn as a shape on another (the logo's mark on its tile,
  the tile on the page) reads at least 3:1 (WCAG 1.4.11), in light and in dark →
  `platform.theme.non-text-contrast` (`docs/specs/fdd/slices/platform.md`); the pairs are
  `NON_TEXT_PAIRS` in `src/shared/contrast.ts`.

## The component catalog

Every component under `src/client/lib/components/` has a sibling `*.preview.tsx` that renders its
variants and states with fixture data. A test fails when one is missing.

```bash
pnpm design:catalog   # the catalog in dev, on http://localhost:5274 (light/dark toggle)
pnpm design:export    # dist/design: the catalog + one standalone page per preview
```

A standalone page is `dist/design/components/<id>.html`, or `?preview=<id>` in dev. Its first
line is the card marker (`<!-- @dsCard group="UI" -->`, `group="App"`, `group="Templates"` or
`group="Theme"`), and it opens the preview's main dialog or menu, so the card shows the thing
itself. `/design-sync` builds the design system's previews from the component pages only (its
adapters walk `src/client/lib/components/`): each becomes a live preview whose first line is the
design system's own marker (`<!-- @dsCard group="app" height=N -->`). The Templates pages stay in
the catalog; ED7 extends the sync to them. The design-system page switches themes with
`[data-theme="dark"]`, which `app.css` honours beside `.dark`. The catalog is dev-only: nothing
of it reaches `pnpm build`'s `dist/client`.

The catalog's **Theme** group holds one card, `ThemeSpecimen`
(`src/client/lib/components/theme/`), which shows every token: colours light and dark, product
colours, type, radius and components in use, all read through `var(--…)` only. It stays in the
catalog but not in the sync: the design system shows the tokens itself (its Colors, Spacing and
Typography views), so after a foundation hand-back that changes colours lands and `/design-sync`
runs, those views are the check that it landed.

The catalog's **Templates** group, after *App*, holds the built screens: each screen under
`src/client/screens/` has a sibling `*.preview.tsx` rendering it from fixtures as the app frames it
(a signed-in screen inside `AppShell` with `Sidebar` and `TopBar`), its standalone page marked
`<!-- @dsCard group="Templates" -->`. A screen with no preview of its own is listed with the reason
in `SCREENS_WITHOUT_PREVIEW` (`src/client/design/registry.ts`), and a test fails when a screen
preview makes a request the fixture API doesn't answer. A template built outside the app has no
screen card either: [`templates/landing-site.md`](templates/landing-site.md) is built in
`ee/landing/`, outside the app.

The export's stylesheet also carries a safelist of common Tailwind utilities
(`src/client/design/safelist.css`), so designs built on the design system can use them even where the
app doesn't. The app build doesn't carry it, and a test caps the export's stylesheet at 300,000
bytes.

To add a component, add its `*.preview.tsx` beside it. Export one `definePreview({ title,
variants })` (from `src/client/design/preview.ts`), with one variant per visual variant or state.
Take the data from `src/client/design/fixtures.ts`.
