import type {
  ArtefactSummary,
  CollectionSummary,
  LinkGateSummary,
  SharedArtefactSummary,
  UserRef,
} from "../../shared/contracts";
import type { OwnedItemProps } from "../lib/components/ArtefactCard";
import type { GalleryItemProps } from "../lib/components/GalleryCard";

// Fixture data for the previews, and a stand-in for the BFF so a component that
// fetches (the member picker) renders in the catalog with no server behind it.

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

export const viewer: UserRef = { id: "user-ada", name: "Ada Lovelace", email: "ada@example.com" };
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
  const inCollection = collections.find((c) => c.id === a.collectionId);
  return {
    a,
    onOpen: noop,
    onCopy: noop,
    onEdit: noop,
    onArchive: noop,
    onVisibility: noop,
    onLinkGate: noop,
    onManage: noop,
    onDataVisibility: noop,
    collectionName: inCollection?.name ?? null,
    onOpenCollection: noop,
    bookmarked: false,
    onBookmark: noop,
    onMoveToCollection: noop,
    ...over,
  };
}

/** The handlers a gallery card or row takes, all inert. */
export function galleryProps(g: SharedArtefactSummary, over: Partial<GalleryItemProps> = {}): GalleryItemProps {
  return { g, onOpen: noop, bookmarked: false, onBookmark: noop, ...over };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Answers the few BFF calls a preview makes; anything else under /api is a 404. */
export function installFixtureApi(): void {
  const real = window.fetch.bind(window);
  const members = [people[0]!];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    await new Promise((r) => setTimeout(r, 120));
    const method = (init?.method ?? "GET").toUpperCase();
    if (/\/access$/.test(url.pathname) && method === "GET") return json({ members });
    if (/\/access(\/[^/]+)?$/.test(url.pathname)) return json({});
    if (url.pathname === "/api/users/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return json({ users: people.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)) });
    }
    return new Response(null, { status: 404 });
  };
}
