import type { Collection } from "../../domain/collection/collection";
import type { CollectionRepository } from "../../domain/collection/collection-repository";
import type { TenantScope } from "../../domain/artefact/tenant-scope";
import type { Visibility } from "../../domain/artefact/visibility";
import { listOwnCollections } from "./collections.command";
import { listSharedCollections } from "./shared-collections.query";

// S75 — the collections an Account may move an artefact into, for the MCP `list_collections`
// tool: their own, and every node of a tree they contribute to, decided by the same
// `canContributeToTree` the move command uses so the list and the move never disagree. A
// placement read, not a viewer read: a tree the caller can only view is never listed.
export interface PlaceableCollection {
  collection: Collection;
  // The names from the tree root down to this collection.
  path: string[];
  own: boolean;
  // The tree root's tier — the one an artefact placed here is served under
  // (hosting.access.effective-from-tree-root).
  visibility: Visibility;
}

// r[impl mcp.collections.list-placeable]
export async function listPlaceableCollections(
  requesterId: string,
  scope: TenantScope,
  deps: { collectionRepo: CollectionRepository },
): Promise<PlaceableCollection[]> {
  const [own, shared] = await Promise.all([
    listOwnCollections({ requesterId, scope }, deps),
    listSharedCollections(requesterId, scope, deps),
  ]);
  const contributed = shared
    .filter((node) => node.canContribute)
    .map((node) => node.collection);
  const active = (nodes: Collection[]) => nodes.filter((c) => c.status === "active");
  return [...asTrees(active(own), true), ...asTrees(active(contributed), false)];
}

const byName = (a: Collection, b: Collection) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

// Lay a set of whole trees out depth-first: roots by name, then each node's children by name,
// every row carrying its path from the root. A node whose parent is not in the set is
// unreachable and left out.
// r[impl mcp.collections.list-shape]
function asTrees(nodes: Collection[], own: boolean): PlaceableCollection[] {
  const children = new Map<string | null, Collection[]>();
  for (const c of nodes) {
    const siblings = children.get(c.parentId);
    if (siblings) siblings.push(c);
    else children.set(c.parentId, [c]);
  }
  const rows: PlaceableCollection[] = [];
  const visit = (c: Collection, path: string[], visibility: Visibility) => {
    rows.push({ collection: c, path, own, visibility });
    for (const child of (children.get(c.id) ?? []).sort(byName)) {
      visit(child, [...path, child.name], visibility);
    }
  };
  for (const root of (children.get(null) ?? []).sort(byName)) {
    visit(root, [root.name], root.visibility);
  }
  return rows;
}
