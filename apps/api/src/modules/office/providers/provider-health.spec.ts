import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeKernel } from '../kernel/office-kernel';
import { PROVIDER_FAILED_NOTE } from '../stored-text';
import { FAILURE_THRESHOLD, healthOf } from './provider-health';
import { ProviderHealthService } from './provider-health.service';

// Provider health and alerts (spec 2026-11-08-overview-and-reports-nav, G).
describe('provider health', () => {
  it('is a problem after three failures in the hour, or under the owner\'s floor; working otherwise', () => {
    expect(FAILURE_THRESHOLD).toBe(3);
    expect(healthOf({ available: 5000, alertFloor: 0, recentFailures: 3 })).toEqual({ status: 'problem', reason: 'failures' });
    expect(healthOf({ available: -1, alertFloor: 0, recentFailures: 0 })).toEqual({ status: 'problem', reason: 'balance' });
    expect(healthOf({ available: 9000, alertFloor: 10000, recentFailures: 2 })).toEqual({ status: 'problem', reason: 'balance' });
    expect(healthOf({ available: 0, alertFloor: 0, recentFailures: 2 })).toEqual({ status: 'working', reason: null });
  });

  function setup(stored: Record<string, string>, failures: number, available: Record<string, number>) {
    const kernel = new OfficeKernel(new MemoryAuthStore());
    const notices: { userIds: string[]; kind: string; payload: unknown }[] = [];
    const providers = [
      { code: 'sky', alertFloor: 0, packages: [{ id: 'p1' }] },
      { code: 'lian', alertFloor: 1000, packages: [{ id: 'p2' }] },
    ];
    kernel.prismaClient = {
      provider: {
        findMany: async () => providers,
        updateMany: async ({ where, data }: { where: { code: string; health: string }; data: { health: string } }) => {
          if (stored[where.code] !== where.health) return { count: 0 };
          stored[where.code] = data.health;
          return { count: 1 };
        },
      },
      officeTask: {
        findMany: async ({ where }: { where: { note: string } }) => (where.note === PROVIDER_FAILED_NOTE ? Array.from({ length: failures }, () => ({ packageId: 'p1' })) : []),
      },
      user: {
        findMany: async () => [
          { id: 'owner', isBranchOwner: true, liveGrants: '' },
          { id: 'editor', isBranchOwner: false, liveGrants: 'edit,reports' },
          { id: 'clerk', isBranchOwner: false, liveGrants: 'reports' },
        ],
      },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
    } as unknown as OfficeKernel['prismaClient'];
    (kernel.uow as unknown as { notice: unknown }).notice = {
      write: async (_tx: unknown, userIds: string[], _actor: unknown, draft: { kind: string; payload: unknown }) => {
        notices.push({ userIds, ...draft });
        return [];
      },
      publish: async () => undefined,
    };
    const accounts = { summaries: async () => [{ code: 'sky', name: 'سكاي', available: available.sky }, { code: 'lian', name: 'ليان', available: available.lian }] };
    return { service: new ProviderHealthService(kernel.uow, accounts as never), notices };
  }

  it('writes one notice to the owner and the editors when a provider turns to a problem, and none while it stays', async () => {
    const stored = { sky: 'working', lian: 'working' };
    const { service, notices } = setup(stored, 3, { sky: 50000, lian: 5000 });
    const changed = await service.check();
    expect(changed.map((row) => [row.code, row.status, row.reason])).toEqual([['sky', 'problem', 'failures']]);
    expect(notices).toEqual([{ userIds: ['owner', 'editor'], kind: 'provider.problem', payload: { code: 'sky', name: 'سكاي', reason: 'failures', failures: 3, available: 50000, alertFloor: 0 } }]);
    expect(await service.check()).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it('says when a provider recovers, and uses the owner\'s floor for the balance', async () => {
    const stored = { sky: 'problem', lian: 'working' };
    const { service, notices } = setup(stored, 0, { sky: 50000, lian: 500 });
    const changed = await service.check();
    expect(changed.map((row) => [row.code, row.status])).toEqual([['sky', 'working'], ['lian', 'problem']]);
    expect(notices.map((row) => row.kind)).toEqual(['provider.recovered', 'provider.problem']);
  });
});

describe('overdue matching notice', () => {
  function setup(rows: { code: string; name: string; matchSource: string; matchEveryDays: number; lastMatchedAt: Date | null; matchOverdueNoticeAt: Date | null }[]) {
    const kernel = new OfficeKernel(new MemoryAuthStore());
    const notices: { kind: string; payload: unknown }[] = [];
    kernel.prismaClient = {
      provider: {
        findMany: async () => rows.map((row) => ({ ...row })),
        updateMany: async ({ where, data }: { where: { code: string; matchOverdueNoticeAt?: null }; data: { matchOverdueNoticeAt: Date | null } }) => {
          const row = rows.find((item) => item.code === where.code)!;
          if ('matchOverdueNoticeAt' in where && row.matchOverdueNoticeAt !== null) return { count: 0 };
          row.matchOverdueNoticeAt = data.matchOverdueNoticeAt;
          return { count: 1 };
        },
      },
      user: { findMany: async () => [{ id: 'owner', isBranchOwner: true, liveGrants: '' }] },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
    } as unknown as OfficeKernel['prismaClient'];
    (kernel.uow as unknown as { notice: unknown }).notice = {
      write: async (_tx: unknown, _ids: string[], _actor: unknown, draft: { kind: string; payload: unknown }) => { notices.push(draft); return []; },
      publish: async () => undefined,
    };
    return { service: new ProviderHealthService(kernel.uow, {} as never), notices, rows };
  }

  it('sends «مطابقة متأخرة» once per lapse for a statement provider, never for an API one, and again after a new lapse', async () => {
    const now = new Date('2026-11-20T00:00:00.000Z');
    const { service, notices, rows } = setup([
      { code: 'aren', name: 'عرين', matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: null, matchOverdueNoticeAt: null },
      { code: 'sky', name: 'سكاي', matchSource: 'api', matchEveryDays: 7, lastMatchedAt: null, matchOverdueNoticeAt: null },
      { code: 'lian', name: 'ليان', matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: new Date('2026-11-18T00:00:00.000Z'), matchOverdueNoticeAt: null },
    ]);
    expect(await service.checkMatching(now)).toEqual(['aren']);
    expect(notices).toEqual([{ kind: 'provider.match_overdue', payload: { code: 'aren', name: 'عرين', matchEveryDays: 7, lastMatchedAt: null } }]);
    expect(await service.checkMatching(now)).toEqual([]);
    // Matched again: the notice clears, and the next lapse sends a new one.
    rows[0].lastMatchedAt = new Date('2026-11-19T00:00:00.000Z');
    expect(await service.checkMatching(now)).toEqual([]);
    expect(rows[0].matchOverdueNoticeAt).toBeNull();
    expect(await service.checkMatching(new Date('2026-12-01T00:00:00.000Z'))).toEqual(['aren', 'lian']);
  });
});
