# Component: Account menu

## Purpose

Shows who's signed in and their active organization, and opens a menu for switching organization,
account and organization settings, colour theme and logging out. Signed out, it's a Sign in button.
It's used wherever the app needs an account entry point. The top bar is the first place, and it
should work in any container.

## Prototype

[https://app.artefactor.cloud/a/CVG0RyjnQ50](<https://app.artefactor.cloud/a/CVG0RyjnQ50>)

## Anatomy

* **Account button, default variant:** outline `Button` (h-9). Inside it, an `Avatar` (size-6) with
  initials, the active organization's name (one line, cuts off past 10rem), a secondary `Badge` with
  the role, and a `ChevronDown` icon.
* **Account button, avatar variant:** a round ghost icon `Button` holding an `Avatar` (size-8).
* **Sign in button (signed out):** primary `Button` with the `LogIn` icon and the label "Sign in".
* **Menu:** `DropdownMenuContent`, right-aligned to the button, min width 14rem, containing:
  1. `DropdownMenuLabel`: `Avatar` (size-8), name, and email in muted text.
  2. `DropdownMenuLabel`: active organization name, with a secondary role `Badge`.
  3. `DropdownMenuSub` "Switch organization" (`Building2` icon), holding
     `DropdownMenuCheckboxItem`s, one per organization with its role in muted text.
  4. `DropdownMenuItem` "Account" (`UserRound`).
  5. `DropdownMenuItem` "Organization settings" (`Settings`).
  6. `DropdownMenuSeparator`.
  7. `DropdownMenuSub` "Colour theme" (`Palette`), holding a `DropdownMenuRadioGroup`: Light
     (`Sun`), Dark (`Moon`), System (`Monitor`).
  8. `DropdownMenuSeparator`.
  9. `DropdownMenuItem` "Log out" (`LogOut`), destructive.

## Variants

| Variant | What differs | When |
| -- | -- | -- |
| Default | Avatar, organization name, role badge and chevron, in an outline button | At or above the design system's `sm` breakpoint |
| Avatar | Avatar only, in a round ghost icon button; same menu | Below the design system's `sm` breakpoint |
| Signed out | Primary "Sign in" button with the LogIn icon; no menu | No user signed in, at any width |

## States

| State | Looks like |
| -- | -- |
| Default | The button at rest, outline (Default variant) or ghost (Avatar variant) |
| Hover | Accent background with accent text, on the button and on each menu item |
| Focus | Ring at 3px, `ring/50`; menu items take the accent background |
| Open | The menu below the button, right-aligned; the button keeps `aria-expanded` |
| Role: Owner / Admin / Member | The role badge reads the active role; the menu is the same for every role |
| One organization | "Switch organization" is hidden |
| Several organizations | "Switch organization" submenu with a check on the active org and each org's role beside it |
| Long organization name | Cuts off at 10rem on the button, and at the menu's width in the label |
| Signed out | A primary "Sign in" button in place of the account button. Clicking it goes straight to the sign-in / sign-up screen; no dropdown opens. |

## Behaviour

* **Account button:** opens and closes the menu.
* **Sign in** (signed out): opens the sign-in / sign-up screen (`AuthScreen`). After signing in, the
  user comes back to the page they were on, and the account button replaces Sign in.
* **Switch organization:** picking an organization makes it active, updates the button's
  organization name and role, shows a "Switched to …" toast, and loads the new organization's
  dashboard (Home). The page you were on belongs to the previous organization, so it isn't kept.
  Picking the active organization does nothing.
* **Account:** opens the Account screen (`AccountScreen`).
* **Organization settings:** opens the Organization settings screen. Everyone can open it; what you
  can edit there depends on your role.
* **Colour theme:** Light, Dark or System. The choice applies right away and is remembered.
* **Log out:** signs you out and returns you to sign-in.
* Every action closes the menu, except opening a submenu. Clicking outside the menu or pressing Esc
  closes it too.
* The role is read-only everywhere. Changing roles stays a database operation for the alpha.
* Account and Organization settings ship with their screens
  ([ALI-468](https://linear.app/hiddenvalue/issue/ALI-468/screen-hand-back-account-and-organization-settings),
  *Screen hand-back: Account and organization settings*), so no item leads nowhere.

## Accessibility

* **Names:** the account button's `aria-label` names the organization and role, for example
  "Account: Hidden Value, Owner", in both variants. On the Default variant the visible text matches
  that label. On the Avatar variant the label is the only name, so it must stay. The Sign in button
  is named by its visible text, "Sign in".
* **Menu:** a standard `menu` that opens with Enter, Space or ↓ on the button. Focus moves to the
  first item. The two header rows are labels (`DropdownMenuLabel`), not items, so arrow keys skip
  them.
* **Keys:** ↑↓ move between items. → opens a submenu and ← closes it. Esc closes the menu, and focus
  returns to the account button.
* **Switch organization** uses `menuitemcheckbox`, with `aria-checked` on the active organization.
  **Colour theme** uses `menuitemradio`.
* **After switching organization:** the "Switched to …" toast is announced politely, and focus moves
  to the new dashboard's main heading.
* **Role** is always shown as text, never by colour alone.
* **Tab order:** a single stop, the account button or the Sign in button, at the end of its
  container's tab order.

## Content

* **Button:** the organization name, one line, cut off with an ellipsis past 10rem; its full name is
  in the button's label and tooltip. Role: "Owner", "Admin" or "Member".
* **Sign in button:** "Sign in".
* **Menu header:** the user's name, falling back to their email when there's no name, and the email
  below it. Both are one line, cut off at the menu's width. Initials in the avatar: up to two
  letters, from the first two words of the name.
* **Menu items, exactly:** "Switch organization", "Account", "Organization settings", "Colour theme"
  (British spelling, as in the app), "Light", "Dark", "System", "Log out".
* **Toast:** "Switched to {organization name}".
* **Organization list:** each name on one line, cut off; role beside it.

## Non-goals

* It doesn't change roles. Roles are shown read-only.
* It doesn't create, invite to or leave organizations. Those belong to Organization settings.
* It doesn't show notifications or a usage meter. Usage stays hidden until that feature exists.
* It doesn't fetch data or read the URL. It renders from the `user` it's given and reports actions
  through callbacks. Navigation and the organization switch are handled by the screen that hosts it.

## Out of scope

* **Mounting it in TopBar,** and any change to TopBar: covered by the TopBar hand-back.
* **The Account and Organization settings screens:** handed back separately
  ([ALI-468](https://linear.app/hiddenvalue/issue/ALI-468/screen-hand-back-account-and-organization-settings)).
* **The sign-in / sign-up screen** (`AuthScreen`): only the Sign in entry point is in scope here.
* **The Usage feature:** its menu item comes back in a later hand-back, when the feature exists.
* **The no-organization (OSS) case:** left open for engineering's `/refine`.

## Must not break

* **Theme:** the colour-theme choice keeps working through the app's existing theme context, and is
  still remembered.
* **Sign-out** still ends the session and returns to sign-in.
* **Organization switching** still uses the app's existing switch call. Only where you land
  afterwards changes: the dashboard.
* **Contrast:** text contrast stays at 4.5:1 in light and dark (`platform.theme.text-contrast`),
  including the role badge and the primary Sign in button.
* **Lint:** it's built only from the shadcn wrappers, with no raw `<button>` and no direct Radix
  import, so `pnpm lint` passes.
* **Catalog:** it has a sibling `AccountMenu.preview.tsx` with a variant for each state, so the
  catalog test passes.

## Acceptance

 1. Signed in at or above `sm`, the button shows the avatar initials, the active organization's
    name, the role badge and a chevron. Below `sm`, it shows only the avatar in a round button.
 2. Signed out, a primary "Sign in" button shows at every width, and clicking it opens the sign-in /
    sign-up screen. After signing in, the user is back on the page they were on, and the account
    button shows instead.
 3. Opening the menu shows, in order: avatar, name and email; organization name and role; Switch
    organization (only with two or more organizations); Account; Organization settings; separator;
    Colour theme; separator; Log out. Usage isn't shown.
 4. With one organization, "Switch organization" isn't in the menu.
 5. Picking another organization in Switch organization updates the button's name and role, shows
    "Switched to {name}", and loads that organization's dashboard. Picking the active one does
    nothing.
 6. Account opens the Account screen, and Organization settings opens the Organization settings
    screen, for every role.
 7. Choosing Light, Dark or System applies right away and is still in effect after a reload.
 8. Log out signs the user out and shows sign-in.
 9. A 40-character organization name cuts off with an ellipsis on the button, and the full name is
    in its label and tooltip.
10. Keyboard only: Tab reaches the button, Enter opens the menu with focus on the first item, the
    arrow keys move between items and skip the two header rows, → and ← open and close submenus, and
    Esc closes the menu with focus back on the button.
11. A screen reader announces the button as "Account: {organization}, {role}" in both variants, and
    announces the switch toast.
12. The catalog shows a preview for each state: owner, several organizations, long name, avatar
    variant, and signed out.
