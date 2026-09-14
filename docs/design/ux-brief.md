# Artefactor — UX redesign brief (for Claude design)

Paste this whole document into a Claude design conversation, and attach the screenshots in
`docs/design/screenshots/` (referenced inline below) as the "before". Then ask it to redesign
one screen at a time.

---

## 1. What Artefactor is

Artefactor is a web app that **hosts self-contained HTML artefacts** produced by claude.ai and
Claude design — UX/UI prototypes, slide decks, forms, interactive docs. You upload an HTML
deliverable; Artefactor stores it and serves it back through the app, with sharing, access
control, and per-user data persistence. Think "a tidy home for the interactive HTML things
Claude builds for you."

It is multi-user (login required). Each artefact has an owner. The product is currently
**bare-bones and developer-flavoured** — see the screenshots — and we want a clean, modern,
confident UI.

## 2. Goal & scope

Redesign these three surfaces (in priority order). **Out of scope** for now: the auth screen,
and the viewer chrome around a served artefact.

1. **Your artefacts** — the signed-in home where you see, manage, share, and organise the
   artefacts you own. *Highest priority — densest screen, biggest payoff.*
2. **Shared with you** — artefacts *other* users have shared with you (your own never appear here).
3. **Create / upload** — adding a new artefact (title + kind + HTML file).

These three live on **one cramped scrolling column** today (`01-dashboard-full.png`). A core
part of the redesign is giving them a proper information architecture — likely a real app shell
(top bar and/or sidebar nav) with distinct **Your artefacts** / **Shared with you** views and
upload as a prominent primary action (modal or dedicated panel), rather than everything stacked.

## 3. The current state (the "before")

Attached screenshots:

| File | Screen |
| ------ | -------- |
| `01-dashboard-full.png` | The entire signed-in page, top to bottom (all sections stacked) |
| `02-your-artefacts.png` | "Your artefacts" list, grouped by kind, with inline controls |
| `03-archived.png` | The archived section |
| `04-create.png` | "New artefact" upload form |
| `05-shared-gallery.png` | "Shared with you" |
| `06-auth-signin.png` | Signed-out auth screen (context only; out of scope) |

**What's wrong with it today (please fix):**

- Everything is jammed into a ~448px centered column; tons of wasted screen on desktop.
- Actions are tiny blue/red **text links** (`open`, `link`, `edit`, `archive`, `restore`) with
  no hierarchy or affordance; destructive and benign actions look identical.
- Visibility is a bare `<select>` sitting inline in each row.
- Kinds are shown only as a tiny lowercase text header (`prototype`, `form`, …).
- Developer cruft leaks into the UI: a "Call protected /api/me" button and a raw JSON dump.
- No thumbnails/previews, no meaningful metadata (size, last-updated), no counts, no search.
- "Your artefacts" and "Shared with you" are visually identical undistinguished lists.
- Empty/loading/error states are an afterthought (plain grey sentences).

## 4. Domain model the design MUST respect

Don't design these away — they're real product rules.

**Artefact.** Each has: `title`, `kind`, `visibility`, `status` (active/archived), an optional
public `slug` (the share link), `payloadBytes` (size of the stored HTML), `createdAt`,
`updatedAt`, and an `ownerId`.

**Kinds** (metadata; used to group/filter — not a hard taxonomy):
`prototype`, `slide-deck`, `form`, `interactive-doc`, `other`.

**Visibility — 3 tiers** (this is the sharing model; the labels in the current UI are clumsy —
feel free to relabel):

- `private` — only the owner. *(current label: "Private")*
- `authenticated` — any signed-in user. *(current label: "Other users" — weak; consider
  "Signed-in users" or "Members")*
- `public` — anyone with the link, including logged-out. *(current label: "Public")*

Sharing mints a unique **slug** → a shareable link `/a/<slug>`. Setting back to `private`
**retains** the slug but the link 404s. So a shared artefact has both a visibility tier **and** a
copyable link; a private one has neither (or a dormant link). The UI should make "who can see
this" and "copy share link" first-class, legible affordances.

