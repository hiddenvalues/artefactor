# Component: Artefact card

Replaces the current `docs/design/components/artefact-card.md`
([ALI-482](https://linear.app/hiddenvalue/issue/ALI-482/artefact-card-ui-feedback)).

## What changes

* **Layout:** the card fills its grid cell; the access row sits on the bottom edge, below the
  activity line.
* **Kind:** the kind badge on the thumbnail is removed. The kind icon (`kindMeta(kind).icon`,
  16px, `--kind` colour, as in the top-bar search) sits before the title instead. The thumbnail
  itself is unchanged.
* **File size:** removed from every card.
* **Share-link footer:** the `/a/<slug>` footer is removed from every card, for owners and viewers.
* **Inherited:** the INHERITED badge becomes an icon, so Share fits on the same row. Tooltip:
  "Access inherited from “\<collection>”".
* **Share (viewer):** viewers get a Share button when access isn't Private. It copies the link and
  shows a "Link copied" toast; it doesn't open Manage access.
* **Share (owner):** unchanged. It opens Manage access, or the "Access inherited" popover when
  inherited.

## Anatomy

1. **Thumbnail** (16:10, opens the artefact): preview image, kind-tinted striped pattern + kind
   icon when there's no preview, or the generating state. Saved-data icon and bookmark button
   top-right. No kind badge.
2. **Title row:** kind icon (16px, `--kind` colour) · title (up to two lines, then truncated
   with "…"; full title in the tooltip; opens the artefact) · "…" menu button.
3. **Collection** (when in one): folder icon tinted with the collection hue · "In X".
4. **Activity:** last activity, hidden when public.
5. **Access row** (on the bottom edge):
   * Owner: access badge (+ lock / clock icons) · inherited icon when inherited · Share,
     right-aligned.
   * Viewer: access badge · "Shared by …" (hidden when public) · Share, right-aligned, when access
     isn't Private.

## States

* **Preview:** image, cropped to the top.
* **No preview:** kind-tinted striped pattern with the kind icon.
* **Generating:** muted shimmer, spinner and "Generating preview…".
* **Bookmarked:** filled bookmark top-right.
* **Saves data:** database icon top-right, left of the bookmark.
* **Public with protection:** lock (password) and/or clock (expiry) icons inside the access badge.
* **Public:** last activity hidden (owner and viewer); "Shared by" hidden (viewer).
* **Private:** no Share button for viewers.
* **Inherited:** inherited icon on the access row, with the tooltip "Access inherited from
  “\<collection>”".
* **Long title:** up to two lines, then truncated with "…"; full title in the tooltip. The kind
  icon and the "More actions" menu button stay level with the first line.
* **Uneven content:** cards in a row share the same height, with the access rows lined up along
  the bottom.
* **Hover:** the card lifts and its border picks up the primary colour.
* **Menu open:** dropdown under the "…" button, aligned to the right edge.

## Behaviour

* **Open:** clicking the thumbnail, the title or "Open" in the menu opens the Artefact preview
  screen.
* **Bookmark:** the menu item toggles it. The top-right bookmark icon removes it, with an Undo
  toast, and doesn't open the artefact.
* **"…" menu**
  * Owner: Open · Bookmark / Remove bookmark · Add to collection… or Move to collection… · Edit ·
    Download HTML · Archive (destructive, after a separator, with an Undo toast).
  * Viewer: Open · Bookmark · Download HTML.
* **Share (owner):** opens the Manage access dialog. Inherited: opens today's "Access inherited"
  popover.
* **Share (viewer):** copies the full `/a/<slug>` URL and shows a "Link copied" toast. Shown only
  when access isn't Private.
* **Collection link:** goes to that collection.
* **Failures:** a failed copy shows an error toast; a failed access change shows an error toast and
  keeps the previous state.

## Accessibility

* The thumbnail is a button labelled "Open \<title>". The title is a button with the full title as
  its tooltip.
* The kind icon is `role="img"`, labelled with the kind name ("Prototype", "Slide deck", …).
* The "…" button is labelled "More actions"; the menu uses `role="menu"` / `menuitem`; Esc or
  clicking outside closes it.
* The bookmark button is labelled "Remove bookmark"; the saved-data icon is `role="img"` labelled
  "Saves data"; the lock and clock icons are labelled "Password protected" and "Link expires".
* The access badge has the tooltip "Access: \<level>". The inherited icon is `role="img"` labelled
  "Access inherited from “\<collection>”".
* Share (owner) has `aria-haspopup="dialog"`. Share (viewer) is labelled "Copy link" and announces
  "Link copied" through the toast.
* Toasts use `role="status"`.
* Tab order: thumbnail → bookmark → title → "…" → collection → Share.

## Prototype

[https://app.artefactor.cloud/a/eb3zH2roLGo](<https://app.artefactor.cloud/a/eb3zH2roLGo>)

## Engineering notes

Where this build departs from the hand-back, as agreed in refinement
([ALI-524](https://linear.app/hiddenvalue/issue/ALI-524)):

* This card, and its row (`ArtefactRow`), are the only artefact card and row. Collection pages
  show other users' artefacts with the viewer variant.
* On their own collection page, the collection's owner gets **Remove from collection** in the
  viewer's "…" menu, after a separator, over the S29 eject.
* The **Generating** thumbnail state isn't built yet; the summary doesn't say a render is pending
  (ALI-477).
* The copy toast reads "Link copied · \<host>/a/\<slug>", as everywhere else in the app. A failed
  copy toasts "Couldn't copy the link".
* A viewer's access row wraps when it doesn't fit: "Shared by …" and Share move to a second line
  together, as in the prototype. An owner's stays one line, its access label truncating on the
  narrowest card so Share stays whole.
* A hovered card stays beneath the sticky top bar when scrolled under it (kept from S54).
* The inherited icon names the tree root the access follows, as the "Access inherited" popover
  does, and the owner's Share is titled "Manage access" on a top-level artefact and "Access
  inherited" inside a collection (S65).
* The hand-back's text is kept as handed back; only its layout was adjusted for `pnpm lint:md`.
