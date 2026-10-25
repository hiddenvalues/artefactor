# Screen: Account and organization settings

Built in two slices: S57 — Account screen: change your name, and S58 — Organization settings screen
and its administration seam.

## Purpose

Give a signed-in user one place to see and manage who they are and which organization they're
working in. **Account** lets them set their name. **Organization settings** shows the active
organization, its owner, your role and the people in it. Owners can also rename the organization and
invite or remove members
([ALI-346](https://linear.app/hiddenvalue/issue/ALI-346/the-ui-never-shows-which-org-you-are-in-or-your-role)).

## Layout

* **Top bar:** the top bar with the account menu (see
  [ALI-467](https://linear.app/hiddenvalue/issue/ALI-467/component-hand-back-top-bar)). Both screens
  open from the account menu.
* **Main pane:** a single column, width-capped, with no sidebar section of its own.
* **Account:**
  * Screen title "Account", sub "Your profile."
  * **Profile** card: avatar, name and email at the top. A **Name** field with a **Save** button,
    and the email shown read-only below.
* **Organization settings:**
  * Screen title "Organization settings", with the active organization's name as the sub.
  * **General** section, as a card:
    * **Owners:** an **Organization name** field with **Save**, then the Owner and Your role rows.
    * **Members:** Name, Owner and Your role rows, all read-only, plus a note telling them to ask
      the owner for changes.
  * **Members · N** section: the section label, with **Invite people** on the right for owners only.
    Below it, one card with a row per person: avatar, name (with "(you)" on your own row), email and
    role badge. Owners also get a remove button on each Member row. The owner comes first. For
    owners, pending invitations follow, each with a "Pending" badge and a revoke button.

## Data per unit

* **User:** name, email, initials for the avatar.
* **Active organization:** name, the owner's name and email, and the viewer's role (Owner / Member).
* **Members:** for each person in the active organization: name, email, role. Everyone can read
  this.
* **Pending invitations:** email and when it was sent. Only owners can read these.
* **Roles** are read-only for now. Changing them stays a database operation for the alpha.

## Actions

* **Save name** (Account): Save is enabled only when the name has changed and isn't empty. Saving
  shows a "Name saved" toast, and the new name shows in the top bar and menu.
* **Rename organization** (owners only): same pattern as Save name. Saving shows an "Organization
  renamed" toast and updates the name everywhere, including the top bar.
* **Invite people** (owners only): a dialog titled "Invite people", explaining that invitees join as
  Members, with one Email field. **Send invite** is enabled only for a valid email. Sending shows an
  "Invitation sent to …" toast and adds a pending row.
* **Revoke invitation** (owners only): removes the pending row and shows a "… revoked" toast.
* **Remove member** (owners only, not on owners or on yourself): opens a confirm dialog, "Remove
  {name}?", saying they lose access to the organization and can be invited again. Confirming removes
  the row and shows a "… removed" toast.

  Not built yet: Remove member waits for ET8 — Org membership: invitations, removal and domain
  policy, since sign-in reconciliation would put a removed member back. S58 builds no remove
  button.

## States

* **Owner:** sees the editable name, Invite people, the remove buttons and pending invitations.
* **Member:** everything is read-only. The member list is still visible, and a note says "Only
  owners can rename the organization or invite and remove members. Ask {owner} if something needs
  changing."
* **Switching organization** while on Organization settings: the page reloads for the new
  organization, with that org's role, members and owner.
* **Personal organization:** the member list shows only you, as Owner.
* **No pending invitations:** no pending rows are shown.
* **Saving:** Save stays disabled until something changes.

## Responsive

* **Wide:** a single column, capped at about 40rem for Account and 48rem for Organization settings.
* **Narrow:** the name field and its Save button wrap onto two lines. In the Members header, Invite
  people wraps below the label. In member rows, names and emails truncate, and the role badge and
  remove button keep their size.

## Prototype

[https://app.artefactor.cloud/a/d244NTSllbQ](<https://app.artefactor.cloud/a/d244NTSllbQ>)
