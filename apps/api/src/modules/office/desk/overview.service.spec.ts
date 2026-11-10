import { DeskRepository } from './desk.repository';
import { WalletsRepository } from '../wallets/wallets.repository';
import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { WalletsService } from '../wallets/wallets.service';
import { OverviewService, periodStart } from './overview.service';

// The home overview (spec 2026-11-08-overview-and-reports-nav, F): one viewer's lines, sales, rankings, users, tasks.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
  { id: 'pos2', loginName: 'pos2', nickname: 'p2', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: new Date() },
];
const ladder = (pos: string) => ({ kind: 'subscription', chain: [pos, 'agent', 'main', 'branch'], costs: { [pos]: 3800, agent: 3500, main: 3000, branch: 2500 }, posSell: 4500 });
const at = new Date('2026-11-09T08:00:00.000Z');
const entries = [
  { id: 's1', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, amount: -3800, ladder: ladder('pos'), createdAt: at, packageName: '400 جيجا', companyName: 'سلكوم', providerCost: 2500 },
  { id: 's2', userId: 'pos', kind: 'charge', lineId: 'l1', packagePrice: 3800, amount: -3800, ladder: ladder('pos'), createdAt: at, packageName: '400 جيجا', companyName: 'سلكوم', providerCost: 2500 },
  { id: 's3', userId: 'pos2', kind: 'activate', lineId: 'l2', packagePrice: 3800, amount: -3800, ladder: ladder('pos2'), createdAt: at, packageName: '100 جيجا', companyName: 'وي', providerCost: 2500 },
  { id: 'r1', userId: 'pos', kind: 'disconnect', lineId: 'l1', packagePrice: 3800, amount: 1900, ladder: { ...ladder('pos'), share: -0.5 }, createdAt: at, packageName: '400 جيجا', companyName: 'سلكوم', providerCost: 0 },
];

function service(snapshots: { userId: string; day: string; active: number; expiring: number; frozen: number; disconnected: number; suspended: number }[] = []) {
  const kernel = new OfficeGraph(new MemoryAuthStore());
  const lineCounts: Record<string, number> = { active: 10, frozen: 2, disconnected: 3 };
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    package: { findMany: async () => [{ suspendAfterDays: 90 }] },
    line: {
      count: async ({ where }: { where: { status?: string; AND?: unknown[] } }) => (where.status ? lineCounts[where.status] : JSON.stringify(where).includes('suspendAfterDays') ? 1 : 2),
      findMany: async () => [
        { id: 'l1', package: { provider: { code: 'sky', name: 'سكاي' } } },
        { id: 'l2', package: { provider: { code: 'lian', name: 'ليان' } } },
      ],
    },
    walletEntry: { findMany: async () => entries },
    lineCountSnapshot: {
      upsert: async ({ create }: { create: (typeof snapshots)[number] }) => {
        const index = snapshots.findIndex((row) => row.userId === create.userId && row.day === create.day);
        if (index >= 0) snapshots[index] = create;
        else snapshots.push(create);
      },
      findFirst: async ({ where }: { where: { userId: string; day: { lt: string } } }) =>
        snapshots.filter((row) => row.userId === where.userId && row.day < where.day.lt).sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null,
    },
    wallet: { findMany: async () => [{ userId: 'pos', balance: -2000, ceiling: 5000 }, { userId: 'pos2', balance: 700, ceiling: 1000 }, { userId: 'agent', balance: -500, ceiling: 300 }] },
    officeTask: {
      count: async ({ where }: { where: { AND: { status?: string }[] } }) => (where.AND[1]?.status === 'pending' ? 4 : 1),
      findFirst: async () => ({ createdAt: new Date(Date.now() - 90 * 60_000) }),
    },
  } as unknown as OfficeGraph['prismaClient'];
  const wallets = new WalletsService(kernel.uow, kernel.tree, kernel.ledger, kernel.ladder, new WalletsRepository(kernel.uow));
  return new OverviewService(kernel.tree, wallets, {} as never, {} as never, {} as never, new DeskRepository(kernel.uow));
}

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: false, grants: [], operatorId: id, impersonating: false });

