import type { Collection } from "./collection";

// Pure tree helpers over an owner's collection list. Collections per owner are
// few, so cascades and pickers work on the in-memory list rather than through
// recursive queries (the immutable `rootId` covers the cross-owner join cases).

// The node plus every descendant, in parent-before-child order. Used by the
// cascade commands (CL7/CL8) and the cascade-count UI.
export function collectSubtree(
  collections: readonly Collection[],
  id: string,
): Collection[] {
  const byParent = new Map<string, Collection[]>();
  for (const c of collections) {
    if (c.parentId === null) continue;
    const siblings = byParent.get(c.parentId) ?? [];
    siblings.push(c);
    byParent.set(c.parentId, siblings);
  }
  const root = collections.find((c) => c.id === id);
  if (!root) return [];
  const result: Collection[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    queue.push(...(byParent.get(node.id) ?? []));
  }
  return result;
}

// The chain from the node up to its root (inclusive), nearest-first. Used for
// breadcrumbs. Effective access needs only the root (via `rootId`), not the chain.
export function chainToRoot(
  collections: readonly Collection[],
  id: string,
): Collection[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const chain: Collection[] = [];
  let node = byId.get(id);
  while (node) {
    chain.push(node);
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return chain;
}
