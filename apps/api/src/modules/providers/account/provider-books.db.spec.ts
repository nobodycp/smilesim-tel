import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { ServiceGraph } from '../../testing/service-graph';
import { WalletsRepository } from '../../wallets/wallets.repository';
import { WalletsService } from '../../wallets/wallets.service';
import { InsightsService } from '../../reporting/reports/insights.service';
import { ReportsRepository } from '../../reporting/reports/reports.repository';
import { ProvidersRepository } from '../providers.repository';
import { ProviderHealthService } from '../directory/provider-health.service';
import { ProviderAccountsService } from './provider-accounts.service';

// PostgreSQL only (TEST_DATABASE_URL). The provider books are sums of what each operation's entry stored (ADR 0025,
// slice P.4). Totals are pinned on a seeded set, stored as the backfill of release 1 left it (a cost kept on the
// entry, one the old reads took from the line's saved terms, one from the package's price, one with no line,
// operations that cost nothing, an entry that is not an operation, payments, a settlement, open and closed tasks):
// the same answers the read-time fallback gave before. Each windowed read is compared with every operation read
// and filtered in Node (the oracle).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the provider books (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: randomUUID(), pos: randomUUID(), providerA: randomUUID(), providerB: randomUUID(), company: randomUUID(),
    pkgA: randomUUID(), pkgB: randomUUID(), lineA: randomUUID(), lineB: randomUUID(),
  };
  const codeA = `bk-${tag}-a`;
  const codeB = `bk-${tag}-b`;
  const owner: Actor = { id: ids.owner, loginName: `bk-${tag}-owner`, nickname: 'owner', layer: 'branch', isBranchOwner: true, grants: [], operatorId: ids.owner, impersonating: false };
  let prisma: PrismaClient;
  let wallets: WalletsService;
  let accounts: ProviderAccountsService;
  /** The same service over every operation ever, filtered in Node: whatever provider and window the caller asked for. */
  let oracle: ProviderAccountsService;
  let health: ProviderHealthService;
  let insights: InsightsService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    const repo = new ProvidersRepository(graph.uow);
    wallets = new WalletsService(graph.uow, graph.tree, graph.ledger, graph.ladder, new WalletsRepository(graph.uow));
    accounts = new ProviderAccountsService(graph.uow, wallets, repo);
    const unwindowed = {
      providerOperations: async (filter: { providerId?: string; kind?: string; msisdn?: string } = {}) =>
        (await wallets.providerOperations({ kind: filter.kind, msisdn: filter.msisdn })).filter((row) => !filter.providerId || row.providerId === filter.providerId),
    };
    oracle = new ProviderAccountsService(graph.uow, unwindowed as unknown as WalletsService, repo);
    health = new ProviderHealthService(graph.uow, accounts, repo);
    insights = new InsightsService(graph.tree, wallets, new ReportsRepository(graph.uow));

    const user = (id: string, layer: string, parentId: string | null) => ({ id, loginName: `bk-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    await prisma.user.create({ data: user(ids.owner, 'branch', null) });
    await prisma.user.create({ data: user(ids.pos, 'pos', ids.owner) });
    await prisma.provider.create({ data: { id: ids.providerA, code: codeA, name: `bk-${tag}-A`, creditLimit: 50_000 } });
    await prisma.provider.create({ data: { id: ids.providerB, code: codeB, name: `bk-${tag}-B` } });
    await prisma.company.create({ data: { id: ids.company, code: `bk-${tag}`, name: `bk-${tag}-co` } });
    const flags = { autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
    const prices = (branchCost: number, renewalBranchCost: number) => ({
      branchCost, mainPrice: branchCost + 500, agentPrice: branchCost + 1000, posPrice: branchCost + 1500, subscriberPrice: branchCost + 2000,
      renewalBranchCost, renewalMainPrice: renewalBranchCost + 500, renewalAgentPrice: renewalBranchCost + 1000, renewalPosPrice: renewalBranchCost + 1500, renewalSubscriberPrice: renewalBranchCost + 2000,
    });
    await prisma.package.create({ data: { id: ids.pkgA, code: `bk-${tag}-a1`, name: `bk-${tag}-A1`, providerId: ids.providerA, companyId: ids.company, ...prices(2000, 1800), ...flags } });
    await prisma.package.create({ data: { id: ids.pkgB, code: `bk-${tag}-b1`, name: `bk-${tag}-B1`, providerId: ids.providerB, companyId: ids.company, ...prices(3000, 2500), ...flags } });
    const msisdn = (n: number) => `05${tag.replace(/\D/g, '0').slice(0, 6)}${n}`.slice(0, 12);
    await prisma.line.create({ data: { id: ids.lineA, msisdn: msisdn(1), status: 'active', endsAt: new Date('2027-01-01T00:00:00Z'), packageId: ids.pkgA, posId: ids.pos, terms: { subscription: { branchCost: 2100 }, renewal: { branchCost: 1700 } } } });
    await prisma.line.create({ data: { id: ids.lineB, msisdn: msisdn(2), status: 'disconnected', endsAt: new Date('2027-01-01T00:00:00Z'), packageId: ids.pkgB, posId: ids.pos, terms: {} } });
    const entry = (id: string, kind: string, lineId: string | null, pkg: string, providerId: string | null, providerCost: number | null, at: string, number: string) => ({
      id: `${tag}-${id}`, userId: ids.pos, actorId: ids.owner, amount: 0, balanceAfter: 0, kind, lineId, msisdn: number,
      packageName: pkg, companyName: `bk-${tag}-co`, providerId, providerCost, createdAt: new Date(at),
    });
    // The comments name where the read-time fallback took each cost before the backfill stored it.
    await prisma.walletEntry.createMany({
      data: [
        entry('a1', 'activate', ids.lineA, `bk-${tag}-A1`, ids.providerA, 2100, '2026-10-05T10:00:00.000Z', msisdn(1)), // kept on the entry
        entry('a2', 'charge', ids.lineA, `bk-${tag}-A1`, ids.providerA, 1700, '2026-11-02T00:00:00.000Z', msisdn(1)), // the line's saved terms
        entry('a3', 'freeze', ids.lineA, `bk-${tag}-A1`, ids.providerA, 0, '2026-11-03T12:00:00.000Z', msisdn(1)), // costs nothing
        entry('a4', 'extend', ids.lineA, `bk-${tag}-A1`, ids.providerA, 1600, '2026-11-10T09:00:00.000Z', msisdn(1)),
        entry('b1', 'activate', ids.lineB, `bk-${tag}-B1`, ids.providerB, 3000, '2026-09-20T08:00:00.000Z', msisdn(2)), // a plain activation: the package's price (no saved terms)
        entry('b2', 'disconnect', ids.lineB, `bk-${tag}-B1`, ids.providerB, 0, '2026-11-04T23:59:59.999Z', msisdn(2)), // costs nothing
        entry('b3', 'charge', null, `bk-${tag}-B1`, ids.providerB, 2500, '2026-11-05T00:00:00.000Z', msisdn(2)), // no line: the package's renewal price
        entry('f1', 'fund', null, '', null, null, '2026-11-03T00:00:00.000Z', ''), // not an operation
      ],
    });
    await prisma.providerEntry.createMany({
      data: [
        { providerId: ids.providerA, kind: 'payment', amount: 10_000, note: 'p', actorLoginName: owner.loginName },
        { providerId: ids.providerA, kind: 'settlement', amount: -500, note: 's', actorLoginName: owner.loginName },
        { providerId: ids.providerB, kind: 'payment', amount: 2_000, note: 'p', actorLoginName: owner.loginName },
      ],
    });
    const task = (action: string, status: string, packageId: string) => ({ action, status, packageId, posId: ids.pos, submitterId: ids.pos, posDelta: 0 });
    await prisma.task.createMany({ data: [task('activate', 'working', ids.pkgA), task('charge', 'working', ids.pkgA), task('activate', 'done', ids.pkgB)] });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { posId: ids.pos } });
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.providerEntry.deleteMany({ where: { providerId: { in: [ids.providerA, ids.providerB] } } });
    await prisma.package.deleteMany({ where: { id: { in: [ids.pkgA, ids.pkgB] } } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.providerA, ids.providerB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.pos, ids.owner] } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const ours = <T extends { code: string }>(rows: T[]) => rows.filter((row) => row.code === codeA || row.code === codeB);
  const matching = { matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: null, matchOverdue: true, openDifferences: 0 };

  it('sums each provider as before: purchases, payments, settlements, balance, held and available', async () => {
    const { rows } = await accounts.list(owner);
    expect(ours(rows)).toEqual([
      { code: codeA, name: `bk-${tag}-A`, purchases: 2100 + 1700 + 1600, payments: 10_000, settlements: -500, balance: 4100, creditLimit: 50_000, alertFloor: 0, held: 2000 + 1800, available: 4100 + 50_000 - 3800, ...matching },
      { code: codeB, name: `bk-${tag}-B`, purchases: 3000 + 2500, payments: 2_000, settlements: 0, balance: -3500, creditLimit: 0, alertFloor: 0, held: 0, available: -3500, ...matching },
    ]);
    // The health watch's summaries are the list's rows but for the simulated match count (ADR 0025 rule 5), and the
    // health worked out from them names B's balance.
    expect(ours(await accounts.summaries())).toEqual(ours(rows).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'openDifferences'))));
    const view = await health.current(new Date(), rows);
    expect(ours(view).map((row) => [row.code, row.available, row.status, row.reason])).toEqual([[codeA, 50_300, 'working', null], [codeB, -3500, 'problem', 'balance']]);
    // One provider's page: the same summary, and its ledger with the running balance over all its history.
    const detail = await accounts.detail(owner, codeA);
    expect(detail.summary).toEqual(rows.find((row) => row.code === codeA));
    expect(detail.ledger.filter((row) => row.kind !== 'payment' && row.kind !== 'settlement').map((row) => [row.id, row.amount])).toEqual([
      [`${tag}-a4`, -1600], [`${tag}-a2`, -1700], [`${tag}-a1`, -2100],
    ]);
  });

  it('each provider\'s purchases are the SQL sum of the costs its entries stored (ADR 0025, the invariant)', async () => {
    for (const row of ours(await accounts.summaries())) {
      const providerId = row.code === codeA ? ids.providerA : ids.providerB;
      const [sum] = await prisma.$queryRaw<{ purchases: bigint }[]>`SELECT coalesce(sum("providerCost"), 0) AS purchases FROM "WalletEntry" WHERE "providerId" = ${providerId}`;
      expect(row.purchases).toBe(Number(sum.purchases));
    }
    // The health watch's summaries carry no simulated match count; the list and the detail screens do.
    expect(ours(await accounts.summaries()).map((row) => 'openDifferences' in row)).toEqual([false, false]);
  });

  it('pages a provider\'s ledger from the newest, each row with the balance after it over all history', async () => {
    const operationsOf = (ledger: { id: string; amount: number; balanceAfter: number }[]) => ledger.filter((row) => row.id.startsWith(tag)).map((row) => [row.id, row.amount, row.balanceAfter]);
    const whole = await accounts.detail(owner, codeA);
    // Oldest first: a1 −2100, a2 −1700, a4 −1600 (a3 costs nothing and is not a row), then today's payment and settlement.
    expect(whole.ledger[0].balanceAfter).toBe(4100);
    expect(operationsOf(whole.ledger)).toEqual([[`${tag}-a4`, -1600, -5400], [`${tag}-a2`, -1700, -3800], [`${tag}-a1`, -2100, -2100]]);
    expect(whole.capped).toBe(false);
    const ranged = await accounts.detail(owner, codeA, { from: '2026-11-02', to: '2026-11-04' });
    expect(ranged.ledger.map((row) => [row.id, row.amount, row.balanceAfter])).toEqual([[`${tag}-a2`, -1700, -3800]]);
    expect(ranged.summary).toEqual(whole.summary);
    expect((await accounts.detail(owner, codeA, { to: '2026-10-31' })).ledger.map((row) => [row.id, row.balanceAfter])).toEqual([[`${tag}-a1`, -2100]]);
  });

  it('reads a time window and a provider in the database with exactly the rows every operation filtered in Node gives', async () => {
    const from = new Date('2026-11-02T00:00:00.000Z');
    const to = new Date('2026-11-04T23:59:59.999Z');
    const every = await wallets.providerOperations();
    const windowed = await wallets.providerOperations({ from, to });
    expect(windowed).toEqual(every.filter((row) => row.at >= from && row.at <= to));
    expect(windowed.filter((row) => row.id.startsWith(tag)).map((row) => [row.id, row.providerId, row.cost])).toEqual([
      [`${tag}-b2`, ids.providerB, 0], [`${tag}-a3`, ids.providerA, 0], [`${tag}-a2`, ids.providerA, 1700],
    ]);
    expect(await wallets.providerOperations({ from })).toEqual(every.filter((row) => row.at >= from));
    expect(await wallets.providerOperations({ to })).toEqual(every.filter((row) => row.at <= to));
    expect(await wallets.providerOperations({ providerId: ids.providerB, priced: true })).toEqual(every.filter((row) => row.providerId === ids.providerB && row.cost !== 0));
  });

  it('the providers report counts the provider and the cost each operation stored (ADR 0025, owner\'s answer 5)', async () => {
    // Before slice P.4 this report took the provider from the line's current package, skipped an entry without a
    // line, and added `providerCost ?? 0`: on these rows as stored before release 1 it gave A 4 operations costing
    // 3700 (a2 stored no cost) and B 2 operations costing 0 (b1, a plain activation, stored none; b3 has no line).
    // One definition of cost now: the books' own figures.
    const report = await insights.supply(owner);
    expect(report.rows.filter((row) => row.providerCode === codeA || row.providerCode === codeB).map((row) => [row.providerCode, row.operations, row.cost])).toEqual([
      [codeA, 4, 2100 + 1700 + 0 + 1600], [codeB, 3, 3000 + 0 + 2500],
    ]);
  });

  it('answers the provider-operations report as before, whatever the window, provider, kind and number', async () => {
    const queries = [
      {},
      { provider: codeA },
      { from: '2026-11-02', to: '2026-11-04', provider: codeA },
      { from: '2026-11-10' },
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-09-01', kind: 'activate' },
      { from: '2026-11-01', q: msisdnPart() },
      { to: '2026-11-04', match: 'pending' },
    ];
    for (const query of queries) expect(await accounts.providerOperations(owner, query)).toEqual(await oracle.providerOperations(owner, query));
    const ranged = await accounts.providerOperations(owner, { from: '2026-11-02', to: '2026-11-04', provider: codeA });
    expect(ranged.items.map((row) => row.id)).toEqual([`${tag}-a3`, `${tag}-a2`]);
    expect(ranged.stats).toMatchObject({ count: 2, cost: 1700, pending: 2 });
  });

  function msisdnPart() {
    return `05${tag.replace(/\D/g, '0').slice(0, 6)}1`.slice(0, 12);
  }
});
