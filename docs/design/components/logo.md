# Component: Logo

## Purpose

The Artefactor brand mark, the gem jar icon and the product name "Artefactor", as one component. It
appears in the top bar and on the sign-in and other auth screens. When it's given a destination, the
whole logo is one link to it. Where it goes is set by the screen that uses it.

## Prototype

[https://app.artefactor.cloud/a/tnEoN7SDGD4](<https://app.artefactor.cloud/a/tnEoN7SDGD4>)

## Anatomy

* **Link** (optional): a real `<a>` wrapping the icon and name, only when the logo is given a
  destination. Without one, it's a plain, non-clickable element.
* **Icon tile:** a rounded square (`rounded-md`, `bg-primary`), size-7 (`md`) or size-8 (`lg`).
* **Icon:** the gem jar mark (32×32 viewBox, drawn in `currentColor`, so `text-primary-foreground`
  on the tile), size-4 (`md`) or size-4.5 (`lg`). It replaces today's two-rectangle mark.
* **Name:** "Artefactor", `font-semibold tracking-tight`, 15px (`md`) or `text-lg` (`lg`), with a
  10px gap (`gap-2.5`) after the tile.

## Variants

| Variant | What differs | When |
| -- | -- | -- |
| Wide | Icon tile and the name "Artefactor" | At or above `sm` |
| Narrow | Icon tile only; the name is hidden | Below `sm` |
| Size `md` | Tile 28px, icon 16px, name 15px | Top bar |
| Size `lg` | Tile 32px, icon 18px, name 18px | Auth screens |
| Link / not a link | With a destination, the whole logo is one link to it; without one, it's a plain image named "Artefactor" | Decided by the screen using it |

## States

| State | Looks like |
| -- | -- |
| Default | Primary tile with the gem jar icon in `primary-foreground`, with the name beside it (wide) or not (narrow) |
| Hover (link only) | Pointer cursor; no other visual change |
| Focus (link only) | Focus ring at 3px, `ring/50`, around the whole logo, rounded |
| Dark theme | The tile and icon follow the `primary` / `primary-foreground` tokens, and the name follows `foreground` |
| Not a link | No hover or focus states; it isn't focusable |

## Behaviour

* **With a destination:** clicking the icon or the name follows the link that the screen using it
  provides. It's a normal link, so open-in-new-tab and middle-click work.
* **Without a destination:** clicking does nothing.
* **Narrow:** below `sm`, the name is hidden and the icon alone is the link, with the same
  destination.
* **No other behaviour:** no menu and no tooltip.

## Accessibility

* **As a link:** a real `<a href>` named "Artefactor" plus wherever it goes, for example
  "Artefactor, go to Home". The screen using it supplies that name, together with the destination.
  The name stays the same below `sm`, where only the icon shows.
* **Not a link:** `role="img"` named "Artefactor". It isn't focusable.
* **The icon** is decorative (`aria-hidden`), because the name already says what it is.
* **Contrast:** the icon reaches 3:1 against its tile (WCAG 1.4.11), and the tile reaches 3:1
  against the page, in light and dark. The name text reaches 4.5:1 against the page.
* **Focus:** a visible ring at 3px, `ring/50`, around the whole logo.

## Content

* **Name:** "Artefactor", exactly that capitalisation, never translated. It's hidden below `sm`.
* **Accessible name:** "Artefactor" when it isn't a link. As a link, "Artefactor, {where it goes}",
  supplied by the screen using it.
* **No other text, and no tooltip.**

## Non-goals

* It doesn't decide where it goes when clicked. The screen using it supplies the destination (Top
  bar: Home).
* It has no menu, tooltip or animation.
* It doesn't change colour theme by itself. It follows the `primary` tokens, so a future theme
  hand-back (such as the Gemjar themes) recolours it without touching the component.
* It isn't a favicon or an app icon. Those are separate assets.

## Out of scope

* **Making it a link to Home in the top bar:** covered by the Top bar hand-back.
* **The Gemjar colour themes** (such as Deep crown or Mint garden) from the branding file: a
  separate colour-foundation hand-back, if you want them.
* **Favicon, app icon and social / share images** with the new mark: separate assets, handed back
  later.
* **Other places the logo may appear,** like emails and exported files: unchanged for now.

## Must not break

* **Current uses keep working:** the top bar and the auth screens (sign-in, set password, OAuth
  consent) still render `Logo` at their current sizes, and the `size` prop (`md` / `lg`) keeps its
  meaning.
* **Without a destination,** `Logo` renders as today: not a link, nothing to click. So screens that
  don't pass one are unchanged apart from the new icon.
* **Contrast** stays within `platform.theme.text-contrast` for the name, and at 3:1 for the icon on
  its tile, in light and dark.
* **Lint:** colours only from tokens, with no raw colour values. The link uses the app's link
  component or a plain `<a>`, as the lint rules allow.
* **Catalog:** the sibling `Logo.preview.tsx` gains variants for wide, narrow, both sizes, as a link
  and not a link, so the catalog test passes.

## Acceptance

 1. Everywhere the logo appears, the old two-rectangle mark is replaced by the gem jar icon, in
    `primary-foreground` on the `primary` tile.
 2. At or above `sm`, the logo shows the icon and "Artefactor". Below `sm`, it shows only the icon,
    with no gap or empty space left behind.
 3. Sizes match: `md` is a 28px tile, 16px icon and 15px name; `lg` is a 32px tile, 18px icon and
    18px name.
 4. Given a destination, clicking the icon or the name goes there, and the whole logo is one link:
    one Tab stop, and opening in a new tab works.
 5. Without a destination, the logo isn't focusable and nothing happens on click.
 6. Hovering the link shows the pointer cursor and no other change. Keyboard focus shows a 3px ring
    around the whole logo.
 7. A screen reader announces the link as "Artefactor, {destination}" (for example "Artefactor, go
    to Home"), and the plain logo as "Artefactor". The icon isn't announced separately.
 8. The icon meets 3:1 against its tile, and the name meets 4.5:1 against the page, in light and
    dark.
 9. The sign-in and other auth screens show the new mark at `lg`, with no other change.
10. The catalog shows `Logo` previews for wide, narrow, `md`, `lg`, link and not a link.
