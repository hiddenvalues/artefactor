import type { Artefact } from "../../domain/artefact/artefact";
import type { ArtefactRepository } from "../../domain/artefact/artefact-repository";
import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import { CollectionNotFound } from "../../domain/collection/errors";
import type { PublicArtefactSummary, PublicCollectionNode } from "../../shared/contracts";

// S44 — the anonymous read of a public collection tree by its root slug, for a
// site built without a login. The slug resolve is tenant-global (like
// hosting.slug.globally-unique); every further read is scoped by the root's own
// tenant, as the serve path scopes its root lookup (`effective.ts`).

export interface PublicTreeDeps {
  collectionRepo: CollectionRepository;
  artefactRepo: ArtefactRepository;
}

export async function readPublicCollectionTree(
  slug: string,
  deps: PublicTreeDeps,
): Promise<PublicCollectionNode> {
  const root = await deps.collectionRepo.findBySlug(slug);
  if (!root || !isPubliclyReadable(root)) throw new CollectionNotFound(slug);

  const scope = { tenantId: root.tenantId };
  // Active nodes only; the root itself is among them.
  const nodes = await deps.collectionRepo.listByRoots([root.id], scope);
  const artefacts = await deps.artefactRepo.listByCollectionIds(
    nodes.map((n) => n.id),
    scope,
  );
  return projectTree(root, nodes, artefacts);
}

// The gate: a root, public, active and with no link gate — neither a password
// nor an expiry, since the root's gate is every contained artefact's
// (`collections.link-gate.root-governs-tree`). Anything else is one not-found.
// r[impl collections.public-link.anonymous-tree-read]
function isPubliclyReadable(root: Collection): boolean {
  return (
    root.parentId === null &&
    root.visibility === "public" &&
    root.status === "active" &&
    root.linkGate.passwordHash === null &&
    root.linkGate.expiresAt === null
  );
}

// Names, descriptions and structure, and per artefact what a listing card needs. Only nodes
// reachable from the root through active parents, and only active artefacts
// with a slug (the address the card links to). Never an id, owner, access list,
// gate or data.
// r[impl collections.public-link.anonymous-projection+2]
function projectTree(
  root: Collection,
  nodes: readonly Collection[],
  artefacts: readonly Artefact[],
): PublicCollectionNode {
  const childrenOf = new Map<string, Collection[]>();
  for (const n of nodes) {
    if (n.parentId === null || n.status !== "active") continue;
    childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);
  }
  const artefactsIn = new Map<string, PublicArtefactSummary[]>();
  for (const a of artefacts) {
    if (a.status !== "active" || a.publicSlug === null || a.collectionId === null) continue;
    artefactsIn.set(a.collectionId, [...(artefactsIn.get(a.collectionId) ?? []), toPublicArtefact(a, a.publicSlug)]);
  }
  const build = (node: Collection): PublicCollectionNode => ({
    name: node.name,
    description: node.description,
    children: (childrenOf.get(node.id) ?? []).sort(byName).map(build),
    artefacts: (artefactsIn.get(node.id) ?? []).sort((x, y) => compare(x.title, y.title)),
  });
  return build(root);
}

function toPublicArtefact(a: Artefact, slug: string): PublicArtefactSummary {
  return {
    title: a.title,
    kind: a.kind,
    slug,
    updatedAt: a.updatedAt.toISOString(),
    // Slug-addressed, so an anonymous caller can read it
    // (`hosting.thumbnail.anonymous-by-slug`); versioned like the owner's.
    thumbnailUrl:
      a.thumbnailHash === null
        ? null
        : `/api/artefacts/${encodeURIComponent(slug)}/thumbnail?v=${a.thumbnailHash}`,
  };
}

const byName = (x: Collection, y: Collection) => compare(x.name, y.name);
const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
