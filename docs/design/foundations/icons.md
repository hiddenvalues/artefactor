# Icons

Every icon comes from [lucide](https://lucide.dev/icons) (`lucide-react` in the app,
`window.Artefactor.icons` in a design). Don't draw an SVG for something lucide has.

## The app's vocabulary

The same concept always takes the same icon:

| Concept | Icon |
| --- | --- |
| A collection | `Folder`, tinted with the collection's hue |
| Bookmarked | `Bookmark` with `fill-current` (outline when not bookmarked) |
| Archive / restore / delete forever | `Archive` / `RotateCcw` / `Trash2` |
| Has saved data | `Database` |
| Visibility tiers | `Lock` private, `UserPlus` specific people, `Users` members, `Globe` public |
| Share link (`/a/…`), copy it | `Link` |
| The Share button (manage access, or a viewer's copy of the link) | `Share2` |
| Link protection (password, expiry) | `Lock`, `Clock` |
| Create / edit | `Plus` / `Pencil` |
| A row's or card's menu | `MoreHorizontal` |
| Search, upload, download, open in a new tab | `Search`, `Upload`, `Download`, `ExternalLink` |
| Theme: light / dark / system | `Sun` / `Moon` / `Monitor` |
| Toggle the sidebar, sign out, clear a field | `Menu`, `LogOut`, `X` |
| Tree expansion | `ChevronRight`, with `rotate-90` when expanded |
| A dropdown trigger | `ChevronDown` |
| Pending | `Loader2` with `animate-spin` |
| Account / organization settings / switch organization | `UserRound` / `Settings` / `Building2` |
| Invite people / a pending invitation / revoke it | `MailPlus` / `Mail` / `X` |

A new concept that needs an icon adds a row here.

## Sizing

- Inside a `Button` or a `DropdownMenuItem`, a bare icon is sized for you; set no size.
- Next to text: `size-3` or `size-3.5`, with `shrink-0`.
- On its own: `size-4` or `size-5`.
- A large decorative icon takes any step of the spacing scale (`size-8`, `size-10`, …).
- A size is always a class, never a `size` prop.

## Colour

Icons draw in `currentColor`. Colour one with a text token (`text-muted-foreground`,
`text-primary`) or a product token, never a raw colour. A collection's icon takes the collection's
hue.
