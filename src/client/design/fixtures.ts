import type {
  ArtefactSummary,
  CollectionSummary,
  LinkGateSummary,
  OrganizationContext,
  OrganizationSettings,
  OrgMembership,
  PublicConfigResponse,
  SharedArtefactSummary,
  SharedCollectionSummary,
  UserRef,
} from "../../shared/contracts";
import { collectionRowOf } from "../lib/artefact-card";
import type { OwnedItemProps, SharedItemProps } from "../lib/components/ArtefactCard";

// Fixture data for the previews, and a stand-in for the BFF so a component that
// fetches (the member picker) renders in the catalog with no server behind it.

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

export const viewer: UserRef = { id: "user-ada", name: "Ada Lovelace", email: "ada@example.com" };

// S53 — organization contexts a superset would report on /api/me.
const hiddenValue: OrgMembership = { id: "org-hidden-value", name: "Hidden Value", role: "owner" };
export const ownerOfOne: OrganizationContext = { activeId: hiddenValue.id, memberships: [hiddenValue] };
export const memberOfSeveral: OrganizationContext = {
  activeId: "org-acme",
  memberships: [
    { ...hiddenValue, role: "admin" },
    { id: "org-acme", name: "Acme Studios", role: "member" },
    { id: "org-north", name: "Northwind", role: "owner" },
  ],
};
export const people: UserRef[] = [
  { id: "user-grace", name: "Grace Hopper", email: "grace@example.com" },
  { id: "user-alan", name: "Alan Turing", email: "alan@example.com" },
  { id: "user-katherine", name: "Katherine Johnson", email: "katherine@example.com" },
];

/** An owned artefact; override what the variant is about. */
export function artefact(over: Partial<ArtefactSummary> = {}): ArtefactSummary {
  return {
    id: "art-onboarding",
    ownerId: viewer.id,
    title: "Onboarding flow prototype",
    kind: "prototype",
    visibility: "private",
    effectiveVisibility: over.visibility ?? "private",
    collectionId: null,
    status: "active",
    publicSlug: null,
    payloadBytes: 184_320,
    usesStorage: false,
    dataVisibility: "own",
    thumbnailUrl: null,
    linkGate: null,
    createdAt: ago(72),
    updatedAt: ago(3),
    ...over,
  };
}

/** An artefact someone else shared with the viewer. */
export function shared(over: Partial<SharedArtefactSummary> = {}): SharedArtefactSummary {
  return {
    ...artefact({
      id: "art-q3-review",
      ownerId: people[0]!.id,
      title: "Q3 roadmap review",
      kind: "slide-deck",
      visibility: "authenticated",
      effectiveVisibility: "authenticated",
      publicSlug: "k3v9xq",
      linkGate: undefined,
      updatedAt: ago(26),
    }),
    owner: { name: people[0]!.name, email: people[0]!.email },
    ...over,
  };
}

export const library: ArtefactSummary[] = [
  artefact(),
  artefact({ id: "art-deck", title: "Design review deck", kind: "slide-deck", visibility: "authenticated", publicSlug: "d3ck01" }),
  artefact({ id: "art-survey", title: "Customer survey", kind: "form", visibility: "public", publicSlug: "surv3y", usesStorage: true }),
  artefact({ id: "art-guide", title: "Interactive style guide", kind: "interactive-doc", collectionId: "col-design" }),
  artefact({ id: "art-misc", title: "Scratch notes", kind: "other", payloadBytes: 2_048 }),
];

/** A collection; override what the variant is about. */
export function collection(over: Partial<CollectionSummary> = {}): CollectionSummary {
  const id = over.id ?? "col-design";
  return {
    id,
    ownerId: viewer.id,
    name: "Design system",
    description: null,
    parentId: null,
    rootId: over.parentId ? "col-design" : id,
    visibility: "private",
    status: "active",
    createdAt: ago(240),
    updatedAt: ago(5),
    ...over,
  };
}

export const collections: CollectionSummary[] = [
  collection(),
  collection({ id: "col-tokens", name: "Tokens", parentId: "col-design" }),
  collection({ id: "col-screens", name: "Screens", parentId: "col-design" }),
  collection({ id: "col-research", name: "Research", visibility: "authenticated" }),
];