describe('OverviewService', () => {
  it('starts today and this month at their first UTC instant, and all time with nothing', () => {
    const now = new Date('2026-11-09T15:30:00.000Z');
    expect(periodStart('day', now)?.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(periodStart('month', now)?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });

  it('splits the lines into the donut slices without counting an expiring or suspended line twice', async () => {
    const result = await service().overview(actor('agent', 'agent'), { period: 'all' });
    expect(result.period).toBe('all');
    expect(result.lines).toEqual({ active: 7, expiring: 2, frozen: 2, disconnected: 3, suspended: 1 });
  });

  it('counts each slice\'s change against the last snapshot before the period, and writes nothing itself', async () => {
    const snapshots = [
      { userId: 'agent', day: '2000-01-01', active: 1, expiring: 0, frozen: 0, disconnected: 0, suspended: 0 },
      { userId: 'agent', day: '2000-01-02', active: 4, expiring: 2, frozen: 3, disconnected: 3, suspended: 1 },
    ];
    const day = await service(snapshots).overview(actor('agent', 'agent'), { period: 'day' });
    // Now: active 7, expiring 2, frozen 2, disconnected 3, suspended 1 — against the latest day before today.
    expect(day.lineChange).toEqual({ active: 3, expiring: 0, frozen: -1, disconnected: 0, suspended: 0 });
    // Reading the home is a read: the day's snapshot is the timer's to write (plan backend-loose-ends A.3).
    expect(snapshots).toHaveLength(2);
    // All time compares with nothing: the change is the count itself.
    expect((await service(snapshots).overview(actor('agent', 'agent'), { period: 'all' })).lineChange).toEqual({ active: 7, expiring: 2, frozen: 2, disconnected: 3, suspended: 1 });
  });

  it('has no change to show before the first snapshot of an earlier day', async () => {
    expect((await service().overview(actor('agent', 'agent'), { period: 'month' })).lineChange).toBeNull();
  });

  it('sums the sales with the viewer\'s profit, takes refunds back, and ranks packages and companies', async () => {
    const result = await service().overview(actor('agent', 'agent'), {});
    expect(result.period).toBe('month');
    expect(result.sales).toMatchObject({ count: 3, amount: 11400, refunds: 1, refundAmount: 1900, net: 9500, profit: 3 * 300 - 150 });
    expect(result.sales.trend).toEqual([{ day: '2026-11-09', amount: 11400, profit: 750, count: 3 }]);
    expect(result.top.packages.map((row) => [row.label, row.count])).toEqual([['400 جيجا', 2], ['100 جيجا', 1]]);
    expect(result.top.providers).toEqual([]);
  });

  it('ranks the most active accounts per layer below the viewer only', async () => {
    const agent = await service().overview(actor('agent', 'agent'), {});
    expect(agent.active.main_agent).toEqual([]);
    expect(agent.active.agent).toEqual([]);
    expect(agent.active.pos.map((row) => [row.label, row.count])).toEqual([['pos', 2], ['pos2', 1]]);
    const main = await service().overview(actor('main', 'main_agent'), {});
    expect(main.active.agent.map((row) => [row.label, row.count, row.profit])).toEqual([['agent', 3, 900]]);
  });

  it('counts the accounts below, what they owe, the ceilings, and the tasks', async () => {
    const result = await service().overview(actor('main', 'main_agent'), {});
    expect(result.users).toEqual({ counts: { main_agent: 0, agent: 1, pos: 2 }, frozen: 1, debtors: 2, debt: 2500, ceilings: 6300, used: 2300 });
    expect(result.tasks).toMatchObject({ pending: 4, working: 1, done: 1, oldestOpenMinutes: 90 });
    expect(result.providers).toBeNull();
  });

  it('gives the period cards: sales and volume, activations, profit, a daily trend while the history is short, and nothing to compare over all time', async () => {
    const result = await service().overview(actor('agent', 'agent'), { period: 'all' });
    expect(result.pulse.current).toMatchObject({ count: 3, amount: 11400, activations: 2 });
    expect(result.pulse.previous).toBeNull();
    expect(result.pulse.trend.find((point) => point.at.startsWith('2026-11') && point.count > 0)).toMatchObject({ count: 3, activations: 2 });
  });

  it('compares today with the same span of yesterday', async () => {
    const result = await service().overview(actor('agent', 'agent'), { period: 'day' });
    expect(result.pulse.previous).not.toBeNull();
    expect(result.pulse.trend.length).toBe(new Date().getUTCHours() + 1);
  });
});
