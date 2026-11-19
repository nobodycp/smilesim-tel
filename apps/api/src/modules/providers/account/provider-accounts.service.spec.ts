import { ProvidersRepository } from '../providers.repository';
import type { Actor } from '../../access/types';
import type { WalletsService } from '../../wallets/wallets.service';
import { ProviderAccountsService } from './provider-accounts.service';

// Our account with a provider (roadmap N7): payments and settlements minus purchases, the credit limit, what open
// tasks are about to cost, and a ledger with the running balance.
const owner: Actor = { id: 'branch', loginName: 'branch', nickname: 'فرع', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'branch', impersonating: false };
const staff = (grants: string[]): Actor => ({ ...owner, id: 'clerk', loginName: 'clerk', isBranchOwner: false, grants, operatorId: 'clerk' });

type Window = { gte?: Date; lte?: Date } | undefined;
const within = (at: Date, window: Window) => (!window?.gte || at >= window.gte) && (!window?.lte || at <= window.lte);

function service() {
  const created: unknown[] = [];
  const entries = [
    { id: 'x2', providerId: 'p1', kind: 'settlement', amount: -500, note: 'فرق', actorLoginName: 'branch', createdAt: new Date('2026-11-05T00:00:00Z') },
    { id: 'x1', providerId: 'p1', kind: 'payment', amount: 20000, note: 'دفعة', actorLoginName: 'branch', createdAt: new Date('2026-11-02T00:00:00Z') },
  ];
  // What the operations' entries stored (ADR 0025): the provider and the cost.
  const operations = [
    { id: 'o2', at: new Date('2026-11-04T00:00:00Z'), kind: 'charge', msisdn: '055', packageName: '400', providerId: 'p1', cost: 3000 },
    { id: 'o1', at: new Date('2026-11-01T00:00:00Z'), kind: 'activate', msisdn: '055', packageName: '400', providerId: 'p1', cost: 3500 },
    { id: 'o3', at: new Date('2026-11-03T00:00:00Z'), kind: 'activate', msisdn: '056', packageName: '150', providerId: 'p2', cost: 2000 },
  ];
  const updated: unknown[] = [];
  const kernel = {
    prisma: {
      provider: {
        findMany: async () => [{ id: 'p1', code: 'sky', name: 'سكاي', creditLimit: 50000 }, { id: 'p2', code: 'lian', name: 'ليان', creditLimit: 0 }],
        findUnique: async ({ where }: { where: { code: string } }) => (where.code === 'sky' ? { id: 'p1', code: 'sky' } : null),
        update: async (args: unknown) => void updated.push(args),
      },
      providerEntry: {
        findMany: async ({ where, take }: { where: { providerId: string; createdAt?: Window }; take: number }) =>
          entries.filter((row) => row.providerId === where.providerId && within(row.createdAt, where.createdAt)).slice(0, take),
        aggregate: async ({ where }: { where: { providerId: string; createdAt?: Window } }) => ({
          _sum: { amount: entries.filter((row) => row.providerId === where.providerId && within(row.createdAt, where.createdAt)).reduce((sum, row) => sum + row.amount, 0) },
        }),
        // The list reads sums, never the rows.
        groupBy: async () => [
          { providerId: 'p1', kind: 'settlement', _sum: { amount: -500 } },
          { providerId: 'p1', kind: 'payment', _sum: { amount: 20000 } },
        ],
        create: async (args: unknown) => void created.push(args),
      },
      task: { findMany: async () => [{ action: 'activate', packageId: 'k1' }, { action: 'sim', packageId: 'k1' }] },
      postpaidPackage: { findMany: async () => [{ id: 'k1', branchCost: 3500, renewalBranchCost: 3000, provider: { code: 'sky' } }] },
    },
  } as never;
  const wallets = {
    // Two of sky's operations were paid at the provider and not charged to the point of sale (DB.5 P.7).
    providerLosses: async () => new Map([['p1', 2]]),
    providerPurchases: async () => new Map(['p1', 'p2'].map((id) => [id, operations.filter((row) => row.providerId === id).reduce((sum, row) => sum + row.cost, 0)])),
    providerCostUpTo: async (providerId: string, to: Date | null) => operations.filter((row) => row.providerId === providerId && within(row.at, to ? { lte: to } : undefined)).reduce((sum, row) => sum + row.cost, 0),
    providerOperations: async (filter: { providerId?: string; from?: Date | null; to?: Date | null; priced?: boolean; take?: number }) =>
      operations
        .filter((row) => (!filter.providerId || row.providerId === filter.providerId) && (!filter.priced || row.cost !== 0) && within(row.at, { gte: filter.from ?? undefined, lte: filter.to ?? undefined }))
        .slice(0, filter.take),
  } as unknown as WalletsService;
  return { accounts: new ProviderAccountsService(kernel, wallets, new ProvidersRepository(kernel)), created, updated };
}

