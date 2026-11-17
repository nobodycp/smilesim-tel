import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { LineReads } from '../../sales/line-reads';
import { LinesRepository } from '../../sales/lines.repository';
import { ServiceGraph } from '../../testing/service-graph';
import { WalletsRepository } from '../../wallets/wallets.repository';
import { WalletsService } from '../../wallets/wallets.service';
import { DeskRepository } from './desk.repository';
import { DeskService } from './desk.service';
import { OverviewService } from './overview.service';

// Database plan DB.10: the branch sees every point of sale, so the numbers list, the overview and the desk send it no
// `posId IN (…)` / `userId IN (…)` list (as `taskWhereFor` and `financeWhere` already do). Every other layer still
// sends exactly its visible points of sale: a frozen one included, one in another chain never.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'staff', loginName: 'staff', nickname: 's', layer: 'branch', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'main1', loginName: 'main1', nickname: 'm1', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent1', loginName: 'agent1', nickname: 'a1', layer: 'agent', parentId: 'main1', deniedOps: '', disabledAt: null },
  { id: 'pos1', loginName: 'pos1', nickname: 'p1', layer: 'pos', parentId: 'agent1', deniedOps: '', disabledAt: null },
  { id: 'pos2', loginName: 'pos2', nickname: 'p2', layer: 'pos', parentId: 'agent1', deniedOps: '', disabledAt: new Date('2026-11-01T00:00:00Z') },
  { id: 'main2', loginName: 'main2', nickname: 'm2', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'pos3', loginName: 'pos3', nickname: 'p3', layer: 'pos', parentId: 'main2', deniedOps: '', disabledAt: null },
];

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: false, grants: [], operatorId: id, impersonating: false });

/** Every `where` the services hand to the line and wallet-entry reads, by model. */
function setup() {
  const kernel = new ServiceGraph(new MemoryAuthStore());
  const seen = { line: [] as unknown[], entry: [] as unknown[] };
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    package: { findMany: async () => [{ suspendAfterDays: 90 }] },
    line: {
      count: async ({ where }: { where: unknown }) => { seen.line.push(where); return 0; },
      findMany: async ({ where }: { where: unknown }) => { seen.line.push(where); return []; },
      groupBy: async ({ where }: { where: unknown }) => { seen.line.push(where); return []; },
    },
    walletEntry: { findMany: async ({ where }: { where: unknown }) => { seen.entry.push(where); return []; } },
    wallet: { findMany: async () => [], findUnique: async () => null },
    task: { count: async () => 0, findFirst: async () => null, groupBy: async () => [] },
    lineCountSnapshot: { findFirst: async () => null },
    // The company marks the numbers list reads by URL (speed plan PF.7): none.
    $queryRaw: async () => [],
  } as unknown as ServiceGraph['prismaClient'];
  const wallets = new WalletsService(kernel.uow, kernel.tree, kernel.ledger, kernel.ladder, new WalletsRepository(kernel.uow));
  const repo = new DeskRepository(kernel.uow);
  return {
    seen,
    lines: new LineReads(kernel.tree, new LinesRepository(kernel.uow)),
    desk: new DeskService(kernel.tree, repo),
    overview: new OverviewService(kernel.tree, wallets, {} as never, {} as never, {} as never, repo),
  };
}

/** Every id list a `where` carries on `field`, wherever it sits in the tree. */
function idLists(where: unknown, field: string): string[][] {
  if (!where || typeof where !== 'object') return [];
  if (Array.isArray(where)) return where.flatMap((item) => idLists(item, field));
  return Object.entries(where as Record<string, unknown>).flatMap(([key, value]) => {
    const list = key === field && value && typeof value === 'object' && Array.isArray((value as { in?: unknown }).in) ? [[...(value as { in: string[] }).in].sort()] : [];
    return [...list, ...idLists(value, field)];
  });
}

async function readAll(layer: string, id: string) {
  const { seen, lines, desk, overview } = setup();
  const who = actor(id, layer);
  await lines.list(who, {});
  await desk.home(who);
  await overview.overview(who, { period: 'month' });
  return seen;
}

describe('the branch sends no point-of-sale id list (database plan DB.10)', () => {
  it('the branch: no posId on any line read, no userId on the latest operations', async () => {
    const seen = await readAll('branch', 'branch');
    expect(seen.line.length).toBeGreaterThanOrEqual(8);
    expect(seen.line.flatMap((where) => idLists(where, 'posId'))).toEqual([]);
    // The desk's latest operations: the one wallet-entry read keyed by point of sale.
    const latest = seen.entry.filter((where) => JSON.stringify(where).includes('"activate"') && !JSON.stringify(where).includes('"amount"'));
    expect(latest).toHaveLength(1);
    expect(idLists(latest[0], 'userId')).toEqual([]);
  });

  it('the branch narrowed to one account still sends that account\'s points of sale', async () => {
    const { seen, lines } = setup();
    await lines.list(actor('branch', 'branch'), { loginName: 'agent1' });
    expect(seen.line.flatMap((where) => idLists(where, 'posId'))).toEqual([['pos1', 'pos2'], ['pos1', 'pos2']]);
  });

  it.each([
    ['main_agent', 'main1', ['pos1', 'pos2']],
    ['agent', 'agent1', ['pos1', 'pos2']],
    ['pos', 'pos2', ['pos2']],
    ['main_agent', 'main2', ['pos3']],
  ])('a %s (%s) sends exactly its visible points of sale on every line read', async (layer, id, expected) => {
    const seen = await readAll(layer, id);
    const lists = seen.line.map((where) => idLists(where, 'posId'));
    expect(lists.every((found) => found.length === 1)).toBe(true);
    expect([...new Set(lists.map((found) => JSON.stringify(found[0])))]).toEqual([JSON.stringify(expected)]);
    const latest = seen.entry.filter((where) => JSON.stringify(where).includes('"activate"') && !JSON.stringify(where).includes('"amount"'));
    expect(latest.map((where) => idLists(where, 'userId'))).toEqual([[expected]]);
  });
});
