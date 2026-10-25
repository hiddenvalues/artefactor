// Contracts shared between the Hono BFF and the React client.
// Slice BFF request/response shapes live here as they are introduced (S1+).

import type { ArtefactKind } from "../domain/artefact/kind";

export interface HealthResponse {
  status: "ok";
  uptime: number;
  // The git commit the running image was built from (GIT_SHA build-arg). "dev"
  // for local/un-stamped builds. Lets a deploy be confirmed against the shipped
  // commit: `curl …/health` → `build` is the live image's SHA.
  build: string;
}

// Public (unauthenticated) BFF config the sign-in screen needs before a session
// exists. It never names the allowed email domains.
export interface PublicConfigResponse {
  // S38 — the sign-in methods this deployment actually accepts, and
  // whether account creation is open, so the sign-in screen renders what the
  // server will honour. Presentation signals only: the user-create hook and the
  // env guard remain the enforcement points.
  emailPasswordEnabled: boolean;
  googleEnabled: boolean;
  signupAllowed: boolean;
  // S33a — what a superset adds to sign-in (e.g. magic link), injected into
  // `createApp`. A presentation signal like the method flags above.
  capabilities: Capabilities;
  // S67 — the terms and privacy notice the sign-in screen links to; `null`
  // where the deployment configures none.
  legal: LegalLinks;
}

export interface LegalLinks {
  termsUrl: string | null;
  privacyUrl: string | null;
}

// S33a — the capabilities seam. OSS default: all off (`ossCapabilities`).
export interface Capabilities {
  magicLinkSignIn: boolean;
  // S48 — a superset offers link-first sign-up (then a set-password landing)
  // and password reset; the endpoints exist only there.
  verifiedSignUp: boolean;
  passwordReset: boolean;
}

// S1 — Identity. The current authenticated identity, as returned by the
// protected `GET /api/me` endpoint. `id` is the domain's stable `ownerId`.
export interface MeResponse {
  id: string;
  email: string;
  name: string;
  // S53 — present only when a superset supplies an organization context.
  organizations?: OrganizationContext;
}

// S53 — the organization context a superset supplies; absent in OSS.
export type OrgRole = "owner" | "admin" | "member";
export interface OrgMembership {
  id: string;
  name: string;
  role: OrgRole;
}
export interface OrganizationContext {
  activeId: string;
  memberships: OrgMembership[];
}

// S53 — `POST /api/me/active-organization`; answers a fresh `MeResponse`.
export interface SwitchOrganizationRequest {
  organizationId: string;
}

// S58 — `GET /api/organization`: the active org, as the Organization settings
// screen shows it. Absent in OSS (every organization route answers 404).
export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
}
export interface OrgInvitation {
  id: string;
  email: string;
  sentAt: string; // ISO-8601
}
export interface OrganizationSettings {
  id: string;
  name: string;
  // The earliest-joined owner.
  owner: { name: string; email: string };
  // The caller's role in this org.
  role: OrgRole;
  // Owners first, then by joined date.
  members: OrgMember[];
  // Owner/admin only.
  invitations?: OrgInvitation[];
  // Owner/admin only; empty = no one can be invited.
  inviteDomains?: string[];
}
// S58 — `PATCH /api/organization` and `POST /api/organization/invitations`.
export interface RenameOrganizationRequest {
  name: string;
}
export interface InviteRequest {
  email: string;
}

// S57 — `PATCH /api/me`: the caller's own name; answers a fresh `MeResponse`.
export interface UpdateMeRequest {
  name: string;
}

// S2 — Artefact. A client-facing view of an Artefact aggregate. The trusted
// HTML payload itself is never inlined — only its byte size is reported. Dates
// are serialised as ISO-8601 strings over the wire.
export interface ArtefactSummary {
  id: string;
  ownerId: string;
  title: string;
  kind: ArtefactKind;
  visibility: "private" | "selected" | "authenticated" | "public";
  // S25 (hosting.access.effective-from-tree-root) — the tier the artefact is actually served under:
  // its own when top-level, its collection tree root's when contained. The client renders the
  // "Inherited" state from the pair (collectionId, effectiveVisibility).
  effectiveVisibility: "private" | "selected" | "authenticated" | "public";
  collectionId: string | null;
  status: "active" | "archived";
  publicSlug: string | null;
  payloadBytes: number;
  // hosting.uses-storage.chrome-only: whether the artefact persists data (uses localStorage). The
  // client shows a small indicator for it in the dashboard/gallery card + row.
  usesStorage: boolean;
  // S41 (hosting.data-visibility.owner-set) — whether viewers may load each other's saved data
  // (`shared`) or only their own (`own`; the owner always sees all). Per artefact.
  dataVisibility: "shared" | "own";
  // S35 (hosting.thumbnail.summary-url) — the card preview, `/api/artefacts/<id>/thumbnail?v=<hash>`, while
  // the artefact is active and a render is recorded (the previous one stays until
  // the next lands); otherwise null and the card shows the kind placeholder.
  thumbnailUrl: string | null;
  // S32a (hosting.link-gate.owner-summary-only) — the link protection on a public artefact, for its
  // owner only: present (null = none) on the owner's own summaries, absent on everyone else's. The
  // password itself is never returned, only whether one is set.
  linkGate?: LinkGateSummary | null;
  createdAt: string;
  updatedAt: string;
}