export const gates: Record<"none" | "password" | "expiring" | "expired" | "both", LinkGateSummary | null> = {
  none: null,
  password: { passwordProtected: true, expiresAt: null },
  expiring: { passwordProtected: false, expiresAt: ahead(48) },
  expired: { passwordProtected: false, expiresAt: ago(2) },
  both: { passwordProtected: true, expiresAt: ahead(48) },
};

/** A thumbnail that needs no server: a tiny SVG in the kind's own ink. */
export const thumbnail =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="white"/>' +
      '<rect x="12" y="12" width="90" height="10" rx="3" fill="gray"/><rect x="12" y="32" width="136" height="56" rx="6" fill="lightgray"/></svg>',
  );

export const noop = () => {};

/** The handlers an owned card or row takes, all inert. */
export function ownedProps(a: ArtefactSummary, over: Partial<OwnedItemProps> = {}): OwnedItemProps {
  const inCollection = collectionRowOf(a, collectionById);
  return {
    a,
    onOpen: noop,
    onCopy: noop,
    onEdit: noop,
    onArchive: noop,
    onShare: noop,
    onDataVisibility: noop,
    collectionName: inCollection?.name ?? null,
    collection: inCollection,
    onOpenCollection: noop,
    bookmarked: false,
    onBookmark: noop,
    onRemoveBookmark: noop,
    onMoveToCollection: noop,
    ...over,
  };
}

/** S47 — the handlers a shared-mode ArtefactCard or row takes, all inert. */
export function sharedProps(a: SharedArtefactSummary, over: Partial<SharedItemProps> = {}): SharedItemProps {
  const inCollection = collectionRowOf(a, collectionById);
  return {
    a,
    shared: true,
    onOpen: noop,
    onCopy: noop,
    bookmarked: false,
    onBookmark: noop,
    onRemoveBookmark: noop,
    collection: inCollection,
    onOpenCollection: noop,
    ...over,
  };
}

// S70 — what the screen previews need beyond the components': a library with
// owned and shared artefacts across kinds and access levels, a collection tree,
// the viewer's views, an organization and the sign-in screen's config.

/** The viewer's own library on Home: the base set, some in collections, some with thumbnails. */
export const ownedLibrary: ArtefactSummary[] = [
  ...library.map((a, i) => (i % 2 === 0 ? { ...a, thumbnailUrl: thumbnail } : a)),
  artefact({ id: "art-tokens", title: "Colour token explorer", kind: "interactive-doc", collectionId: "col-tokens", updatedAt: ago(30) }),
  artefact({ id: "art-checkout", title: "Checkout redesign", kind: "prototype", collectionId: "col-screens", visibility: "public", publicSlug: "ch3ck0", linkGate: gates.password, updatedAt: ago(52) }),
  artefact({ id: "art-interviews", title: "Interview synthesis", kind: "slide-deck", collectionId: "col-research", visibility: "authenticated", effectiveVisibility: "authenticated", updatedAt: ago(96) }),
];

/** Artefacts other people shared with the viewer. */
export const sharedLibrary: SharedArtefactSummary[] = [
  shared(),
  shared({ id: "art-pricing", title: "Pricing calculator", kind: "form", updatedAt: ago(8), owner: { name: people[1]!.name, email: people[1]!.email }, ownerId: people[1]!.id }),
  shared({ id: "art-launch", title: "Launch checklist", kind: "interactive-doc", collectionId: "col-shared-research", updatedAt: ago(140) }),
];

/** What the viewer last opened (views.mine.own-visible-only): artefact id → `viewedAt`. */
export const views: ReadonlyMap<string, string> = new Map([
  ["art-q3-review", ago(1)],
  ["art-deck", ago(4)],
  ["art-pricing", ago(20)],
]);

/** A collection tree another user shared with the viewer (S28), read-only. */
const byGrace = { owner: { name: people[0]!.name, email: people[0]!.email }, canContribute: false };
export const sharedCollections: SharedCollectionSummary[] = [
  { ...collection({ id: "col-shared-research", ownerId: people[0]!.id, name: "User research", visibility: "authenticated" }), ...byGrace },
  {
    ...collection({ id: "col-shared-interviews", ownerId: people[0]!.id, name: "Interviews", parentId: "col-shared-research", rootId: "col-shared-research", visibility: "authenticated" }),
    ...byGrace,
  },
];

