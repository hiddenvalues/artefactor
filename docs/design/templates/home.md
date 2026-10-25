# Screen: Home

## Purpose

Give a signed-in user one landing screen that answers two questions at a glance: *what was I just
working on?* and *where is everything, mine and shared with me?* It also lets them act on any
artefact without digging through menus.

## Layout

* **Top bar:** the no-tabs top bar with one search box that filters as you type.
* **Left bar:** the standard design system sidebar, with no extra "Shared with you" section.
* **Main pane:**
  * **Recent:** the artefacts the user most recently acted on (edited, uploaded or opened), their
    own or shared. Newest first, 1 row, as many cards as fit.
  * **Filter and sort bar:**
    * An **All / My artefacts / Shared with me** switch, with All as the default.
    * A **Label** dropdown and an **Access** dropdown.
    * On the right, a **Sort** dropdown (Last updated / Last viewed / Title A–Z) and a
      **card/list** toggle.
  * **All artefacts:** paginated, shown as cards or a list. Only the ArtefactCard component is
    used.

## Data per unit

* **Artefact:** title, kind, thumbnail, labels, access level (Private / Specific people / Members
  / Public), owner, bookmarked, last edited or uploaded time, last viewed time.
* **Recent:** artefacts ranked by the user's most recent action, whether they own them or not.
* **Counts:** a number next to All, My artefacts and Shared with me.
* **Label and access options:** drawn from the artefacts in the current view.

## Actions

* **Open an artefact** by clicking its card or row.
* **Card menu (…):** open in a new tab, copy link, manage access, add to collection, archive.
  Owner-only items are hidden for shared artefacts.
* **Filter:** by the All / My artefacts / Shared with me switch, by label and by access. Changing
  any of these goes back to page 1.
* **Sort:** by Last updated, Last viewed or Title A–Z, the same menu and remembered choice as a
  collection page.
* **Switch** between card and list view.
* **Change page** in All artefacts.

## States

* **Loading:** placeholder cards and rows while artefacts load.
* **Empty, new user:** an empty state with an **Upload** button.
* **Empty, filters match nothing:** an empty state with **Clear filters**.
* **Empty Shared with me:** "Nothing has been shared with you yet."
* **Recent:** hidden until the user has acted on at least one artefact.
* **One page only:** pagination is hidden.

## Responsive

* **Wide:** the whole filter and sort bar fits on one line. The switch and dropdowns are on the
  left, and sort and the card/list toggle are on the right.
* **Narrower:** the All / My artefacts / Shared with me switch moves to its own line, and the rest
  stays together on the line below.
* **Narrowest:** Label and Access share one line, and Sort plus the card/list toggle go on the
  next.
* **Recent and card grid:** the number of columns follows the available width, and Recent always
  stays 1 row.

## Prototype

[https://app.artefactor.cloud/a/aPOiBuEhxfM](<https://app.artefactor.cloud/a/aPOiBuEhxfM>)
