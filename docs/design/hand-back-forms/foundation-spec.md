# Foundation: {name}

<!-- Merged into docs/design/foundations/{foundation}.md: the foundation file it names (color,
typography, layout or icons), or a new one for a new token family or rule set (voice and copy,
navigation, mobile behaviour). Its rules and prose are merged into that file; its values (the
Colours, Product colours, Radius and Fonts tables) go only into src/client/app.css, never into the
foundation file, which describes the values and points there. A colour hand-back that also
changes the font lands in typography.md too; a typography-only one lands there alone. Of the value
sections (Colours, Product colours, Contrast, Radius, Fonts), fill only those the change touches
and delete the rest; every other section stays. -->

## Foundation

<!-- Which file it changes or adds, and whether the values in src/client/app.css change too. -->

## Intent

<!-- The feel in two or three sentences, and what it fixes compared with today. -->

## Prototype

<!-- Optional for a foundation: a link to a prototype or screenshot showing the change in use,
light and dark. -->

## Rules

<!-- The rules the foundation file states after this change: each one a sentence a reviewer can
check, such as "pink appears only on actions, links, focus and selected states". -->

## Colours

<!-- For a colour change only. Values are oklch, `oklch(L C H)` or `oklch(L C H / N%)`, or
`#rgb`/`#rrggbb` hex: what src/shared/contrast.ts reads. The variable names are shadcn/ui's, as
they stand in src/client/app.css; leave a row blank to keep the current value. -->

| Variable | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--background` | | | Page background |
| `--foreground` | | | Body text |
| `--card` | | | Card surface |
| `--card-foreground` | | | Text on a card |
| `--popover` | | | Menus, popovers, dialogs |
| `--popover-foreground` | | | Text on a popover |
| `--primary` | | | Primary buttons, emphasis |
| `--primary-foreground` | | | Text on primary |
| `--secondary` | | | Secondary buttons |
| `--secondary-foreground` | | | Text on secondary |
| `--muted` | | | Subdued surfaces |
| `--muted-foreground` | | | Secondary text |
| `--accent` | | | Hover and selected surfaces |
| `--accent-foreground` | | | Text on accent |
| `--destructive` | | | Delete, errors |
| `--border` | | | Borders, dividers |
| `--input` | | | Form field borders |
| `--ring` | | | Focus ring |
| `--sidebar` | | | Sidebar surface |
| `--sidebar-foreground` | | | Sidebar text |
| `--sidebar-primary` | | | Sidebar primary |
| `--sidebar-primary-foreground` | | | Text on sidebar primary |
| `--sidebar-accent` | | | Sidebar hover and active row |
| `--sidebar-accent-foreground` | | | Text on sidebar accent |
| `--sidebar-border` | | | Sidebar borders |
| `--sidebar-ring` | | | Sidebar focus ring |

## Product colours

<!-- For a colour change, optional. The artefact kind colours (--kind-*) and collection hues
(--collection-1…6) are Artefactor's own, used in both themes. Change them here, or say
"unchanged". -->

## Contrast

<!-- For a colour change. One row for each pair in src/shared/contrast.ts (TEXT_PAIRS; a
translucent tint gets a row per surface), each ratio to two decimals, every one at least 4.5:1. A
failing pair is changed before handing back. -->

| Pair | Light | Dark |
| --- | --- | --- |
| | | |

## Radius

<!-- For a layout change. --radius, e.g. 0.625rem. The sm/md/lg/xl radii derive from it. -->

## Fonts

<!-- For a typography change. Sans and mono families, with their source (Google Fonts,
self-hosted, system stack), and any weight or size changes. -->

## Out of scope

<!-- What this hand-back deliberately leaves alone. -->

## Must not break

<!-- What has to keep working: the screens and components to check, in light and dark, and any
rule from another foundation this one leans on. -->

## Acceptance

<!-- Observable checks, each one a thing engineering can see or test once it lands, such as "the
Colors view shows the new primary in light and dark" or "every pair in src/shared/contrast.ts reads
at least 4.5:1". -->
