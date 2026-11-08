import { OfficeKernel } from '../kernel/office-kernel';
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

function service() {
  const kernel = Object.create(OfficeKernel.prototype) as OfficeKernel;
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
    wallet: { findMany: async () => [{ userId: 'pos', balance: -2000, ceiling: 5000 }, { userId: 'pos2', balance: 700, ceiling: 1000 }, { userId: 'agent', balance: -500, ceiling: 300 }] },
    officeTask: {
      count: async ({ where }: { where: { AND: { status?: string }[] } }) => (where.AND[1]?.status === 'pending' ? 4 : 1),
      findFirst: async () => ({ createdAt: new Date(Date.now() - 90 * 60_000) }),
    },
  } as unknown as OfficeKernel['prismaClient'];
  const wallets = new WalletsService(kernel);
  return new OverviewService(kernel, wallets, {} as never, {} as never, {} as never);
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
});
