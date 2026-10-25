# Component: Top bar

## Purpose

The app's top bar, on every signed-in screen: sidebar toggle, logo, global search, New artefact, and
the account entry point. This revision replaces the built-in account section with `AccountMenu`
([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)), and
makes the logo ([ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo)) a
link to Home that shows only the icon below `sm`. The search and New artefact are unchanged.

## Prototype

[https://app.artefactor.cloud/a/oG7Es93Mf5s](<https://app.artefactor.cloud/a/oG7Es93Mf5s>)

## Anatomy

Left to right:

* **Sidebar toggle:** ghost icon `Button` with the `Menu` icon.
* **Logo:** the `Logo` component
  ([ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo)), given Home as
  its destination. Below `sm` it shows only the icon.
* **Global search:** `Input` with a `Search` icon, inside `role="search"`, with its results
  `Popover`. Unchanged.
* **Spacer.**
* **New artefact:** primary `Button` with the `Plus` icon. Unchanged.
* **Account:** `AccountMenu`
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)): the
  Default variant at or above `sm`, the Avatar variant below `sm`, and the signed-out state when
  nobody is signed in.

**Signed out**, the bar shows only the logo and `AccountMenu`'s Sign in button. The sidebar toggle,
search and New artefact are hidden.

## Variants

| Variant | What differs | When |
| -- | -- | -- |
| Signed in, wide | Full logo (icon and name), search, New artefact, AccountMenu Default variant | At or above `sm` |
| Signed in, narrow | Icon-only logo, the search shrinks first, New artefact, AccountMenu Avatar variant | Below `sm` |
| Signed out | Logo and Sign in button only | No user signed in, at any width; the logo follows the same `sm` rule |

## States

| State | Looks like |
| -- | -- |
| Default | Empty search, placeholder "Search artefacts and collections…" |
| Filter as you type | A results dropdown opens under the search, grouped **Collections** then **Artefacts** (up to 3 and 5). Matching text is bold, and each row shows the collection colour or kind icon, plus where it lives or who shared it. The first result is highlighted. A clear (×) button appears in the field. Footer hints: ↑↓ to move · Enter to open · Esc to close. |
| No results | "No matches for “…”", with "Try another word, or check the spelling." |
| Narrow (below `sm`) | The search shrinks first. The logo shows only the icon, and AccountMenu shows only the avatar. The sidebar toggle and New artefact keep their size. |
| Logo states | As in Logo ([ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo)) |
| Account states | As in AccountMenu ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)) |

## Behaviour

* **Logo:** TopBar gives `Logo` its destination. Signed in, that's Home (the active organization's
  dashboard), from any page. Signed out, it's the public landing / sign-in page, for now.
* **Search:** keep today's filter-as-you-type pattern (`query` + `onSearch`), but search across all
  artefacts and collections the user can see (own and shared), on any page. ↑↓ moves the highlight,
  Enter opens the highlighted result, and Esc closes the dropdown. Clearing the field closes it too.
  How results are fetched and ranked is up to engineering, matching the app's existing search logic.
* **Props:** remove the `view`, `onGoDashboard` and `onGoGallery` props. `searchPlaceholder` becomes
  the fixed text "Search artefacts and collections…". Add `onGoHome` for the logo.
* **Account:** everything about the account button and menu is in AccountMenu
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)). TopBar
  passes it the user, the variant and its callbacks.
* **Unchanged:** the sidebar toggle and New artefact.

## Accessibility

* **Logo:** TopBar gives `Logo` the link name "Artefactor, go to Home". The rest is as in
  [ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo).
* **Search:** wrapped in `role="search"`. The field has `aria-label="Search artefacts and
  collections"`, and `aria-expanded` while results are open. Results are a `listbox` of `option`s,
  with `aria-selected` on the highlighted one. The no-results message uses `role="status"`.
* **Sidebar toggle:** named "Toggle sidebar".
* **Account:** names, keys and focus as in AccountMenu
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)).
* **Tab order:** sidebar toggle → logo → search → New artefact → account button (or Sign in). Signed
  out: logo → Sign in.

## Content

* **Logo link name:** "Artefactor, go to Home". The logo's own text is as in
  [ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo).
* **Search placeholder:** "Search artefacts and collections…" (fixed).
* **Search results:** group headings "Collections" and "Artefacts". No results: "No matches for
  “{query}”" and "Try another word, or check the spelling." Footer hints: "↑↓ to move", "Enter to
  open", "Esc to close".
* **Buttons:** "New artefact". The sidebar toggle has the tooltip "Toggle sidebar".
* **Account text:** as in AccountMenu
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)).

## Non-goals

* TopBar doesn't own any account logic. It mounts `AccountMenu`
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)) and
  passes it what it needs.
* It doesn't draw its own logo. It mounts `Logo`
  ([ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo)) and only sets
  where it goes.
* It has no navigation tabs. Dashboard and Gallery tabs stay removed, and navigation lives in the
  sidebar.
* It doesn't fetch or rank search results itself. That stays with the app's existing search logic.

## Out of scope

* **The account button and menu themselves:** covered by AccountMenu
  ([ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu)).
* **The logo's icon, sizes and narrow version:** covered by Logo
  ([ALI-618](https://linear.app/hiddenvalue/issue/ALI-618/component-hand-back-logo)).
* **The global search** beyond what's already specified (fetching, ranking, the results design):
  unchanged.
* **The sidebar** and its toggle behaviour: unchanged.
* **The Usage feature:** hidden until it exists.

## Must not break

* **Every signed-in screen** inside `AppShell` still shows the top bar, sticky at the top, with the
  backdrop blur.
* **Search** keeps working on every page: filter-as-you-type, keyboard navigation and the no-results
  message.
* **New artefact** still opens the upload dialog.
* **The sidebar toggle** still opens and closes the sidebar.
* **Grid cards** still lift beneath the sticky top bar on hover
  (`platform.client.card-lift-under-top-bar`).
* **Contrast** stays within `platform.theme.text-contrast`, in light and dark.
* **Lint:** built only from the shadcn wrappers and the product components (`Logo`, `AccountMenu`),
  with no raw controls, so `pnpm lint` passes.
* **Catalog:** `TopBar.preview.tsx` is updated with signed in (wide and narrow), signed out, and the
  search states, so the catalog test passes.

## Acceptance

 1. Signed in at or above `sm`, the bar shows, left to right: sidebar toggle, logo (icon and
    "Artefactor"), search, spacer, New artefact, then the account button with organization name,
    role badge and chevron.
 2. Below `sm`, the logo shows only the icon, the search is narrower, and the account button shows
    only the avatar. Nothing overflows at 390px.
 3. Clicking the logo, the icon or the name, goes to Home: the active organization's dashboard.
    Signed out, it goes to the public landing / sign-in page.
 4. Signed out, the bar shows only the logo and a primary "Sign in" button. The sidebar toggle,
    search and New artefact aren't shown.
 5. The account button and its menu behave as in
    [ALI-616](https://linear.app/hiddenvalue/issue/ALI-616/component-hand-back-account-menu). TopBar
    adds no account items of its own.
 6. Search behaves as today: typing filters, ↑↓ and Enter work, Esc closes, and "No matches for “…”"
    shows when nothing matches.
 7. The bar has no `view`, `onGoDashboard` or `onGoGallery` props, and no tabs.
 8. Tab order, signed in: sidebar toggle → logo → search → New artefact → account button. Signed
    out: logo → Sign in.
 9. A screen reader announces the logo as "Artefactor, go to Home".
10. The catalog shows TopBar previews for signed in (wide and narrow), signed out, and each search
    state.
