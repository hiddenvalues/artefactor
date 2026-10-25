# Color

The app's colours are the **Ruby** theme on shadcn/ui's CSS variables. Every value lives in
[`src/client/app.css`](../../../src/client/app.css): light in `:root`, dark in `.dark` and
`[data-theme="dark"]`. This page says what each colour is for and the rules for using them; read
the values in `app.css`, or in the design system's Colors view.

## The Ruby palette

- **Light** is white with a ruby-pink primary (hue 340) and neutrals carrying a faint pink tint.
  The primary also draws text links and icons on white.
- **Dark** is a near-neutral charcoal, on purpose, so the app never reads as plum or aubergine.
  Its primary is a light ruby with dark text on it. Only the hover surfaces (`--accent`) keep a
  faint pink tint.

| Token | Used for |
| --- | --- |
| `--background`, `--foreground` | The page and its body text |
| `--card`, `--card-foreground` | A card's surface and its text |
| `--popover`, `--popover-foreground` | Menus, popovers, dialogs and their text |
| `--primary`, `--primary-foreground` | The one strong action per view, links, emphasis; text on it |
| `--secondary`, `--secondary-foreground` | Secondary buttons and their text |
| `--muted`, `--muted-foreground` | Subdued surfaces; secondary text |
| `--accent`, `--accent-foreground` | Hover and selected surfaces and their text |
| `--destructive` | Delete and errors |
| `--border`, `--input`, `--ring` | Borders and dividers, form field borders, the focus ring |
| `--sidebar`, `--sidebar-*` | The sidebar's own surface, text, primary, accent, border and ring |

## Product colours

Artefactor's own colours, carrying meaning beyond the neutral theme. Each has its own light and
dark value.

- **Artefact kinds:** `--kind-prototype`, `--kind-slide-deck`, `--kind-form`,
  `--kind-interactive-doc` and `--kind-other`, each with a `-tint` (the same colour, translucent)
  for the chip behind it. The light values mirror `src/shared/kind-presentation.ts`, which the
  server-rendered host shell reads; a test keeps the two in step.
- **Collection hues:** `--collection-1` … `--collection-6`. A collection keeps the hue its id
  hashes to for life.
- The kind colours stay away from primary pink (hue 340) and from the hues a success (about 145),
  warning (about 80) or destructive (about 27) colour takes. A new success or warning token is
  checked against them.

Prefer the components that already apply them (`CardThumbnail`, `KindChips`, `ArtefactCard`).

## Rules

- **Tokens only.** `src/client/app.css` holds every colour. `pnpm lint` fails a raw colour, an
  inline style or a Tailwind palette utility (`text-red-600`, `bg-white`) anywhere else in the
  client; use a token utility (`bg-primary`, `text-muted-foreground`).
- **Pink means interactive.** The primary appears only on actions, links, focus and selected
  states, never as decoration.
- **Dark mode is free.** Every token switches under `.dark` or `[data-theme="dark"]`, so a
  component never needs a `dark:` colour of its own.
- **Contrast.** Every token pair drawn as text on a background reads at least 4.5:1 (WCAG 2), in
  light and in dark: `platform.theme.text-contrast`. The pairs and the maths are in
  [`src/shared/contrast.ts`](../../../src/shared/contrast.ts); a colour change that fails a pair
  doesn't land.

## Charts

A chart series takes a token colour: `var(--ring)` for a single series, a `--kind-*` or
`--collection-*` token when the series is a kind or a collection. The chart's `config` maps each
series key to its label and colour, and the series read `var(--color-<key>)`.

## The theme override

To explore a different palette in a design, override the tokens once, in a single `<style>` block
after the library's stylesheets, light on `:root` and dark on `[data-theme="dark"]`. That block is
the only place a raw colour is allowed; never recolour one component to change the theme. When the
palette shifts, override the product colours there too, in both themes. The design system's
conventions show the block. A theme that should ship comes back as a foundation hand-back that
changes this page and `app.css`.
