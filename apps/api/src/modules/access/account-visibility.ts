// Which accounts an account may see: itself and everything below it. Pure: no Nest, no Prisma.

export type AccountNode = { id: string; parentId: string | null; layer: string };

export function visibleAccountIds(actorId: string, actorLayer: string, nodes: AccountNode[]): Set<string> {
  if (actorLayer === 'branch') return new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const seen = new Set<string>([actorId]);
  const stack = [actorId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return seen;
}
