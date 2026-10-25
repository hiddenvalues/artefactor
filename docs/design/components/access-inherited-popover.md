# Component: Access inherited popover

The "Access inherited" popover that the artefact card, artefact row and Manage access specs refer
to. Related:
[ALI-524](https://linear.app/hiddenvalue/issue/ALI-524/artefact-card-one-card-for-every-artefact-kind-by-the-title-access-on)
(artefact card).

## What changes

* **New component:** `AccessInheritedPopover`, pulled out of `VisibilityControl`'s `inherited`
  branch. The artefact card's Share button and the access pill open it. Its content is otherwise
  unchanged.
* **Link at the top:** when access isn't Private, a **Link** section sits at the top of the
  popover, followed by a divider. It's the same as the Manage access dialog's Link section: a
  "LINK" section label, then `/a/<slug>` with a link icon, mono text in the primary colour. It
  replaces the share-link footer removed from the card
  ([ALI-524](https://linear.app/hiddenvalue/issue/ALI-524/artefact-card-one-card-for-every-artefact-kind-by-the-title-access-on)).
* **Private:** no Link section; the popover looks as it does today.
* **Expired link protection:** the link still shows, and the protection box below it says the
  link has expired.

## Anatomy

Top to bottom (288px from Share, 256px from the access pill, aligned to the trigger's right edge):

1. **Link** (not Private): "LINK" section label · `/a/<slug>` with a link icon, mono text in the
   primary colour. Then a divider.
2. **Access inherited:** title · "This artefact is in “\<collection\>” and follows its access.
   Change it on the collection."
3. **Link protection** (when the collection's public link has a password or expiry): bordered box
   with a lock icon · "Link protection inherited from “\<root\>”" · the password and expiry
   details, in red when expired.
4. **Open “\<collection\>”:** full-width outline button.
5. **Saved data** (when the artefact saves data): divider · "SAVED DATA" label · two radio
   choices.

## States

* **Org members / Specific people / Public:** Link section at the top.
* **Private:** no Link section; the popover starts at "Access inherited".
* **Public with link protection:** protection box with the password and/or expiry details.
* **Expired link protection:** the link still shows, and the protection box says it has expired,
  in red.
* **Saves data:** Saved data section at the bottom, with the current choice highlighted.
* **From Share:** 288px wide. **From the access pill:** 256px wide. Both are aligned to the
  trigger's right edge.

## Behaviour

* **Open:** the artefact card's Share button (owner, inherited access) or the access pill opens
  the popover. Clicking the trigger again, pressing Esc or clicking outside closes it.
* **Link:** clicking `/a/<slug>` copies the full URL and shows a "Link copied" toast, as in
  Manage access. The popover stays open.
* **Open “\<collection\>”:** closes the popover and goes to the collection, where access can be
  changed.
* **Saved data:** picking a choice saves it and closes the popover. A failed save shows an error
  toast and keeps the previous choice.
* **Read-only access:** the access level can't be changed from here.
* **Failures:** a failed copy shows an error toast.

## Accessibility

* The trigger has `aria-haspopup="dialog"` and `aria-expanded`. The popover is labelled "Access
  inherited".
* The link button is labelled "Copy link /a/\<slug\>", with the tooltip "Copy \<full URL\>", as in
  Manage access.
* The lock icon is decorative. The protection text says the same thing.
* The Saved data choices are a `radiogroup` labelled "Saved data".
* Focus moves into the popover when it opens and returns to the trigger when it closes. Esc closes
  it.
* Toasts use `role="status"`.
* Tab order: Link → Open “\<collection\>” → Saved data choices.

## Prototype

[https://app.artefactor.cloud/a/FMuUgZSz1yQ](<https://app.artefactor.cloud/a/FMuUgZSz1yQ>)

## Engineering notes

Where this build departs from the hand-back, or pins down what it leaves open (agreed in
refinement, ALI-525):

* The **access pill** is the nested collection header's access control. A collection has no
  `/a/<slug>` link, so from the pill the popover never shows the Link section.
* The artefact **row's** Share opens the same popover, Link section included. The row's meta line
  has no link (S65), so the popover's Link section is where an owner's row inside a collection
  offers it.
* Clicking the link uses the card's and row's copy handler, so the toast reads "Link copied ·
  \<host\>/a/\<slug\>" (and "Couldn't copy the link" on failure), as everywhere else on cards and
  rows since S62.
* **The collection is the tree root.** The explanation and Open “\<collection\>” name and open
  the tree root whose access the artefact follows, the one collection where it can be changed. For
  an artefact in a nested collection that is the tree's root, not the nested collection, and the
  sentence reads as handed back with the root's name: "This artefact is in “\<root\>” and follows
  its access. Change it on the collection."
* The hand-back's text is kept as handed back; only its layout was adjusted for `pnpm lint:md`.
