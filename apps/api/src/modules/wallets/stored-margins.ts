import type { Prisma } from '../../generated/prisma/client';
import { fail } from '../platform';
import { REFUND_KINDS, SALE_KINDS, marginOf, type Ladder } from '../pricing';

// Each sale's and refund's margins, stored on its wallet entry (ADR 0026). The entry's `ladder` is the source; these
// columns are its projection by `marginOf`, written in the entry's own INSERT and never updated. A chain holds one
// account a layer (account creation hangs each account under the layer directly above it, a transfer moves a point
// of sale under an agent and an agent under a main agent), so each layer's share is a column.

/** The chain's accounts by layer: the point of sale (`chain[0]`), and its agent and main agent, null when it has none. */
export type ChainIds = { chainPosId: string; chainAgentId: string | null; chainMainAgentId: string | null };

/** The seven columns an entry with a ladder stores. */
export type MarginColumns = ChainIds & { posMargin: number; agentMargin: number | null; mainAgentMargin: number | null; branchMargin: number };

/** What an entry without a ladder stores: nothing (a switch, a fund, a hold; a sale whose ladder could not be built). */
export const NO_MARGINS = {
  chainPosId: null,
  chainAgentId: null,
  chainMainAgentId: null,
  posMargin: null,
  agentMargin: null,
  mainAgentMargin: null,
  branchMargin: null,
} as const;

export type StoredMargins = MarginColumns | typeof NO_MARGINS;

/**
 * What an operation marked as a loss stores (spec DB.5 P.7): the point of sale paid 0, so nobody below the branch
 * earned or lost on it, and the branch paid the provider. Only `branchMargin`, minus the cost; no chain ids, so the row
 * is in no lower layer's figures. It is what `marginOf` gives on a ladder with the sell price and every cost below the
 * branch 0 and the provider's cost at the branch.
 */
export function lossMargins(providerCost: number) {
  return { ...NO_MARGINS, branchMargin: -providerCost };
}

/**
 * The layers of a sale's path (the seller first, the branch last), as `confirmedPath` answered it. A path that holds
 * two accounts of one layer cannot be stored by layer: the sale is refused (409), as a path that is no longer the
 * seller's is (ADR 0026, rule 1). The tree never builds one (see above).
 */
export function chainIdsOf(path: readonly { id: string; layer: string }[]): ChainIds {
  const layers = new Set<string>();
  for (const node of path) {
    if (layers.has(node.layer)) fail(409, 'DUPLICATE_REQUEST');
    layers.add(node.layer);
  }
  const above = path.slice(1);
  return {
    chainPosId: path[0].id,
    chainAgentId: above.find((node) => node.layer === 'agent')?.id ?? null,
    chainMainAgentId: above.find((node) => node.layer === 'main_agent')?.id ?? null,
  };
}

/** The margins of `ladder` for the chain's accounts: `marginOf` for each, the branch being the chain's last account. */
export function marginColumns(ladder: Ladder, ids: ChainIds): MarginColumns {
  const of = (id: string | null) => (id === null ? null : marginOf(ladder, id));
  const posMargin = of(ids.chainPosId);
  const branchMargin = of(ladder.chain[ladder.chain.length - 1] ?? null);
  // The ids come from the same path as the ladder's chain (a refund: from its sale's entry, whose ladder it scales).
  if (posMargin === null || branchMargin === null) throw new Error('a ladder whose chain does not hold its point of sale (ADR 0026)');
  return { ...ids, posMargin, agentMargin: of(ids.chainAgentId), mainAgentMargin: of(ids.chainMainAgentId), branchMargin };
}

/** The ids an entry stored, when it stored them. */
export function storedChainIds(row: { chainPosId?: string | null; chainAgentId?: string | null; chainMainAgentId?: string | null }): ChainIds | null {
  return row.chainPosId ? { chainPosId: row.chainPosId, chainAgentId: row.chainAgentId ?? null, chainMainAgentId: row.chainMainAgentId ?? null } : null;
}

type StoredRow = {
  id: string;
  ladder: unknown;
  /** The loss mark and the cost (P.7): a marked row stores only `branchMargin` = − `providerCost`. */
  providerLoss?: string | null;
  providerCost?: number | null;
  chainPosId: string | null;
  chainAgentId: string | null;
  chainMainAgentId: string | null;
  posMargin: number | null;
  agentMargin: number | null;
  mainAgentMargin: number | null;
  branchMargin: number | null;
};

const COLUMNS = ['chainPosId', 'chainAgentId', 'chainMainAgentId', 'posMargin', 'agentMargin', 'mainAgentMargin', 'branchMargin'] as const;

