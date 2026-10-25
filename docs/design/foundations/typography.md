# Typography

The app sets no font of its own: it uses Tailwind's default stacks, read through `--font-sans` and
`--font-mono`. The design system's Typography view shows them.

## Font stacks

- **Sans**, for all text: the system UI stack (`-apple-system`, `BlinkMacSystemFont`,
  `Segoe UI`, Roboto, `Helvetica Neue`, `Noto Sans`, Arial, `sans-serif`, then the colour-emoji
  fonts).
- **Mono**, for share links, file names and code: the system monospace stack (`ui-monospace`,
  SF Mono, Menlo, Consolas and their fallbacks).
- **The host shell** (`/a/:slug`, server-rendered) uses the same sans stack and loads no web font.

A font change sets `--font-sans` (and loads the font); every text in the app follows. The host
shell copies the stack into its own stylesheet (`renderHostShell`), and its test fails until the
copy matches; the shell still loads no web font, so a web font at the head of the stack shows
there as its system fallback.

## Type scale

The app uses a few steps of Tailwind's scale, each with a role:

| Class | Used for |
| --- | --- |
| `text-xs` | Captions, badges, meta lines (dates, counts) |
| `text-sm` | Body text, controls, menus, table and list rows |
| `text-base` | An empty state's title; a form field on a phone (`text-base md:text-sm`, so the browser doesn't zoom) |
| `text-lg` | Dialog and sign-in card titles, a screen's section headings |
| `text-xl` | The screen's title, with `tracking-tight` |

Long titles truncate (`truncate`, or `line-clamp-*` where two lines fit), never wrap the layout.

## Weights

`font-medium` for controls, labels and titles in a list; `font-semibold` for headings, titles and
the screen's title. Body text stays at the regular weight.

## The mono style for share links

A share link (`/a/…`) is drawn `font-mono text-sm` in the primary colour, as a link button, so it
reads as something to copy or open, not as prose.
