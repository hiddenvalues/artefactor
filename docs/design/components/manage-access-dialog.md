# Component: Manage access dialog

Replaces the current `ManageAccessDialog` for artefacts and any existing
`docs/design/components/manage-access-dialog.md`. Opened from the Artefact card's Share button (see
*Component hand-back: Artefact card*,
[ALI-469](<https://linear.app/hiddenvalue/issue/ALI-469/component-hand-back-artefact-card>)).
Addresses [ALI-488](<https://linear.app/hiddenvalue/issue/ALI-488/access-dialog-ui-feedback>).

## What changes

**Viewer search opens in a popover.** In Specific people, the search results open in a popover
anchored under the search field, over "People with access" and the sections below, instead of
pushing them down. The dialog keeps its height while you type, as results come and go.

**Specific people help text** is now "Only org members you invite", making clear that only people in
the organisation can be invited.

**One dialog for all sharing.** Opened from the card's Share button. Holds every access setting that
used to live on the card's dropdown and popovers, in sections that show only when they apply:

1. **General settings** (always): a dropdown of access levels, each with an icon, help text and a
   check on the current one: Private (default), "Only you" · Specific people, "Only org members you
   invite" · Org members, "Anyone in the organisation" · Public, "Anyone with the link", with lock /
   clock icons when password / expiry is set.
2. **Link** (not Private): the short link `/a/\<slug>`; clicking copies it with a toast.
3. **Viewers** (Specific people only): search with a results popover + "People with access · N"
   list.
4. **Link protection** (Public only): today's password and expiry controls, as in the repo.
5. **Saved data** (artefact saves data and isn't Private): "Only each viewer's own" / "Shared with
   viewers", as today.

**Saving.** Changes are drafts until **Done**. **Cancel**, Esc or clicking outside discards them.
Done is disabled while link protection has an error. Saving shows one toast with Undo; a failure
shows an error toast and keeps the previous state.

**Unchanged.** Collections keep today's people-only dialog.

## Anatomy

Top to bottom, max width 460px:

1. **Header:** "Manage access" · "Who can open “\<title>”" (one line, truncated).
2. **General settings:** section label, then a full-width trigger: round icon tile · access level (+
   lock / clock icons) · help text · chevron. It opens a listbox of the four levels, each with an
   icon, label, help text and a check on the current one.
3. **Link:** section label · `/a/\<slug>` with a link icon (primary colour, mono).
4. **Viewers:** section label · search field with a search icon · **results popover** anchored under
   the field, full field width, max 220px tall with its own scroll (avatar, name, email, +), shown
   over the content below · "People with access · N" · member rows (avatar, name, email, × to
   remove) or a dashed empty state.
5. **Link protection:** section label · "Require a password" checkbox → generated password field +
   Copy, or "Password set" with Change / Clear · "Link expires" select (Never, 1 / 7 / 30 days,
   Custom…) → date-time field, or "Expires \<date>" with Change · inline error.
6. **Saved data:** section label · a two-option radio group, with a check on the current one.
7. **Footer:** Cancel (outline) · Done (primary), right-aligned.

A divider sits above every section after General settings.

## States

* **Private:** General settings only.
* **Specific people, with viewers:** Link + Viewers showing the current list.
* **Specific people, no viewers:** the hint "No one yet — search above to add people. Until then,
  only you can open it."
* **Searching:** a results popover opens under the field as soon as you type, showing "Searching…",
  then the matches or "No people found." People already added are left out. The dialog's height
  doesn't change.
* **Org members:** Link (+ Saved data when the artefact saves data).
* **Public, no protection:** Link + Link protection with the controls off (+ Saved data).
* **Public, protected:** "Password set" and/or "Expires \<date>" rows with Change / Clear; lock /
  clock icons on the trigger and on the Public option.
* **New password:** a generated 16-character password shown once, with Copy → "Copied". The note
  "Share it with the people you send the link to. It is shown only now."
* **Invalid protection:** an inline error ("The password needs at least 8 characters." / "Pick an
  expiry date in the future."); Done is disabled.
* **Level dropdown open:** a listbox over the sections below it; clicking outside or Esc closes it.
* **Invite offered** (where the deployment invites, S33b): a query that is a well-formed email no
  result has ends the results with "Invite \<email>" (mail icon), in place of "No people found." when
  nothing else matched. An email already in the list or already invited offers nothing.
* **Pending invitations** (S33b): rows below the members, each with an envelope avatar, the email,
  "Invited · expires \<date>" (or "Will be invited" before Done) and ×. "People with access · N"
  counts them. If the invitations can't load, neither the rows nor the Invite option show, and the
  rest of the dialog works as usual.

## Behaviour

* **Changing level** only updates the draft; sections show or hide straight away to match.
* **Specific people:** coming from another level starts with the remembered viewers (an empty list
  if there are none); if it's already Specific people, it starts with the saved viewers. × removes a
  person.
  * Typing opens the results popover; clearing the field closes it.
  * ↑ / ↓ moves the highlight, Enter or a click adds the person. Adding clears the field, closes the
    popover and keeps focus in the field so you can add the next person.
  * Esc or clicking outside closes the popover, but not the dialog.
  * The popover sits above the dialog's scroll area, so the dialog's edge never cuts it off.
  * Selecting "Invite \<email>" works like adding a person: a "Will be invited" row appears, the
    field clears and keeps focus. × on an invitation row takes it out of the draft.
* **Public:** coming from another level starts with protection off; if it's already Public, it keeps
  the saved password and expiry, which can be changed or cleared.
* **Link:** clicking copies the full URL and shows a "Link copied" toast.
* **Saved data:** picking an option updates the draft.
* **Done:** saves every change in one go and closes the dialog.
  * One toast with Undo: the access level if it changed, otherwise the viewer count ("2 people can
    now open …"), otherwise "Public link settings saved", otherwise the saved-data choice.
  * With no changes, it just closes.
  * Invitations go after the sharing save: each new email is sent, then each removed invitation is
    withdrawn. The same toast reports them after the save's message, keeping its Undo:
    "Invitation sent to \<email>" or "N invitations sent", and "Invitation removed" or "N
    invitations removed". A Done that only changes invitations shows just that part, without
    Undo. An invite or removal that fails turns that toast into an error naming its email, and the
    others still go out.
* **Cancel / Esc / clicking outside:** closes and discards the draft.
* **Failure:** an error toast ("Couldn't make “…” public. Try again."); nothing changes.
* **Rules from the repo:** password 8–128 characters; expiry presets and custom date as today.

## Accessibility

* Uses the design system's `Dialog` (`role="dialog"`, `aria-modal`), titled "Manage access" with the
  "Who can open …" description; focus is trapped inside and returns to the Share button on close.
* The level trigger has `aria-haspopup="listbox"`; the options are `role="option"` with
  `aria-selected` on the current one; Esc closes the list before the dialog.
* The lock and clock icons are `role="img"` labelled "Password protected" and "Link expires".
* The search field is labelled "Search people" and is a `combobox` (`aria-expanded`, `aria-controls`
  the results, `aria-activedescendant` for the highlighted row). The results are a `listbox` of
  `option`s; "Searching…" and "No people found." are read as status text. Esc closes the popover
  before the dialog. Each × is labelled "Remove \<name>"; the empty state is read as text.
* "Invite \<email>" is an `option` in the same listbox. An invitation row's × is labelled "Remove
  invitation for \<email>".
* Password and expiry fields are labelled ("Link password", "Link expires"); errors are linked to
  their fields with `aria-describedby`.
* Saved data is a `radiogroup` with `aria-checked`.
* The link button is labelled "Copy link /a/\<slug>"; toasts use `role="status"`.
* Tab order: level trigger → link → search → members → protection → saved data → Cancel → Done.

## Prototype

[https://app.artefactor.cloud/a/6IjhZBN3YJM](<https://app.artefactor.cloud/a/6IjhZBN3YJM>)

## Engineering notes

* Done saves through one atomic `PUT /api/artefacts/:id/sharing`, so a failure really changes
  nothing.
* Undo is left out after a save that set, changed or cleared a password, or left Public with one:
  the stored hash can't be restored.
* Specific people starts from the remembered access list (`hosting.access-list.retained`), so a
  brief switch to Private doesn't erase the owner's invitations. The empty-state hint shows only
  when that list is empty.
* A level chosen for an artefact never shared before has no slug yet. The Link section says "The
  link is created when you click Done." instead of a link.
* The dialog opens from the card's Share on a top-level artefact. An artefact inside a collection
  keeps the "Access inherited" popover, and the list row keeps its popover until the Artefact row
  hand-back
  ([ALI-475](https://linear.app/hiddenvalue/issue/ALI-475/artefact-row-the-cards-content-and-actions-on-one-row-s56))
  adopts the dialog.
* The results popover renders in a portal (e.g. the design system's `Popover`, anchored to the
  field), so the dialog's `overflow-y-auto` body doesn't clip it.
* Invitations (S33b) show only where `/api/config` reports `capabilities.shareInvitations`. Done
  sends `PUT …/sharing` first, then `POST /api/artefacts/:id/invitations` per new email and
  `DELETE …/invitations/:invitationId` per removed one. A `granted` answer (the email already had
  an Account) refreshes the library, as a save does. A failed `GET …/invitations` hides the
  invitations and sends none, but leaves Done working. Saved invitations load at every level,
  Private included, since they are kept like the remembered access list. Only a Specific people
  draft sends new invitations; a removed one is withdrawn from any level.
