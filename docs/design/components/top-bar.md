# Component: Top bar

## What changes

Remove the Your artefacts / Shared with you tabs from the top bar. They move into the landing
page's main pane (separate change request). Search becomes global — it searches everything,
whatever page you're on.

## Anatomy

Left to right: sidebar toggle · logo · global search · spacer · New artefact · account menu
(theme picker, sign out). Everything except the tabs stays as today.

## States

* **Default:** empty search, placeholder "Search artefacts and collections…".
* **Filter as you type:** a results dropdown opens under the search, grouped **Collections**
  then **Artefacts** (up to 3 and 5). The matching text is bold; each row shows the collection
  colour or kind icon, plus where it lives or who shared it. The first result is highlighted. A
  clear (×) button appears in the field. Footer hints: ↑↓ to move · Enter to open · Esc to close.
* **No results:** "No matches for “…”" with "Try another word, or check the spelling."
* **Narrow screens:** the search shrinks first; logo, New artefact and account menu keep their
  size.

## Behaviour

* Keep today's filter-as-you-type pattern (`query` + `onSearch`), but search across all
  artefacts and collections the user can see (own and shared), on any page.
* ↑↓ moves the highlight, Enter opens the highlighted result, Esc closes the dropdown. Clearing
  the field closes it too.
* Sidebar toggle, New artefact and account menu are unchanged.
* Remove the `view`, `onGoDashboard` and `onGoGallery` props; `searchPlaceholder` becomes the
  fixed "Search artefacts and collections…".
* How results are fetched and ranked is up to engineering, matching the app's existing search
  logic.

## Accessibility

* The search is wrapped in `role="search"`; the field has `aria-label="Search artefacts and
  collections"` and `aria-expanded` while results are open.
* Results are a `listbox` of `option`s, with `aria-selected` on the highlighted one; the
  no-results message uses `role="status"`.
* Tab order: sidebar toggle → logo → search → New artefact → account menu. Removing the tabs
  removes their `aria-current` states.

## Prototype

[https://app.artefactor.cloud/a/BEbOjqA9HJ8](<https://app.artefactor.cloud/a/BEbOjqA9HJ8>)