/**
 * The invariant of ADR 0026 (rule 6), in Node and not in SQL: a refund's margin is JavaScript's `Math.round` of a
 * float (ties toward +∞), which PostgreSQL's `round` does not reproduce. For every entry with a ladder, the stored ids
 * are its chain's accounts by layer (`layerOf`: each account's layer, which never changes) and each stored margin is
 * `marginOf(ladder, that account)`; an entry without a ladder stores none of the seven, except an operation marked as a
 * loss (P.7), which stores only `branchMargin` = − its provider cost. Answers each entry that breaks it, and how.
 */
export function marginBreaks(rows: StoredRow[], layerOf: (id: string) => string): { id: string; reason: string }[] {
  const breaks: { id: string; reason: string }[] = [];
  for (const row of rows) {
    if (!row.ladder && row.providerLoss) {
      const set = COLUMNS.filter((key) => key !== 'branchMargin' && row[key] !== null);
      const expected = -(row.providerCost ?? 0);
      if (set.length || row.branchMargin !== expected) breaks.push({ id: row.id, reason: `marked ${row.providerLoss}: branchMargin ${row.branchMargin ?? 'none'} (expected ${expected})${set.length ? `, yet ${set.join(', ')} stored` : ''}` });
      continue;
    }
    if (!row.ladder) {
      const set = COLUMNS.filter((key) => row[key] !== null);
      if (set.length) breaks.push({ id: row.id, reason: `no ladder, yet ${set.join(', ')} stored` });
      continue;
    }
    const ladder = row.ladder as Ladder;
    let expected: MarginColumns;
    try {
      expected = marginColumns(ladder, chainIdsOf(ladder.chain.map((id) => ({ id, layer: layerOf(id) }))));
    } catch {
      breaks.push({ id: row.id, reason: 'its ladder\'s chain cannot be stored by layer' });
      continue;
    }
    const wrong = COLUMNS.filter((key) => row[key] !== expected[key]);
    if (wrong.length) breaks.push({ id: row.id, reason: wrong.map((key) => `${key} ${row[key] ?? 'none'} (expected ${expected[key] ?? 'none'})`).join(', ') });
  }
  return breaks;
}

/** The sales (a negative amount) and the refunds (a positive one): the entries that carry a margin. */
export function saleOrRefundWhere(): Prisma.WalletEntryWhereInput {
  return { OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }] };
}

/**
 * Whose margins a viewer reads (ADR 0026, the owner's answer 1): its own layer's column, over the sales and refunds
 * whose chain held it **at the time of the sale**, wherever its points of sale are now. The branch (the owner and its
 * staff) reads the branch's margin of every sale. `chain` is the column of the viewer's account, null for the branch.
 */
export type MarginView = {
  viewerId: string;
  layer: 'pos' | 'agent' | 'main_agent' | 'branch';
  chain: 'chainPosId' | 'chainAgentId' | 'chainMainAgentId' | null;
  margin: 'posMargin' | 'agentMargin' | 'mainAgentMargin' | 'branchMargin';
};

const VIEWS: Record<MarginView['layer'], Pick<MarginView, 'chain' | 'margin'>> = {
  pos: { chain: 'chainPosId', margin: 'posMargin' },
  agent: { chain: 'chainAgentId', margin: 'agentMargin' },
  main_agent: { chain: 'chainMainAgentId', margin: 'mainAgentMargin' },
  branch: { chain: null, margin: 'branchMargin' },
};

export function marginViewOf(actor: { id: string; layer: string }): MarginView {
  const layer = actor.layer as MarginView['layer'];
  if (!VIEWS[layer]) fail(403, 'FORBIDDEN');
  return { viewerId: actor.id, layer, ...VIEWS[layer] };
}

/** The entries whose chain held the viewer at the time (every entry for the branch). */
export function marginWhere(view: MarginView): Prisma.WalletEntryWhereInput {
  return view.chain ? { [view.chain]: view.viewerId } : {};
}

type MarginRow = Pick<StoredRow, 'chainPosId' | 'chainAgentId' | 'chainMainAgentId' | 'posMargin' | 'agentMargin' | 'mainAgentMargin' | 'branchMargin'>;

/** What the viewer earned on one entry, as stored; null when the entry is not a sale or refund in its chain. */
export function storedMarginOf(view: MarginView, row: MarginRow): number | null {
  if (!view.chain) return row.branchMargin ?? null;
  return row[view.chain] === view.viewerId ? (row[view.margin] ?? null) : null;
}
