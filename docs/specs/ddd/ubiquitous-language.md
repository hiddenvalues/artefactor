# Ubiquitous Language

Shared vocabulary for Artefactor. Use these terms exactly — in code, specs, tests, and UI.

| Term | Meaning |
|------|---------|
| **Artefact** | A self-contained, **trusted** HTML deliverable produced by claude.ai / Claude design — e.g. a UX/UI prototype, slide deck, form, or interactive document. The core domain object. |
| **Kind** | The category of an artefact: `prototype`, `slide-deck`, `form`, `interactive-doc`, `other`. Set at creation, editable. **Metadata only** — used to group and distinguish artefacts when browsing. |
| **HTML payload** | The trusted HTML content of an artefact, stored and served as-is (no sanitization). Non-empty, size-capped. |
| **Account** | An authenticated user. Identity is delegated to **BetterAuth**; the domain refers to a user by their BetterAuth user id. |
| **Owner** | The Account that created and owns an artefact. Authoritative for private access and mutations. |
| **Visibility** | One of three tiers: `private` (owner only), `authenticated` (any signed-in user — UI label "Other users"), or `public` (anyone, including unauthenticated). |
| **Slug** | The unique, immutable address of an artefact. Minted the first time visibility leaves `private`, then **retained** for the artefact's life (even when set back to private). |
| **Share** | Raise visibility above `private` (`authenticated` or `public`), binding/retaining the slug. |
| **Unshare** | Set visibility back to `private`. The slug is retained; the link returns 404 while private. |
| **Data entry** | A JSON blob persisted by the backend store, tied to one **(artefact, author)** pair. Lets form/interactive artefacts persist data server-side instead of (or alongside) browser localStorage. |
| **Author** | The Account that wrote a data entry. A user may write only their own entry. |
| **Status** | Lifecycle state: `active` or `archived`. |
| **Archive** | Soft-delete: the artefact is retained but hidden from default listings and not served (public or private). Restorable. |
| **Restore** | Return an `archived` artefact to `active`. |
| **API key** | A credential (managed via BetterAuth's API-key plugin) that lets an external process push artefacts on behalf of an Account. |
| **Ingestion** | How an artefact enters the system: **manual upload** (authenticated UI) or **API push** (programmatic, API-key authenticated). Both enforce identical invariants. |
| **Shared with you** | The view where a signed-in user lists artefacts shared to them by **others** (`authenticated` or `public`), grouped/filterable by **kind**. Distinct from **Your artefacts** (the owner's own list). |
| **Your artefacts** | The signed-in owner's view of the artefacts **they own** (manage, share, archive). Distinct from **Shared with you** (others' artefacts). |
| **Link gate** | An owner-set password and/or expiry on a shared artefact (or collection root) that narrows access after the access matrix grants it. Never widens access; the owner is never gated (S32). |
| **Pass** | A signed, short-lived cookie proving a viewer supplied a link gate's password; voided when the password changes. |
| **Share invitation** | A pending grant of `selected` access to an email that has no Account yet; it joins the access list when that Account is created. Distinct from an **org invitation** (membership). Provided by a superset through the S33 seam; OSS advertises no invitations. |
| **Thread** | A comment discussion attached to one artefact, shown in the host chrome; `open` or `resolved` (S34). |
| **Comment** | One plain-text message in a thread, by a signed-in viewer or — marked "via Claude" — through the MCP connector. |