describe('ProviderAccountsService', () => {
  it('sums each provider: payments + settlements − purchases, credit, held for open tasks, available', async () => {
    const { rows, totals } = await service().accounts.list(owner);
    expect(rows[0]).toEqual({ code: 'sky', name: 'سكاي', purchases: 6500, payments: 20000, settlements: -500, balance: 13000, creditLimit: 50000, alertFloor: 0, held: 3500, available: 59500, matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: null, matchOverdue: true, openDifferences: 0, losses: 2 });
    expect(rows[1]).toMatchObject({ code: 'lian', balance: -2000, available: -2000, losses: 0 });
    expect(totals).toEqual({ balance: 11000, held: 3500, owed: 2000 });
  });

  it('lists the ledger newest first with the balance after each row, and filters by dates', async () => {
    const { ledger, summary } = await service().accounts.detail(owner, 'sky');
    expect(ledger.map((row) => [row.id, row.amount, row.balanceAfter])).toEqual([
      ['x2', -500, 13000], ['o2', -3000, 13500], ['x1', 20000, 16500], ['o1', -3500, -3500],
    ]);
    expect(summary.balance).toBe(13000);
    const ranged = await service().accounts.detail(owner, 'sky', { from: '2026-11-02', to: '2026-11-04' });
    expect(ranged.ledger.map((row) => row.id)).toEqual(['o2', 'x1']);
  });

  it('records a payment or a settlement with a note, and the credit limit, for the owner or the accountant', async () => {
    const { accounts, created, updated } = service();
    await accounts.addEntry(staff(['accounting']), 'sky', { kind: 'payment', amount: 10000, note: 'دفعة ٢' });
    await accounts.addEntry(owner, 'sky', { kind: 'settlement', amount: -300, note: 'تسوية' });
    await accounts.setCredit(owner, 'sky', { creditLimit: 80000 });
    await accounts.setCredit(owner, 'sky', { creditLimit: 80000, alertFloor: 10000 });
    expect(created).toEqual([
      { data: { providerId: 'p1', kind: 'payment', amount: 10000, note: 'دفعة ٢', actorLoginName: 'clerk' } },
      { data: { providerId: 'p1', kind: 'settlement', amount: -300, note: 'تسوية', actorLoginName: 'branch' } },
    ]);
    expect(updated).toEqual([
      { where: { code: 'sky' }, data: { creditLimit: 80000 } },
      // The owner's alert floor (spec 2026-11-08-overview-and-reports-nav, G) rides on the same request.
      { where: { code: 'sky' }, data: { creditLimit: 80000, alertFloor: 10000 } },
    ]);
  });

  it('refuses a negative payment, a missing note, an unknown provider, and staff without the grant', async () => {
    const { accounts } = service();
    await expect(accounts.addEntry(owner, 'sky', { kind: 'payment', amount: -10, note: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(accounts.addEntry(owner, 'sky', { kind: 'payment', amount: 10, note: ' ' })).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    await expect(accounts.addEntry(owner, 'nope', { kind: 'payment', amount: 10, note: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(accounts.addEntry(staff(['reports']), 'sky', { kind: 'payment', amount: 10, note: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(accounts.list(staff([]))).rejects.toMatchObject({ status: 403 });
    await expect(accounts.list(staff(['reports']))).resolves.toBeDefined();
  });
});