/** The archive: an artefact and a collection put away. */
export const archivedLibrary: ArtefactSummary[] = [
  artefact({ id: "art-old-deck", title: "Kick-off deck (draft)", kind: "slide-deck", status: "archived", updatedAt: ago(400) }),
  artefact({ id: "art-old-form", title: "Beta sign-up form", kind: "form", status: "archived", updatedAt: ago(700) }),
];
export const archivedCollections: CollectionSummary[] = [collection({ id: "col-old", name: "Spring campaign", status: "archived", updatedAt: ago(500) })];

/** Every collection the viewer can see (own, active and archived, and shared) by id, as the app resolves a card's collection. */
export const collectionById: Map<string, CollectionSummary> = new Map(
  [...collections, ...archivedCollections, ...sharedCollections].map((c) => [c.id, c]),
);

/** S58 — the active organization's settings, as its owner sees them. */
export const organization: OrganizationSettings = {
  id: ownerOfOne.activeId!,
  name: "Hidden Value",
  owner: { name: viewer.name, email: viewer.email },
  role: "owner",
  members: [
    { ...viewer, role: "owner" },
    { ...people[0]!, role: "admin" },
    { ...people[1]!, role: "member" },
  ],
  invitations: [{ id: "inv-katherine", email: people[2]!.email, sentAt: ago(20) }],
  inviteDomains: ["example.com"],
};

/** The sign-in screen's config: email + password and Google, with the superset's magic link and reset. */
export const publicConfig: PublicConfigResponse = {
  emailPasswordEnabled: true,
  googleEnabled: true,
  signupAllowed: true,
  capabilities: { magicLinkSignIn: true, verifiedSignUp: true, passwordReset: true, shareInvitations: true },
  legal: { termsUrl: "https://example.com/terms", privacyUrl: "https://example.com/privacy" },
};

/** S71 — an invented authorize request for the consent screen's Ready state. */
export const consentRequest = { clientName: "Claude", returnHost: "claude.ai" };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** A string field of a JSON request body; undefined when the body is absent, not JSON or lacks it. */
function field(init: RequestInit | undefined, name: string): string | undefined {
  try {
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const value = body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Answers the few BFF calls a preview makes; anything else under /api is a 404. */
export function installFixtureApi(): void {
  const real = window.fetch.bind(window);
  const members = [people[0]!];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    await new Promise((r) => setTimeout(r, 120));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (/\/access$/.test(url.pathname) && method === "GET") return json({ members });
    if (/\/access(\/[^/]+)?$/.test(url.pathname)) return json({});
    if (url.pathname === "/api/organization" && method === "GET") return json(organization);
    // S70 — the account and organization screens' writes, echoed without keeping state;
    // a write without its field, or a revoke of an unknown invitation, gets no answer.
    const name = field(init, "name");
    if (url.pathname === "/api/me" && method === "PATCH" && name !== undefined) return json({ ...viewer, name, organizations: ownerOfOne });
    if (url.pathname === "/api/organization" && method === "PATCH" && name !== undefined) return json({ ...organization, name });
    const invitations = organization.invitations ?? [];
    const email = field(init, "email");
    if (url.pathname === "/api/organization/invitations" && method === "POST" && email !== undefined)
      return json({ ...organization, invitations: [...invitations, { id: "inv-new", email, sentAt: ago(0) }] });
    const revoked = /^\/api\/organization\/invitations\/([^/]+)$/.exec(url.pathname)?.[1];
    if (method === "DELETE" && invitations.some((i) => encodeURIComponent(i.id) === revoked))
      return json({ ...organization, invitations: invitations.filter((i) => encodeURIComponent(i.id) !== revoked) });
    if (url.pathname === "/api/config") return json(publicConfig);
    if (url.pathname === "/api/users/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return json({ users: people.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)) });
    }
    // A call no fixture answers is a console error, so the catalog's browser suite fails on it.
    console.error(`fixture API: no answer for ${method} ${url.pathname}`);
    return new Response(null, { status: 404 });
  };
}
