import { fail } from '../platform';
import { marginOf, type Ladder } from '../pricing';

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
 * `marginOf(ladder, that account)`; an entry without a ladder stores none of the seven. Answers each entry that breaks
 * it, and how.
 */
export function marginBreaks(rows: StoredRow[], layerOf: (id: string) => string): { id: string; reason: string }[] {
  const breaks: { id: string; reason: string }[] = [];
  for (const row of rows) {
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
