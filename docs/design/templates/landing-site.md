# Template: [artefactor.cloud](<http://artefactor.cloud>) landing site

## Purpose

Visitors to [artefactor.cloud](<http://artefactor.cloud>) (people who use Claude, or are curious
about it) learn what Artefactor does, see real artefacts with the prompts that made them, and sign
up free. Existing users come to Help for short, hands-on guides. Every card on the site is a public
artefact from the hiddenvalue org's "Landing page" collection, so the site doubles as a live demo of
the product. Builds
[ALI-395](https://linear.app/hiddenvalue/issue/ALI-395/astro-landing-site-for-artefactorcloud-fed-by-public-collections).

## Prototype

[https://app.artefactor.cloud/a/\_RljrT0BSxo](<https://app.artefactor.cloud/a/_RljrT0BSxo>)

## Layout

**Shared on all pages:** A sticky top bar with the Logo, links (Library, Help, Pricing, FAQ), then
Sign in (ghost) and Sign up free (primary). A footer with the Logo, a one-line description and link
columns (Product, Learn, Hiddenvalue), then a bottom row with © Hiddenvalue · Göteborg. Content
sits in a centred column with a 1200px max width and 24px side padding.

**Landing (**`/`**), top to bottom:**

1. Hero on a dotted background: badge, headline, sub-copy, Sign up free and Browse the library
   buttons, three checkmarks. Beside it, a composed scene: the prompt bubble, a framed artefact
   with its link, a floating card and a "replies" note.
2. "What is Artefactor?": the explainer artefact shown large, with an Open button.
3. How it works: dark band, three steps, each with a small visual.
4. Four selling points.
5. Library teaser: 8 GalleryCards and See the whole library.
6. Help teaser: 4 HelpCards.
7. Pricing: three tiers.
8. FAQ: an accordion.
9. Closing call-to-action band.

**Library (**`/library`**):** Header, then a filter bar that sticks under the top bar (category
buttons with counts, and a result count). Then the GalleryCard grid and a call-to-action band.

**Help (**`/help`**):** Header with the featured "Start here" guide beside it. Then a topics side
menu and the topic groups, each a grid of HelpCards. A "Can't find it?" panel at the bottom.

**On a phone:** The nav links hide, leaving the Logo and the two buttons. Every grid drops to one
column, and the hero scene's floating extras are hidden, leaving just the framed artefact. The Help
side menu stacks above the content. The Library filter buttons wrap.

## Data per unit

| Unit | Shows |
| -- | -- |
| GalleryCard (Library, landing teaser) | 1. Thumbnail at 16:10, cropped to the top: the public artefact's thumbnail, loaded from its public thumbnail URL when the page loads. 2. Kind chip: kind icon in its `--kind-*` colour plus the kind name, from `kind`. 3. Title, from `title`. 4. Prompt in quotes, at most 2 lines: **new field, the prompt that made the artefact** (to be decided: on the artefact, or on its entry in the collection). *Superseded, see Decisions.* 5. "Saves input" with the Database icon when `usesStorage`, otherwise "Made with Claude". *Superseded, see Decisions.* 6. Copy prompt and Open buttons. *Copy prompt superseded, see Decisions.* |
| HelpCard (Help, landing teaser) | 1. Thumbnail at 16:10 (same source). 2. Meta line "‹sub-collection name› · ‹n› min": **reading time is new** (to be decided: a field, or left out). 3. Title. 4. "Open guide →". The whole card is one link. |
| Library category button | Sub-collection name and its artefact count. "All" is first. |
| Help topic group | Sub-collection name, a one-line blurb (**new: the collection's description**) and its HelpCards. |
| Featured explainer (landing) and "Start here" (Help) | A single artefact shown large, with its thumbnail and an Open button. Chosen by **a pinned artefact in the root / How-tos collection** (rule to be decided: first item, or a flag). |

Collection tree
([ALI-395](https://linear.app/hiddenvalue/issue/ALI-395/astro-landing-site-for-artefactorcloud-fed-by-public-collections)):
root **Landing page** → **How-tos** (sub-collections Getting started, Making artefacts, Sharing,
Organising) and **Gallery** (sub-collections Events, Home & family, Travel, Learning, Games, Work).
The page loads the tree from the public collection API
([ALI-394](https://linear.app/hiddenvalue/issue/ALI-394/public-collection-links-and-anonymous-thumbnails-s44))
in the browser, so no rebuild is needed when content changes.

## Actions

| Action | Where | Does |
| -- | -- | -- |
| Sign up free | Top bar, hero, Free tier, closing band, Library band | Goes to the app's sign-up. |
| Sign in | Top bar | Goes to the app's sign-in. |
| Open (card, thumbnail, title) | GalleryCard | Opens `https://app.artefactor.cloud/a/:slug` in a new tab. |
| Copy prompt | GalleryCard | Copies the prompt to the clipboard and shows a "Prompt copied" toast. If copying fails, shows an error toast. No confirmation step. *Superseded, see Decisions.* |
| Open guide | HelpCard (whole card), Start here | Opens the guide artefact's `/a/:slug` in a new tab. |
| Open the interactive explainer | Landing "What is" section | Opens the explainer's `/a/:slug` in a new tab. |
| Browse the library / See the whole library | Hero, library teaser | Goes to `/library`. |
| Visit Help | Help teaser | Goes to `/help`. |
| Category buttons | Library filter bar | Filter the grid on the page, with no reload; the selected one is pressed (`aria-pressed`). Optionally kept in the URL (`?c=work`). |
| Topic link | Help side menu | Jumps to that topic group on the page. |
| FAQ question | Landing FAQ | Opens or closes its answer (`<details>`, no JavaScript). |
| Pricing tier buttons | Pricing | Free → sign-up. Pro → sign-up with the plan pre-selected. Team → contact. |
| Contact support | Help | Opens a mailto: to the support address. |

Nothing on the site asks for confirmation, and there's no server-side state.

## States

* **Loading:** each card grid shows Skeleton cards of the same size until the collection arrives.
  The page layout and copy are static and appear at once.
* **Collection fetch fails:** the grid is replaced by "Couldn't load the library right now" with a
  Try again button. The rest of the page is unaffected.
* **Thumbnails:** every card shows its artefact's real thumbnail. If one fails to load, that card
  falls back to kind-tinted stripes and the kind icon, as in the app.
* **A collection is empty:** its Library category button and Help topic group are hidden. If the
  whole Gallery is empty, the landing library teaser is hidden. If How-tos is empty, the Help
  teaser and the Help link in the top bar are hidden.
* **One item:** the grid keeps its column widths (cards don't stretch to full width).
* **Many items:** the Library shows them all, with no pagination; revisit above about 60. The
  landing teaser shows the first 8 Gallery items, and the Help teaser the first 4 How-tos items, in
  collection order.
* **No pinned explainer or Start here artefact:** that section is hidden.
* **Prompt missing:** the prompt line is left out, and Copy prompt is hidden. *Superseded, see
  Decisions.*
* **Artefact taken out of the collection:** it disappears on the next page load. The Landing page
  collection's public tier governs everything in it, so an artefact's own access setting doesn't
  hide it.
* **Read-only:** the whole site is public and read-only, with no signed-in state.

## Navigation

## Non-goals

* No sign-in, accounts or anything personal on the site. It's public, and everything personal
  happens in the app.
* No search. Category filters only.
* No embedding artefacts live (no iframes). Cards open the artefact in the app.
* No CMS. The collections in Artefactor are where content is edited, and changes show up on the
  next page load, with no rebuild.
* No search-engine indexing of the cards: the static page copy is what's indexed; card content
  loads in the browser.
* No dark mode on the site in this version.

## Out of scope

* Pricing details (pay per artefact created, with a different number of credits per plan):
  `/refine` takes the plans, prices and credit amounts from the specs. The support email and the
  sign-up URLs are also left to `/refine`.
* Writing the real artefacts: the "What is Artefactor?" explainer, the Help guides and the Gallery
  examples. The prototype's thumbnails are stand-ins.
* Adding the new fields in Artefactor (prompt, reading time, collection description, a pinned or
  featured flag) and the public collection API itself
  ([ALI-394](https://linear.app/hiddenvalue/issue/ALI-394/public-collection-links-and-anonymous-thumbnails-s44)).
* Hosting, the domain move and the apex redirect
  ([ALI-396](https://linear.app/hiddenvalue/issue/ALI-396/move-the-app-to-appartefactorcloud-freeing-the-apex-for-the-landing),
  and the redirect rule already described in
  [ALI-395](https://linear.app/hiddenvalue/issue/ALI-395/astro-landing-site-for-artefactorcloud-fed-by-public-collections)).
* Analytics, cookie consent and the legal pages' contents (Terms, Privacy).
* Dark mode and translations.
* Turning GalleryCard and HelpCard into components inside the app.

## Must not break

* The app at [app.artefactor.cloud](<http://app.artefactor.cloud>), including sign-up and sign-in,
  which the site links into.
* Share links: `artefactor.cloud/a/:slug`, `/mcp`, `/api/` and `/.well-known/oauth-*` keep
  redirecting to the app (the narrowed apex redirect from
  [ALI-395](https://linear.app/hiddenvalue/issue/ALI-395/astro-landing-site-for-artefactorcloud-fed-by-public-collections)),
  so existing links and connectors keep working.
* The public collection API stays read-only and returns only public artefacts. An artefact shows
  only while it sits in the public Landing page tree; taking it out removes it.
* The design system: the site uses its tokens and look and adds no new colours. Text contrast
  stays at 4.5:1 or better (`platform.theme.text-contrast`).
* The landing page copy stays indexable with the cards still loading, and a slow or failed
  collection load never blocks the rest of the page.

## Acceptance

1. Opening [artefactor.cloud](<http://artefactor.cloud>) shows the hero, explainer, how it works,
   selling points, pricing and FAQ in the static HTML, before any script runs (view source shows
   the copy).
2. Within a second or two of load, the library teaser shows the first 8 Gallery artefacts and the
   Help teaser the first 4 How-tos, each with its real thumbnail.
3. Publishing a new public artefact into the Gallery collection makes it appear on `/library` on
   the next page load, with no rebuild or deploy.
4. Taking an artefact out of the Landing page collection removes it from the site on the next page
   load.
5. Clicking a card's thumbnail, title or Open opens `app.artefactor.cloud/a/:slug` in a new tab.
6. Copy prompt puts the exact prompt on the clipboard and shows "Prompt copied". A card with no
   prompt shows no prompt line and no Copy button. *Superseded, see Decisions.*
7. On `/library`, choosing Work shows only Work artefacts, with no reload. All shows everything,
   and the pressed button is announced to a screen reader.
8. A category or topic with no public artefacts doesn't appear.
9. With the API blocked, the grids show "Couldn't load the library right now" with Try again, and
   the rest of the page still works.
10. A thumbnail that fails to load shows the kind stripes instead of a broken image.
11. At 375px wide, nothing scrolls sideways, every grid is one column and the top bar shows the
    Logo plus the two buttons.
12. Every card and button can be reached and used with Tab and Enter, and every text pair passes
    4.5:1.
13. `artefactor.cloud/a/<existing slug>` still redirects to the app.

## Decisions

The open choices above, as decided when the site was specified:

* **Featured explainer and Start here:** by convention, one artefact sits directly in the root
  (the featured explainer) and one directly in How-tos (Start here). With more than one, the first
  by title wins; with none, the section is hidden. There is no pinned or featured flag.
* **Reading time:** none. The HelpCard meta line is the sub-collection name only.
* **No prompt on the card:** the card shows no prompt, no Copy prompt and no "Saves input" / "Made
  with Claude" line. A showcase artefact carries its own information panel with its prompt and a
  Copy prompt button (the showcase-artefact skill), so the card stays plain. This supersedes
  GalleryCard items 4–6 under *Data per unit* (Open stays), the *Copy prompt* action, the *Prompt
  missing* state and acceptance 6.
* **Topic blurbs:** a Help topic's one-line blurb is its collection's description, left out when
  the collection has none.
* **Collection order:** collections and artefacts read A–Z, by name and by title. The landing
  teasers interleave the categories round-robin: the library teaser takes up to 8 Gallery
  artefacts, the first of each category in order, then the second of each, and so on; the Help
  teaser takes up to 4 How-tos artefacts the same way across the topics.
* **Saving:** anonymous visitors save nothing; showcase artefacts keep their state in memory for
  the visit.
* **Pricing:** three cards. **Free:** €0, 5 artefacts to try, button to sign-up. **Paid:** "from
  €5 / month", with Starter 10, Growth 30, Scale 100 and Pro 300 artefacts a month, button to
  sign-up (no plan is pre-selected). **Custom:** "Need more? Talk to us", a mailto: to the support
  address. Under the cards: "Unlimited members on every plan · Beta pricing".
* **Links:** sign-up is the app's `/signup` and sign-in its `/signin`; the support address is
  `support@hiddenvalue.se`.
* **Built outside the app:** the site is built in `ee/landing/`, so it has no screen card in the
  design catalog.