// S32a — what the owner sees of a link gate.
export interface LinkGateSummary {
  passwordProtected: boolean;
  // ISO timestamp; null = never expires.
  expiresAt: string | null;
}

// S10 — "Your artefacts". The owner's own artefacts (archived hidden by default),
// most-recently-updated first. The client groups/filters by kind.
export interface ArtefactListResponse {
  artefacts: ArtefactSummary[];
}

// S14 — "Shared with you". A shared artefact as seen by a recipient, enriched
// (BFF-side) with the owner's display identity so the gallery can attribute it
// ("Shared by …") and show avatar initials. The owner ids come from Artefact
// Hosting; the names/emails are composed from the Identity context via the BFF
// user directory (the same lookup that labels the S12 data-context switcher).
export interface SharedArtefactSummary extends ArtefactSummary {
  owner: { name: string; email: string };
}

export interface SharedListResponse {
  artefacts: SharedArtefactSummary[];
}

// S5 — Share / unshare. Set an artefact's visibility tier. `private` unshares
// (retaining the slug); `selected`/`authenticated`/`public` share (minting the
// slug on the first share, reusing it thereafter). `selected` additionally gates
// on the access list managed via the S16 endpoints below.
export interface SetVisibilityRequest {
  visibility: ArtefactSummary["visibility"];
  // S32a (hosting.link-gate.public-only) — link protection set atomically with the change to
  // `public`; refused (400) with any other tier. Leaving `public` clears it.
  linkGate?: { password?: string; expiresAt?: string };
}

// S32a — `PUT /api/artefacts/:id/link-gate`. An omitted half is kept; `null`
// clears it. A password is 8–128 characters; `expiresAt` (ISO) in the future.
export interface SetLinkGateRequest {
  password?: string | null;
  expiresAt?: string | null;
}

// S55 — `PUT /api/artefacts/:id/sharing`: the Manage access dialog's Done.
// Every part is saved together, or — when any part is refused — none is.
// Answers the updated `ArtefactSummary`.
export interface SetSharingRequest {
  visibility: ArtefactSummary["visibility"]; // the target tier, always given
  members?: string[]; // the full access list; omitted = unchanged
  linkGate?: SetLinkGateRequest; // only with visibility "public"; omitted = unchanged
  dataVisibility?: ArtefactSummary["dataVisibility"]; // omitted = unchanged
}

// S32a (hosting.link-gate.narrows-public-audience) — a read the link gate stops until the viewer
// unlocks it (403).
export interface LinkGateChallengeResponse {
  gate: "password";
}

// S41 — Owner-set data visibility. `own` narrows each non-owner viewer to their
// own saved data; `shared` lets viewers load each other's (data.visibility.narrows-reads).
export interface SetDataVisibilityRequest {
  dataVisibility: ArtefactSummary["dataVisibility"];
}

// S16 — Share with specific people. A registered user as seen by the owner: a
// directory search hit, or a current member of an artefact's `selected`-tier
// access list. `id` is the BetterAuth user id (the domain's stable user ref).
export interface UserRef {
  id: string;
  name: string;
  email: string;
}

// `GET /api/users/search?q=` — users matching a name/email query, for the
// add-member picker. Excludes the caller; capped server-side.
export interface UserSearchResponse {
  users: UserRef[];
}

// `GET /api/artefacts/:id/access` — the artefact's current members (owner-only),
// enriched with display identity. `POST` grants ({ userId }); `DELETE
// /:userId` revokes.
export interface AccessListResponse {
  members: UserRef[];
}

export interface GrantAccessRequest {
  userId: string;
}

// S11 — Artefact Data. The caller's own opaque JSON blob for an artefact
// (`GET`/`PUT /api/artefacts/:slug/data/me`). `blob` is the raw JSON text,
// stored and returned verbatim; `null` when the caller has no entry yet. The
// PUT request body is the raw blob itself, not this wrapper.
export interface DataEntryResponse {
  blob: string | null;
  updatedAt: string | null;
}

// S36 — `POST /api/artefacts/:ref/frame-token`: a freshly tokened frame URL for
// the host shell (relative, or absolute on the content origin) and the seeded
// entry's `updatedAt` (null when none), the pin of the shell's next own save.
export interface FrameTokenResponse {
  frameUrl: string;
  // The message channel of the document that frame URL loads: the shell saves a
  // change only when the message carries it (data.shell.channel-binds-document).
  channel: string;
  seedUpdatedAt: string | null;
}

// S12 — Host data-context switcher. One author who holds a data entry for an
// artefact, enriched (BFF-side) with their display identity so the host picker
// can label contexts. Drives `GET /api/artefacts/:ref/data/authors`. The
// artefact itself never sees this — it stays single-dataset and opaque (AD).
export interface DataAuthorSummary {
  authorId: string;
  name: string;
  email: string;
  updatedAt: string;
}

