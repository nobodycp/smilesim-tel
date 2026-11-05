// What one account may sell, at what price, and which line operations it may run.
//
// Every answer is resolved from the path of accounts from the user up to the root plus the
// rows written on that package. The functions take plain data and touch no database, so the
// service loads once per request and asks here. See
// docs/superpowers/specs/2026-11-05-user-packages-and-operations-design.md.

export const OP_KEYS = ['activate', 'charge', 'extend', 'switch', 'sim', 'esim', 'freeze', 'disconnect', 'rename'] as const;
export type OpKey = (typeof OP_KEYS)[number];
export type PriceKind = 'subscription' | 'renewal';
export type PriceSource = 'custom' | 'parent' | 'layer';

/** Index 0 is the user, the last entry is the root. */
export type PathNode = { id: string; loginName: string; layer: string; deniedOps: string };
export type TermRow = { userId: string; hidden: boolean; price: number | null; renewalPrice: number | null };
export type SellRow = { ownerId: string; price: number; renewalPrice: number | null };
export type LayerPrices = {
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  renewalBranchCost: number;
  renewalMainPrice: number;
  renewalAgentPrice: number;
  renewalPosPrice: number;
};

const OP_SET = new Set<string>(OP_KEYS);

export function isOpKey(value: string): value is OpKey {
  return OP_SET.has(value);
}

export function parseOps(stored: string): OpKey[] {
  const present = new Set(stored.split(',').map((part) => part.trim()).filter(isOpKey));
  return OP_KEYS.filter((key) => present.has(key));
}

export function serializeOps(keys: readonly string[]): string {
  const present = new Set(keys.filter(isOpKey));
  return OP_KEYS.filter((key) => present.has(key)).join(',');
}

function rowOf(terms: TermRow[], userId: string): TermRow | undefined {
  return terms.find((row) => row.userId === userId);
}

export function hiddenAbove(path: PathNode[], terms: TermRow[]): string | null {
  for (const node of path.slice(1)) {
    if (rowOf(terms, node.id)?.hidden) return node.loginName;
  }
  return null;
}

export function visibleTo(path: PathNode[], terms: TermRow[], pkg: { enabled: boolean; forSale: boolean }): boolean {
  if (!pkg.enabled || !pkg.forSale) return false;
  return path.every((node) => !rowOf(terms, node.id)?.hidden);
}

export function layerPrice(layer: string, prices: LayerPrices, kind: PriceKind): number {
  const renewal = kind === 'renewal';
  switch (layer) {
    case 'main_agent':
      return renewal ? prices.renewalMainPrice : prices.mainPrice;
    case 'agent':
      return renewal ? prices.renewalAgentPrice : prices.agentPrice;
    case 'pos':
      return renewal ? prices.renewalPosPrice : prices.posPrice;
    default:
      return renewal ? prices.renewalBranchCost : prices.branchCost;
  }
}

function customPrice(path: PathNode[], terms: TermRow[], kind: PriceKind): number | null {
  const row = rowOf(terms, path[0].id);
  if (!row) return null;
  return kind === 'renewal' ? row.renewalPrice : row.price;
}

function parentSellPrice(path: PathNode[], sells: SellRow[], kind: PriceKind): number | null {
  const parent = path[1];
  if (!parent || parent.layer === 'branch') return null;
  const row = sells.find((sell) => sell.ownerId === parent.id);
  if (!row) return null;
  return kind === 'renewal' ? row.renewalPrice : row.price;
}

export function priceSource(path: PathNode[], terms: TermRow[], sells: SellRow[], kind: PriceKind): PriceSource {
  if (customPrice(path, terms, kind) !== null) return 'custom';
  if (parentSellPrice(path, sells, kind) !== null) return 'parent';
  return 'layer';
}

export function buyPriceFor(path: PathNode[], terms: TermRow[], sells: SellRow[], prices: LayerPrices, kind: PriceKind): number {
  return customPrice(path, terms, kind) ?? parentSellPrice(path, sells, kind) ?? layerPrice(path[0].layer, prices, kind);
}

/** The least a parent may charge this user: what the parent itself pays. A branch account's floor is cost. */
export function floorFor(path: PathNode[], terms: TermRow[], sells: SellRow[], prices: LayerPrices, kind: PriceKind): number {
  if (path.length < 2) return layerPrice('branch', prices, kind);
  return buyPriceFor(path.slice(1), terms, sells, prices, kind);
}

export function deniedOpsFor(path: PathNode[]): Set<OpKey> {
  const denied = new Set<OpKey>();
  for (const node of path) for (const key of parseOps(node.deniedOps)) denied.add(key);
  return denied;
}

/** Stops inherited from above, each with the nearest ancestor that set it. The user's own stops are not listed. */
export function deniedAbove(path: PathNode[]): { op: OpKey; login: string }[] {
  const found = new Map<OpKey, string>();
  for (const node of path.slice(1)) {
    for (const key of parseOps(node.deniedOps)) if (!found.has(key)) found.set(key, node.loginName);
  }
  return OP_KEYS.filter((key) => found.has(key)).map((key) => ({ op: key, login: found.get(key) as string }));
}
