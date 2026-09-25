import type { CollectionSummary } from "../../shared/contracts";

export interface TreeNode {
  c: CollectionSummary;
  depth: number;
  hasChildren: boolean;
}

/** A collection forest flattened depth-first, name-ordered per level, walking
 *  into a node only while it is expanded. */
export function flattenTree(collections: CollectionSummary[], expanded: Record<string, boolean>): TreeNode[] {
  const byParent = new Map<string | null, CollectionSummary[]>();
  for (const c of collections) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: TreeNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(c.id) ?? []).length > 0;
      out.push({ c, depth, hasChildren });
      if (hasChildren && expanded[c.id]) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