export interface DataAuthorsResponse {
  authors: DataAuthorSummary[];
}

// S21 — Artefact Views ("who has viewed"). One viewer who has opened an artefact,
// enriched (BFF-side) with their display identity so the host "viewed by" widget
// can label them. Drives `GET /api/artefacts/:ref/viewers`. `viewedAt` is the
// most recent open (latest view only). The list excludes the caller.
export interface ArtefactViewerSummary {
  viewerId: string;
  name: string;
  email: string;
  viewedAt: string;
}

export interface ArtefactViewersResponse {
  viewers: ArtefactViewerSummary[];
}

// S47 — the caller's own views (views.mine.own-visible-only), newest first,
// for Home's Recent row and Last viewed sort. Only artefacts the caller can open now.
export interface MyViewsResponse {
  views: { artefactId: string; viewedAt: string }[];
}

// S25–S27 — Artefact Collections + Bookmarks (ddd/artefact-collections.md).
// A client-facing view of a Collection aggregate. Owner-only in v1 — these
// shapes never travel to non-owners. `visibility` is meaningful on roots only
// (collections.access.root-governs-tree); nested collections render as "Inherited" from the root.
export interface CollectionSummary {
  id: string;
  ownerId: string;
  name: string;
  // S74 — the owner's blurb, or null (collections.collection.description).
  description: string | null;
  parentId: string | null;
  rootId: string;
  visibility: ArtefactSummary["visibility"];
  status: "active" | "archived";
  // S32b — the link protection on a public root, which its whole tree follows:
  // present (null = none) on the owner's own summaries, absent on a summary of
  // a tree shared with the caller. Never the password itself.
  linkGate?: LinkGateSummary | null;
  // S44 — a root's public id, for the owner only: present on the owner's own
  // summaries (the slug or null on a root, null on a non-root), absent on a
  // summary of a tree shared with the caller.
  publicSlug?: string | null;
  createdAt: string;
  updatedAt: string;
}

// S44 — `GET /api/public/collections/:slug`, the anonymous read of a public,
// active, ungated root's tree (`collections.public-link.anonymous-projection`).
// Names, descriptions and structure only: no id, owner, access list, gate or data.
export interface PublicCollectionNode {
  name: string;
  description: string | null; // S74 — the owner's blurb, or null
  children: PublicCollectionNode[]; // active sub-collections, by name
  artefacts: PublicArtefactSummary[]; // active, slugged artefacts, by title
}

export interface PublicArtefactSummary {
  title: string;
  kind: ArtefactKind;
  slug: string;
  updatedAt: string;
  // `/api/artefacts/<slug>/thumbnail?v=<hash>`; null while none is rendered.
  thumbnailUrl: string | null;
}

export type PublicCollectionResponse = PublicCollectionNode; // the root

export interface CollectionListResponse {
  collections: CollectionSummary[];
}

export interface CreateCollectionRequest {
  name: string;
  description?: string | null;
  parentId?: string | null;
  visibility?: ArtefactSummary["visibility"];
}

// PATCH /api/collections/:id — rename, describe and/or change access (roots only, collections.access.set-on-root-only).
export interface EditCollectionRequest {
  name?: string;
  // S74 — a string sets it, null clears it, an absent key leaves it.
  description?: string | null;
  visibility?: ArtefactSummary["visibility"];
  // S32b — link protection set atomically with the root's change to `public`;
  // refused (400) with any other tier. Leaving `public` clears it.
  linkGate?: SetVisibilityRequest["linkGate"];
}

// S32b — `PUT /api/collections/:id/link-gate` takes a `SetLinkGateRequest`.

// PUT /api/artefacts/:id/collection — move an artefact (null = top level).
export interface MoveArtefactRequest {
  collectionId: string | null;
}

// Cascade counts (the collection lifecycle cascades, evictions included) — drives the toast/confirm copy ("archived
// with N artefacts", "N artefacts and M sub-collections will be deleted",
// "· K returned to their owners"). `artefacts` counts the collection owner's
// own; `evicted` counts foreign artefacts returned to top level untouched.
export interface CascadeCounts {
  collections: number;
  artefacts: number;
  evicted: number;
}

export interface CollectionLifecycleResponse {
  collection: CollectionSummary;
  cascade: CascadeCounts;
}

// GET /api/bookmarks — the caller's pins, resolved to live (non-archived)
// targets (collections.bookmark.hidden-not-pruned). Collections before artefacts is a client concern.
export interface BookmarksResponse {
  artefacts: ArtefactSummary[];
  collections: CollectionSummary[];
}

// S28 — `GET /api/shared/collections`: every node of every collection tree
// whose root grants the signed-in caller (collections.read.follows-root). `canContribute` is the
// per-tree collections.contributor.on-root-access-list decision, made server-side so the grantee list itself never
// travels; `owner` is the tree owner's display identity ("Shared by …").
export interface SharedCollectionSummary extends CollectionSummary {
  canContribute: boolean;
  owner: { name: string; email: string };
}

export interface SharedCollectionsResponse {
  collections: SharedCollectionSummary[];
}