**Lifecycle.** No hard delete — only **archive** (soft-hide) and **restore**. Archived artefacts
drop out of the main list into an "Archived" area.

**Two distinct surfaces, same artefact card:**

- **Your artefacts** = artefacts *you own* (full management: open, share/visibility, edit, archive).
- **Shared with you** = *others'* artefacts shared with you (read/open only — you don't manage others').

## 5. Data & actions available per screen (so mockups stay realistic)

**Your artefacts** (per artefact card):

- Show: title, kind, visibility tier, share-link presence, size (`payloadBytes`), last updated.
- Actions: **Open** (preview the artefact), **change visibility** (the 3 tiers), **copy share
  link** (when shared), **Edit** (title / kind / replace the HTML file), **Archive**.
- Filter by kind. Grouping by kind today; a grid of cards with kind badges may serve better.

**Archived** (collapsed/secondary): list of archived titles + **Restore**.

**Create / upload:** fields = **Title** (required), **Kind** (select), **HTML file** (required,
`.html`). On success the new artefact appears in "Your artefacts" as `active` + `private`.

**Shared with you:** cards grouped by kind; action = **Open** only. (Discovery / browse feel —
this is where someone explores what others shared.)

## 6. Tech constraints & portability (important)

The real app is **Svelte 5 + shadcn-svelte + Tailwind CSS**. Claude design emits React/HTML, not
Svelte — so:

- **Build the prototype with Tailwind utility classes and shadcn/ui component patterns**
  (Card, Button, Badge, Select, Dialog, DropdownMenu, Input, Tabs, etc.). Because shadcn-svelte
  mirrors shadcn/ui 1:1, the component structure, class names, and design tokens **port almost
  directly** into our app.
- Treat the output as a **high-fidelity visual + interaction spec**, not copy-paste code. Favour
  standard shadcn tokens (`bg-background`, `text-muted-foreground`, `border`, `rounded-lg`,
  `bg-card`, etc.) over bespoke colors so the spec maps onto our theme.
- Keep it **light/dark-token friendly** and **responsive** (desktop-first, but usable narrow).

## 7. Design direction (suggestions, not constraints)

- A proper **app shell**: top bar (product name, account, a prominent **+ New artefact**) and/or
  left nav switching **Your artefacts ↔ Shared with you**.
- Artefacts as a **responsive card grid**: each card a small **preview/thumbnail** (these are
  HTML deliverables — an `<iframe>` thumbnail or a kind-tinted placeholder), title, a **kind
  badge**, a **visibility badge** (lock / members / globe), last-updated, size, and a tidy
  **actions menu** (⋯ / dropdown) so the card isn't a wall of links. Destructive (archive) lives
  in the menu, visually separated.
- **Visibility** as a clear control with iconography + a one-line explanation of each tier, and
  an obvious **Copy link** when shared.
- **Filter + search**, kind chips, and a sort (recently updated).
- **Upload** as a focused modal or panel with drag-and-drop for the HTML file, title, and kind.
- Designed **empty states** ("No artefacts yet — upload your first"), **loading skeletons**, and
  inline **error** states.
- Drop all the developer cruft (the `/api/me` button, JSON dumps).

## 8. What to ask Claude design to produce

Go screen by screen. For each, request an interactive artefact covering the key states:

1. **Your artefacts** — populated card grid + filter/search + per-card actions menu + the
   visibility control + a collapsed Archived area. Also show the **empty state** and a **loading skeleton**.
2. **Upload** — the create modal/panel with drag-and-drop, validation, and the success result.
3. **Shared with you** — the browse grid of others' shared artefacts (open-only), grouped or
   filterable by kind, plus its empty state.

Then iterate on spacing, hierarchy, and the card anatomy until it feels like a confident product
rather than a form dump. We'll port the winning direction into shadcn-svelte.
