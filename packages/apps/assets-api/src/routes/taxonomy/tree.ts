import type { CollectionWithCount, TreeNode } from './types.js';

export function buildTree<T extends { id: string; parentId?: string | null }>(
  items: T[]
): Array<TreeNode<T>> {
  const byId = new Map<string, TreeNode<T>>();
  const roots: Array<TreeNode<T>> = [];

  items.forEach((item) => {
    byId.set(item.id, { ...item, children: [] });
  });

  items.forEach((item) => {
    const node = byId.get(item.id);
    if (!node) {
      return;
    }

    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export function withSubtreeCounts(nodes: CollectionWithCount[]): CollectionWithCount[] {
  return nodes.map((node) => {
    const children = withSubtreeCounts(node.children);
    const descendantsCount = children.reduce((sum, child) => sum + (child.assetCount ?? 0), 0);

    return {
      ...node,
      children,
      assetCount: (node.assetCount ?? 0) + descendantsCount,
    };
  });
}
