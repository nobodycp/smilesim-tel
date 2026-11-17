import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { ServiceGraph } from '../../testing/service-graph';
import { WalletsRepository } from '../../wallets/wallets.repository';
import { WalletsService } from '../../wallets/wallets.service';
import { entriesStoredBeforeTheCheck, theCheckValidatedAgain } from '../../wallets/testing/entries-before-the-check';
import { ProvidersRepository } from '../providers.repository';
import { ProviderHealthService } from '../directory/provider-health.service';
import { ProviderAccountsService } from './provider-accounts.service';

// PostgreSQL only (TEST_DATABASE_URL). Database plan DB.4: the provider books read the same rows and give the same
// numbers once the callers push their window into SQL. Totals are pinned on a seeded set (a cost kept on the entry,
// one taken from the line's saved terms, one from the package's price, one with no line, operations that cost
// nothing, payments, a settlement, open and closed tasks), and each windowed read is compared with the read it
// replaced: every operation ever, filtered in Node (the oracle).
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
  /** The same service reading as before DB.4: every operation ever, whatever window the caller asked for. */
  let oracle: ProviderAccountsService;
  let health: ProviderHealthService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    const repo = new ProvidersRepository(graph.uow);
    wallets = new WalletsService(graph.uow, graph.tree, graph.ledger, graph.ladder, new WalletsRepository(graph.uow));
    accounts = new ProviderAccountsService(graph.uow, wallets, repo);
    const unwindowed = { pricedOperations: (filter: { kind?: string; msisdn?: string } = {}) => wallets.pricedOperations({ kind: filter.kind, msisdn: filter.msisdn }) };
    oracle = new ProviderAccountsService(graph.uow, unwindowed as unknown as WalletsService, repo);
    health = new ProviderHealthService(graph.uow, accounts, repo);

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
    const entry = (id: string, kind: string, lineId: string | null, pkg: string, providerCost: number | null, at: string, number: string) => ({
      id: `${tag}-${id}`, userId: ids.pos, actorId: ids.owner, amount: 0, balanceAfter: 0, kind, lineId, msisdn: number,
      packageName: pkg, companyName: `bk-${tag}-co`, providerCost, createdAt: new Date(at),
    });
    // Rows as stored before the provider ledger's first release (ADR 0025): the read-time fallback is what is pinned here.
    await entriesStoredBeforeTheCheck(prisma, [
      entry('a1', 'activate', ids.lineA, `bk-${tag}-A1`, 2100, '2026-10-05T10:00:00.000Z', msisdn(1)), // kept on the entry
      entry('a2', 'charge', ids.lineA, `bk-${tag}-A1`, null, '2026-11-02T00:00:00.000Z', msisdn(1)), // the line's saved terms: 1700
      entry('a3', 'freeze', ids.lineA, `bk-${tag}-A1`, null, '2026-11-03T12:00:00.000Z', msisdn(1)), // costs nothing
      entry('a4', 'extend', ids.lineA, `bk-${tag}-A1`, 1600, '2026-11-10T09:00:00.000Z', msisdn(1)),
      entry('b1', 'activate', ids.lineB, `bk-${tag}-B1`, null, '2026-09-20T08:00:00.000Z', msisdn(2)), // the package's price: 3000 (no saved terms)
      entry('b2', 'disconnect', ids.lineB, `bk-${tag}-B1`, null, '2026-11-04T23:59:59.999Z', msisdn(2)), // costs nothing
      entry('b3', 'charge', null, `bk-${tag}-B1`, null, '2026-11-05T00:00:00.000Z', msisdn(2)), // no line: the package's renewal price, 2500
      entry('f1', 'fund', null, '', null, '2026-11-03T00:00:00.000Z', ''), // not an operation
    ]);
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
    await theCheckValidatedAgain(prisma);
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
    // The health watch's summaries are the list's rows, and the health worked out from them names B's balance.
    expect(ours(await accounts.summaries())).toEqual(ours(rows));
    const view = await health.current(new Date(), rows);
    expect(ours(view).map((row) => [row.code, row.available, row.status, row.reason])).toEqual([[codeA, 50_300, 'working', null], [codeB, -3500, 'problem', 'balance']]);
    // One provider's page: the same summary, and its ledger with the running balance over all its history.
    const detail = await accounts.detail(owner, codeA);
    expect(detail.summary).toEqual(rows.find((row) => row.code === codeA));
    expect(detail.ledger.filter((row) => row.kind !== 'payment' && row.kind !== 'settlement').map((row) => [row.id, row.amount])).toEqual([
      [`${tag}-a4`, -1600], [`${tag}-a2`, -1700], [`${tag}-a1`, -2100],
    ]);
  });

  it('reads a time window in the database with exactly the rows the old read kept in Node', async () => {
    const from = new Date('2026-11-02T00:00:00.000Z');
    const to = new Date('2026-11-04T23:59:59.999Z');
    const every = await wallets.pricedOperations();
    const windowed = await wallets.pricedOperations({ from, to });
    expect(windowed).toEqual(every.filter((row) => row.at >= from && row.at <= to));
    expect(windowed.filter((row) => row.id.startsWith(tag)).map((row) => [row.id, row.providerCode, row.cost])).toEqual([
      [`${tag}-b2`, codeB, 0], [`${tag}-a3`, codeA, 0], [`${tag}-a2`, codeA, 1700],
    ]);
    expect(await wallets.pricedOperations({ from })).toEqual(every.filter((row) => row.at >= from));
    expect(await wallets.pricedOperations({ to })).toEqual(every.filter((row) => row.at <= to));
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
