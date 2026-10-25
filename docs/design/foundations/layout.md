# Layout

Spacing, shape, depth and motion. The radius and the card-lift shadow are tokens in
[`src/client/app.css`](../../../src/client/app.css); spacing and the other shadows are Tailwind's
own scales. The design system's Spacing, Corner radius and Shadows views show them.

## Spacing

Tailwind's spacing scale: one unit is a quarter rem, and `p-4`, `gap-4` and `size-4` are four
units. Space with the scale (`gap-2`, `p-6`, `space-y-4`), never an arbitrary value. Lay a screen
out with flex and grid, and let content reflow at the `sm`, `md`, `lg` and `xl` breakpoints rather
than fixing widths.

## Radius

`--radius` is the one radius token; the `sm`, `md`, `lg` and `xl` steps derive from it, two
smaller and one larger. Controls take `rounded-md`, cards `rounded-xl`, badges `rounded-full`. A
radius change sets `--radius`, and every step follows.

## Elevation and shadows

Depth is quiet: a border does most of the separating.

- A list row sits flat at `shadow-xs` and rises to `shadow-sm` on hover.
- A grid card lifts on hover: it rises and scales slightly, its shadow deepens to
  `shadow-card-lift` and its border takes a primary tint. The lift stays beneath the sticky top
  bar (`platform.client.card-lift-under-top-bar`).
- Menus, popovers and dialogs float on the stock shadcn/ui shadows.

## Motion

- **Short and eased.** Hover changes run for a fraction of a second, eased out; colour changes use
  `transition-colors`.
- **Reduced motion is honoured.** Under `prefers-reduced-motion` a grid card drops the rise and the
  scale, keeping the shadow and the border.
- **Things that move, mean something:** a tree's chevron rotates when it expands; a pending action
  spins `Loader2`. Nothing animates for decoration.
