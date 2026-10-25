# Component: Artefact row

Replaces the current `ArtefactRow` and the existing `docs/design/components/artefact-row.md`.

## What changes

The row follows the card proposal
([ALI-482](https://linear.app/hiddenvalue/issue/ALI-482/artefact-card-ui-feedback)). Changes from
today's row:

* **Meta line:** kind, file size and the share link are removed. It now reads: Shared by (viewers,
  non-public only) · collection · saved data icon · last activity.
* **Inherited:** the INHERITED tag is replaced by the card's round folder icon, with the tooltip
  "Access inherited from “X”".
* **Share for viewers:** viewers now get a Share button when the artefact has a link. It copies
  the link and shows "Link copied".
* **Unchanged:** the layout and positions. Access badge, Share and "…" stay on the right.

## Anatomy

Left to right:

* **Kind tile:** 40px, the kind icon on the kind tint. Opens the artefact. It's the only place the
  kind shows.
* **Title block:**
  * Title row: title (one line, truncated) · bookmark button (when bookmarked).
  * Meta line: Shared by (viewers, non-public only) · "In X" with a hue-tinted folder · saved data
    icon · last activity. If nothing applies, the line is left out.
* **Right group** (unchanged position):
  * Access badge, with Lock / Clock icons inside it when a public link has a password or an
    expiry.
  * Inherited folder icon, when access comes from a collection (owners only).
  * Share button: owners always, viewers when the artefact has a link.
  * "…" menu.

## States

* **Private:** no Share for viewers; owners keep Share.
* **Org members / Specific people / Public:** no share link in the meta line. The link is reached
  through Share: owners via Manage access, viewers by copying.
* **Public:** no last activity and no "Shared by", same as the card.
* **Password / expiry:** Lock and Clock icons inside the access badge.
* **Collection:** "In X" in the meta line, with the folder tinted in the collection hue.
* **Inherited (owner):** round folder icon after the access badge, tooltip "Access inherited from
  “X”". Share opens the "Access inherited" popover.
* **Bookmarked:** filled bookmark button after the title.
* **Saves data:** database icon in the meta line.
* **Empty meta:** e.g. a public artefact you own with no collection and no saved data. The meta
  line is left out and the title centres on the kind tile.
* **Long title:** one line, truncated, with the full title in the tooltip.
* **Narrow screens:** the meta line wraps without a stray "·". Access badge, the inherited icon,
  Share and "…" drop below the title as one group, aligned right.
* **Hover:** the border tints toward primary and gains a soft shadow.
* **Menu open:** dropdown under "…", aligned right, above the rows below it.
* **Failure:** an error toast, and the row keeps its previous state.

## Behaviour

* **Open:** the kind tile, the title or "Open" in the menu opens the Artefact preview screen.
* **Bookmark:** the button after the title removes it, with an Undo toast. The menu item toggles
  it.
* **Collection link:** goes to that collection.
* **Share (owner):** opens the Manage access dialog, where the share link now lives (clicking the
  link copies it and shows "Link copied"). For inherited access, it opens the "Access inherited"
  popover with "Open “collection”".
* **Share (viewer):** copies the full link and shows a "Link copied" toast. Hidden when the
  artefact has no link.
* **"…" menu:**
  * Owner: Open · Bookmark / Remove bookmark · Add to collection… / Move to collection… · Edit ·
    Download HTML · Archive (destructive, after a separator, Undo toast).
  * Viewer: Open · Bookmark / Remove bookmark · Download HTML.
* Menus and popovers stack above the rows below them, and close on an outside click or Esc.
* **Failures:** an error toast keeps the previous state. A successful access change shows a toast
  with Undo.

## Accessibility

* The kind tile is a button labelled "Open \<title\>". The title is a button with the full title
  as its tooltip.
* The bookmark button is labelled "Remove bookmark". The saved data icon is `role="img"`,
  labelled "Saves data".
* The Lock / Clock icons are `role="img"`, labelled "Password protected" / "Link expires".
* The inherited icon is `role="img"`, labelled "Access inherited from “X”".
* The access badge carries the tooltip "Access: \<level\>".
* The Share button:
  * Owner: `aria-haspopup="dialog"`, tooltip "Manage access".
  * Viewer: tooltip "Copy link".
* The "…" button is labelled "More actions" and opens a `menu` of `menuitem`s.
* Toasts use `role="status"`.
* Tab order: kind tile → title → bookmark → collection → Share → "…".

## Prototype

[https://app.artefactor.cloud/a/PUQYU3D8zdE](https://app.artefactor.cloud/a/PUQYU3D8zdE)

## Engineering notes

Where this build departs from the hand-back, or pins down what it leaves open (carried over from
S56, or agreed in refinement, ALI-527):

* An artefact belongs to at most one collection (`Artefact.collectionId`), so the row shows "In X"
  only.
* The failure toasts keep the app's current wording ("Could not …"), shared with the card.
  "Couldn't … Try again." is ALI-481.
* The clock's label carries the expiry date ("Link expires \<date\>", or "Link expired"), from
  `LinkGateBadges`.
* The viewer's Share uses the card's and row's copy handler: "Link copied · \<host\>/a/\<slug\>",
  or "Couldn't copy the link" on failure (S62).
* An owner reaches the link through Share. On a top-level artefact it is in the Manage access
  dialog. Inside a collection it is at the top of the "Access inherited" popover (S64).
* The owner's Share is titled after what it opens: "Manage access" on a top-level artefact,
  "Access inherited" inside a collection, where it opens the popover rather than the dialog. The
  hand-back says "Manage access" everywhere (decided in review, ALI-527).
* The Share buttons are shared with the card, so their tooltips appear on the card too.
* The inherited icon names the tree root the artefact's access follows, as the "Access inherited"
  popover does; in a nested collection that is the root, not "X", the artefact's own collection.
  The card's icon names it the same way (decided in review, ALI-527).
* No card or row shows a size, so a collection page's Sort has no "Largest first" (decided in
  review, ALI-527).
* The inherited icon is the card's own (`InheritedIcon`, S62), reused as is: a corner-up arrow,
  where the hand-back says a round folder icon.
* The hand-back's text is kept as handed back; only its layout was adjusted for `pnpm lint:md`.
