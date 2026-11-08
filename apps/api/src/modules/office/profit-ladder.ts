// What each account in a sale's chain earned on it (roadmap N4, owner 2026-11-08). The chain is never broken
// (branch → main agent → agent → point of sale; account creation and moves keep it), so every layer's margin is the
// price it sold at to the layer under it minus the price it bought at. The point of sale's margin is its own sell price
// (or the package's subscriber price) minus what it paid. Pure: the callers load the rows.

import { buyPriceFor, layerPrice, type LayerPrices, type PathNode, type PriceKind, type SellRow, type TermRow } from './user-terms';

/** The wallet entries that sell something, and which price they use. A switch moves a difference, not a sale. */
export const SALE_KINDS: Readonly<Record<string, PriceKind>> = {
  activate: 'subscription',
  charge: 'renewal',
  extend: 'renewal',
  reactivate: 'renewal',
};

/** Stored on the wallet entry at the sale: the chain (point of sale first), what each paid, and the sell price. */
export type Ladder = { kind: PriceKind; chain: string[]; costs: Record<string, number>; posSell: number };

export type SubscriberPrices = { subscriberPrice: number; renewalSubscriberPrice: number };

export function ladderOf(
  path: PathNode[],
  terms: TermRow[],
  sells: SellRow[],
  prices: LayerPrices & SubscriberPrices,
  kind: PriceKind,
  posPaid?: number | null,
): Ladder {
  const costs: Record<string, number> = {};
  path.forEach((node, index) => {
    costs[node.id] = node.layer === 'branch' ? layerPrice('branch', prices, kind) : buyPriceFor(path.slice(index), terms, sells, prices, kind);
  });
  const pos = path[0];
  if (pos && posPaid != null) costs[pos.id] = posPaid;
  const own = pos ? sells.find((row) => row.ownerId === pos.id) : undefined;
  const ownSell = own ? (kind === 'renewal' ? own.renewalPrice : own.price) : null;
  const posSell = ownSell ?? (kind === 'renewal' ? prices.renewalSubscriberPrice : prices.subscriberPrice);
  return { kind, chain: path.map((node) => node.id), costs, posSell };
}

/** What `viewerId` earned on this sale, or null when it is not in the chain. */
export function marginOf(ladder: Ladder, viewerId: string): number | null {
  const at = ladder.chain.indexOf(viewerId);
  if (at < 0) return null;
  const mine = ladder.costs[viewerId] ?? 0;
  if (at === 0) return ladder.posSell - mine;
  const below = ladder.costs[ladder.chain[at - 1]] ?? mine;
  return below - mine;
}
