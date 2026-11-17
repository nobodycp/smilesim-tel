import { DeskRepository } from './desk.repository';
import { ServiceGraph } from '../../testing/service-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../../access/types';
import { OverviewService, periodStart } from './overview.service';

// The home overview (spec 2026-11-08-overview-and-reports-nav, F): one viewer's lines, sales, rankings, users, tasks.
// The money cards are SQL sums of the stored margins (ADR 0026): they run on PostgreSQL in overview-money.db.spec.ts;
// here the database answers no sale.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
  { id: 'pos2', loginName: 'pos2', nickname: 'p2', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: new Date() },
];
function service(snapshots: { userId: string; day: string; active: number; expiring: number; frozen: number; disconnected: number; suspended: number }[] = [], providers: { accounts: unknown; insights: unknown; health: unknown } = { accounts: {}, insights: {}, health: {} }) {
  const kernel = new ServiceGraph(new MemoryAuthStore());
  const lineCounts: Record<string, number> = { active: 10, frozen: 2, disconnected: 3 };
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    package: { findMany: async () => [{ suspendAfterDays: 90 }] },
    line: {
      count: async ({ where }: { where: { status?: string; AND?: unknown[] } }) => (where.status ? lineCounts[where.status] : JSON.stringify(where).includes('suspendAfterDays') ? 1 : 2),
      groupBy: async () => Object.entries(lineCounts).map(([status, count]) => ({ status, _count: { _all: count } })),
    },
    // The overview ranks providers by the provider each entry stored (ADR 0025), named from here.
    provider: { findMany: async () => [{ id: 'p-sky', code: 'sky', name: 'سكاي' }, { id: 'p-lian', code: 'lian', name: 'ليان' }] },
    $queryRaw: async () => [],
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
    task: {
      count: async ({ where }: { where: { AND: { status?: string }[] } }) => (where.AND[1]?.status === 'working' ? 4 : 1),
      groupBy: async () => ['working', 'done', 'rejected', 'cancelled'].map((status) => ({ status, _count: { _all: status === 'working' ? 4 : 1 } })),
      findFirst: async () => ({ createdAt: new Date(Date.now() - 90 * 60_000) }),
    },
  } as unknown as ServiceGraph['prismaClient'];
  return new OverviewService(kernel.tree, providers.insights as never, providers.accounts as never, providers.health as never, new DeskRepository(kernel.uow));
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

  it('counts the accounts below, what they owe, the ceilings, and the tasks', async () => {
    const result = await service().overview(actor('main', 'main_agent'), {});
    expect(result.users).toEqual({ counts: { main_agent: 0, agent: 1, pos: 2 }, frozen: 1, debtors: 2, debt: 2500, ceilings: 6300, used: 2300 });
    expect(result.tasks).toMatchObject({ working: 4, done: 1, oldestOpenMinutes: 90 });
    expect(result.providers).toBeNull();
  });

  it('reads the provider books once: the health is worked out from the summaries the balances show (database plan DB.4)', async () => {
    const rows = [{ code: 'sky', name: 'سكاي', balance: -100, creditLimit: 0, available: -100 }];
    const calls = { list: 0, health: [] as unknown[] };
    const providers = {
      accounts: { list: async () => { calls.list += 1; return { rows }; } },
      insights: { supply: async () => ({ rows: [{ providerCode: 'sky', operations: 2, cost: 5000, profit: 700 }] }) },
      health: {
        current: async (_now: Date, summaries?: unknown) => {
          calls.health.push(summaries);
          return [{ code: 'sky', name: 'سكاي', failures: 0, available: -100, alertFloor: 0, status: 'problem', reason: 'balance' }];
        },
      },
    };
    const branch = { ...actor('branch', 'branch'), isBranchOwner: true, grants: ['reports'] };
    const result = await service([], providers).overview(branch, {});
    expect(calls.list).toBe(1);
    expect(calls.health).toEqual([rows]);
    expect(result.providers).toEqual([{ code: 'sky', name: 'سكاي', operations: 2, cost: 5000, profit: 700, balance: -100, creditLimit: 0, available: -100, status: 'problem', problem: 'balance', failures: 0, alertFloor: 0 }]);
  });

  it('compares today with the same span of yesterday', async () => {
    const result = await service().overview(actor('agent', 'agent'), { period: 'day' });
    expect(result.pulse.previous).not.toBeNull();
    expect(result.pulse.trend.length).toBe(new Date().getUTCHours() + 1);
  });
});
