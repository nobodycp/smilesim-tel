import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { PrismaClient, WalletEntry } from '../../generated/prisma/client';
import type { Actor } from '../access/types';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { PROVIDER_CHARGED_LATER_NOTE, PROVIDER_RELEASED_NOTE } from '../platform/stored-text';
import type { Ladder } from '../pricing';
import { ProviderAccountsService } from '../providers/account/provider-accounts.service';
import { ProvidersRepository } from '../providers/providers.repository';
import { DeskRepository } from '../reporting/desk/desk.repository';
import { OverviewService } from '../reporting/desk/overview.service';
import { InsightsService } from '../reporting/reports/insights.service';
import { ReportsRepository } from '../reporting/reports/reports.repository';
import { ServiceGraph } from '../testing/service-graph';
import { lossMargins, marginBreaks } from './stored-margins';
import { writeGivenBack } from './wallet-ledger';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-17-scale-speed-cleanup, "A given-back operation charged later
// (DB.5 P.9)", ADR 0027: the branch charges the point of sale for an activation the provider ran and whose money was
// given back, from the marked operation itself. One transaction: the sale entry (the amount the task held, its
// `chargesEntryId`, provider cost 0, the ladder with the branch's cost 0) and the mark turned `charged_later`. The
// branch reads every entry of the database (other specs' too): its totals are compared as differences, its groups by
// this spec's own names.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const START = 1_000_000;
// Package P, provider A: what each layer pays, and the subscriber's price.
const P = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
const FEE = 1000;

suite('a given-back operation charged later (PostgreSQL)', () => {
  jest.setTimeout(120_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID(), poor: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const name = (key: string) => `cl-${tag}-${key}`;
  const layers: Record<string, string> = { [u.owner]: 'branch', [u.main]: 'main_agent', [u.agent]: 'agent', [u.pos]: 'pos', [u.poor]: 'pos' };
  const actor = (id: string, grants: string[] = []): Actor => ({ id, loginName: name(id.slice(0, 6)), nickname: id, layer: layers[id], isBranchOwner: id === u.owner, grants, operatorId: id, impersonating: false });
  const branch = actor(u.owner, ['reports']);
  let prisma: PrismaClient;
  let wallets: WalletsService;
  let accounts: ProviderAccountsService;
  let overview: OverviewService;

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // The give-back a day and a second before a minute ago: inside the home's period before («day»), on yesterday's date.
  const at = new Date(Math.max(dayStart.getTime() + 1000, now.getTime() - 60_000));
  const yesterday = new Date(at.getTime() - 86_400_000 - 1000);
  const dateOf = (when: Date) => when.toISOString().slice(0, 10);
  const today = { from: dateOf(at), to: dateOf(new Date()) };
  const before = { from: dateOf(yesterday), to: dateOf(yesterday) };
  const cost = { plain: P.branchCost, esim: P.branchCost + FEE };

  const balance = async (userId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const entries = (userId: string) => prisma.walletEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const charges = (entryId: string) => prisma.walletEntry.findMany({ where: { chargesEntryId: entryId } });
  const row = (id: string) => prisma.walletEntry.findUniqueOrThrow({ where: { id } });
  const refusal = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { status?: number; code?: string }) => `${error.status} ${error.code}`);
  const layerOf = (id: string) => layers[id] ?? '';

  /** A given-back activation as the approval (and the backfill, `writeGivenBack`) records it: moved 0, its cost, marked. */
  const givenBack = (userId: string, msisdn: string, esim: boolean) =>
    prisma.$transaction(async (tx) =>
      writeGivenBack(tx, {
        userId, actorId: u.owner, at: yesterday, balanceAfter: userId === u.pos ? START : 0, note: PROVIDER_RELEASED_NOTE,
        sale: {
          msisdn, lineId: '', companyName: name('co'), packageName: name('p'), packagePrice: P.posPrice, providerId: ids.provider,
          providerCost: esim ? cost.esim : cost.plain, providerLoss: 'given_back', ...(esim ? { esimPrice: FEE } : {}),
        },
      }),
    );

  let g: { plain: string; esim: string; poor: string; zero: string; unmarked: string };
  type Figures = Awaited<ReturnType<OverviewService['overview']>>;
  let marked: { day: Figures; all: Figures; today: Awaited<ReturnType<WalletsService['profitReport']>>; summary: Awaited<ReturnType<WalletsService['financeSummary']>>; purchases: number; losses: number };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const notice = { write: async () => [], publish: async () => undefined };
    const graph = new ServiceGraph(new MemoryAuthStore(), notice as never);
    graph.prismaClient = prisma;
    const walletsRepo = new WalletsRepository(graph.uow);
    wallets = new WalletsService(graph.uow, graph.tree, graph.ledger, walletsRepo);
    accounts = new ProviderAccountsService(graph.uow, wallets, new ProvidersRepository(graph.uow));
    overview = new OverviewService(graph.tree, new InsightsService(graph.tree, new ReportsRepository(graph.uow)), { list: async () => ({ rows: [] }) } as never, { current: async () => [] } as never, new DeskRepository(graph.uow));
    const user = (id: string, parentId: string | null) => ({ id, loginName: name(id.slice(0, 6)), nickname: layers[id], passwordHash: 'x', layer: layers[id], parentId, isBranchOwner: id === u.owner });
    for (const [id, parent] of [[u.owner, null], [u.main, u.owner], [u.agent, u.main], [u.pos, u.agent], [u.poor, u.agent]] as const) {
      await prisma.user.create({ data: { ...user(id, parent), wallet: { create: { balance: id === u.pos ? START : 0, ceiling: 0 } } } });
    }
    await prisma.provider.create({ data: { id: ids.provider, code: name('A'), name: name('A') } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code: name('co'), name: name('co') } });
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code: name('p'), name: name('p'), providerId: ids.provider, companyId: ids.company, ...P, autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false } });
    g = {
      plain: await givenBack(u.pos, '0599100001', false),
      esim: await givenBack(u.pos, '0599100002', true),
      poor: await givenBack(u.poor, '0599100003', false),
      // A sale at 0 (P.7's other mark) and an operation with no mark.
      zero: (await prisma.walletEntry.create({ data: { userId: u.pos, actorId: u.owner, amount: 0, balanceAfter: START, kind: 'activate', msisdn: '0599100004', packageName: name('p'), companyName: name('co'), packagePrice: 0, providerId: ids.provider, providerCost: P.branchCost, providerLoss: 'priced_zero', ...lossMargins(P.branchCost), createdAt: yesterday } })).id,
      unmarked: (await prisma.walletEntry.create({ data: { userId: u.pos, actorId: u.owner, amount: 0, balanceAfter: START, kind: 'freeze', msisdn: '0599100005', packageName: name('p'), companyName: name('co'), providerId: ids.provider, providerCost: 0, createdAt: yesterday } })).id,
    };
    marked = {
      day: await overview.overview(branch, { period: 'day' }),
      all: await overview.overview(branch, { period: 'all' }),
      today: await wallets.profitReport(branch, today),
      summary: await wallets.financeSummary(branch, { days: '7' }),
      purchases: (await wallets.providerPurchases()).get(ids.provider) ?? 0,
      losses: (await accounts.list(branch)).rows.find((item) => item.code === name('A'))?.losses ?? -1,
    };
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: Object.values(u) } } });
    for (const id of [u.poor, u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('the given-back rows keep what the task held: the package price, and the eSIM fee for an eSIM', async () => {
    expect(marked.losses).toBe(4);
    expect(await row(g.plain)).toMatchObject({ amount: 0, packagePrice: P.posPrice, esimPrice: null, providerCost: cost.plain, providerLoss: 'given_back', branchMargin: -cost.plain });
    expect(await row(g.esim)).toMatchObject({ amount: 0, packagePrice: P.posPrice, esimPrice: FEE, providerCost: cost.esim, providerLoss: 'given_back', branchMargin: -cost.esim });
    const listed = await accounts.providerOperations(branch, { provider: name('A'), loss: 'given_back' });
    expect(listed.items.map((item) => [item.id, item.loginName, item.chargeAmount]).sort()).toEqual([
      [g.esim, name(u.pos.slice(0, 6)), P.posPrice + FEE],
      [g.plain, name(u.pos.slice(0, 6)), P.posPrice],
      [g.poor, name(u.poor.slice(0, 6)), P.posPrice],
    ].sort());
    expect((await accounts.providerOperations(branch, { provider: name('A'), loss: 'priced_zero' })).items.map((item) => item.chargeAmount)).toEqual([null]);
  });

  it('refuses another layer (403), a sale at 0 (400), an unmarked row (409) and an unknown one (404), writing nothing', async () => {
    const was = await entries(u.pos);
    for (const id of [u.main, u.agent, u.pos]) expect(await refusal(wallets.chargeGivenBack(actor(id), g.plain))).toBe('403 FORBIDDEN');
    expect(await refusal(wallets.chargeGivenBack({ ...branch, impersonating: true }, g.plain))).toBe('403 FORBIDDEN');
    expect(await refusal(wallets.chargeGivenBack(branch, g.zero))).toBe('400 INVALID');
    expect(await refusal(wallets.chargeGivenBack(branch, g.unmarked))).toBe('409 DUPLICATE_REQUEST');
    expect(await refusal(wallets.chargeGivenBack(branch, randomUUID()))).toBe('404 NOT_FOUND');
    expect(await entries(u.pos)).toEqual(was);
    expect(await balance(u.pos)).toBe(START);
  });

  it('charges the amount given back as a sale: the charge entry, its ladder with the branch\'s cost 0, its margins; the mark turned', async () => {
    const original = await row(g.plain);
    expect(await wallets.chargeGivenBack(branch, g.plain)).toEqual({ ok: true, amount: P.posPrice });
    expect(await balance(u.pos)).toBe(START - P.posPrice);
    const [charge] = await charges(g.plain);
    const ladder: Ladder = { kind: 'subscription', chain: [u.pos, u.agent, u.main, u.owner], costs: { [u.pos]: P.posPrice, [u.agent]: P.agentPrice, [u.main]: P.mainPrice, [u.owner]: 0 }, posSell: P.subscriberPrice };
    expect(charge).toMatchObject({
      userId: u.pos, actorId: u.owner, kind: 'activate', amount: -P.posPrice, balanceAfter: START - P.posPrice, note: PROVIDER_CHARGED_LATER_NOTE,
      msisdn: '0599100001', lineId: null, packageName: name('p'), companyName: name('co'), packagePrice: P.posPrice, esimPrice: null,
      providerId: ids.provider, providerCost: 0, providerLoss: null, chargesEntryId: g.plain, ladder,
      chainPosId: u.pos, chainAgentId: u.agent, chainMainAgentId: u.main,
      posMargin: P.subscriberPrice - P.posPrice, agentMargin: P.posPrice - P.agentPrice, mainAgentMargin: P.agentPrice - P.mainPrice, branchMargin: P.mainPrice,
    });
    // The operation's row: only the mark changed.
    expect(await row(g.plain)).toEqual({ ...original, providerLoss: 'charged_later' } as WalletEntry);
    // ADR 0026's invariant holds on both rows unchanged.
    expect(marginBreaks([charge, await row(g.plain)], layerOf)).toEqual([]);
    // The provider was paid once: its purchases do not move.
    expect((await wallets.providerPurchases()).get(ids.provider)).toBe(marked.purchases);
    // Again: refused, nothing more written.
    expect(await refusal(wallets.chargeGivenBack(branch, g.plain))).toBe('409 DUPLICATE_REQUEST');
    expect(await charges(g.plain)).toHaveLength(1);
    expect(await balance(u.pos)).toBe(START - P.posPrice);
  });

  it('two charges of one operation at once: one entry, one 409; an eSIM one takes the fee too', async () => {
    const was = await balance(u.pos);
    const answers = await Promise.all([refusal(wallets.chargeGivenBack(branch, g.esim)), refusal(wallets.chargeGivenBack(branch, g.esim))]);
    expect(answers.sort()).toEqual(['409 DUPLICATE_REQUEST', 'ok']);
    const written = await charges(g.esim);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ amount: -(P.posPrice + FEE), packagePrice: P.posPrice, esimPrice: FEE, providerCost: 0, branchMargin: P.mainPrice });
    expect(await balance(u.pos)).toBe(was - P.posPrice - FEE);
    expect((await row(g.esim)).providerLoss).toBe('charged_later');
  });

  it('a debit over the ceiling is refused as a sale is, and nothing is written', async () => {
    const was = await entries(u.poor);
    expect(await refusal(wallets.chargeGivenBack(branch, g.poor))).toBe('400 BALANCE_CEILING');
    expect(await entries(u.poor)).toEqual(was);
    expect(await balance(u.poor)).toBe(0);
    expect((await row(g.poor)).providerLoss).toBe('given_back');
    expect(await charges(g.poor)).toHaveLength(0);
  });

  it('the warnings no longer count a charged operation; every profit figure keeps its − cost at its own date', async () => {
    const charged = 2 * P.mainPrice;
    const lostCost = cost.plain + cost.esim;
    // The home over all time: the two charges are sales with the branch's sell price; the two operations left the losses.
    const all = await overview.overview(branch, { period: 'all' });
    expect({ count: all.sales.count - marked.all.sales.count, profit: all.sales.profit - marked.all.sales.profit, losses: (all.sales.losses?.count ?? 0) - (marked.all.sales.losses?.count ?? 0), lost: (all.sales.losses?.amount ?? 0) - (marked.all.sales.losses?.amount ?? 0) })
      .toEqual({ count: 2, profit: charged, losses: -2, lost: -lostCost });
    // Today: two sales; the period before (yesterday's span) keeps its − cost in the profit and no longer its loss.
    const day = await overview.overview(branch, { period: 'day' });
    expect([day.sales.count - marked.day.sales.count, day.sales.profit - marked.day.sales.profit]).toEqual([2, charged]);
    expect([(day.pulse.previous?.profit ?? 0) - (marked.day.pulse.previous?.profit ?? 0), (day.pulse.previous?.losses ?? 0) - (marked.day.pulse.previous?.losses ?? 0)]).toEqual([0, -lostCost]);
    // The profit report: yesterday the package holds the four marks' − cost and one open given-back loss and the sale at
    // 0; today the two charges. Over both dates each charged operation is an ordinary sale's margin for the branch.
    const mine = (report: Awaited<ReturnType<WalletsService['profitReport']>>) => report.packages.find((item) => item.packageName === name('p'));
    expect(mine(await wallets.profitReport(branch, before))).toEqual({ packageName: name('p'), companyName: name('co'), sales: 0, refunds: 0, profit: -(cost.plain + cost.esim + cost.plain + P.branchCost), losses: 2, lossAmount: cost.plain + P.branchCost });
    expect(mine(await wallets.profitReport(branch, today))).toEqual({ packageName: name('p'), companyName: name('co'), sales: 2, refunds: 0, profit: charged, losses: 0, lossAmount: 0 });
    const both = mine(await wallets.profitReport(branch, { from: before.from, to: today.to }));
    expect(both?.profit).toBe(2 * (P.mainPrice - P.branchCost) - cost.plain - P.branchCost - FEE);
    // The finance summary of the last seven days.
    const summary = await wallets.financeSummary(branch, { days: '7' });
    expect([summary.profit - marked.summary.profit, summary.sales - marked.summary.sales, (summary.losses?.count ?? 0) - (marked.summary.losses?.count ?? 0), (summary.losses?.amount ?? 0) - (marked.summary.losses?.amount ?? 0)])
      .toEqual([charged, 2, -2, -lostCost]);
  });

  it('the provider\'s screens: the filters, the counts, the books', async () => {
    const ops = (loss?: string) => accounts.providerOperations(branch, { provider: name('A'), ...(loss ? { loss } : {}) });
    expect((await ops('charged_later')).items.map((item) => item.id).sort()).toEqual([g.plain, g.esim].sort());
    expect((await ops('any')).items.map((item) => item.id).sort()).toEqual([g.poor, g.zero].sort());
    expect((await ops()).stats.losses).toBe(2);
    expect((await ops('charged_later')).items.every((item) => item.chargeAmount === null)).toBe(true);
    const list = await accounts.list(branch);
    expect(list.rows.find((item) => item.code === name('A'))).toMatchObject({ losses: 2, purchases: marked.purchases });
    const detail = await accounts.detail(branch, name('A'));
    expect(detail.summary.losses).toBe(2);
    expect(detail.ledger.filter((item) => item.loss === 'charged_later').map((item) => item.id).sort()).toEqual([g.plain, g.esim].sort());
    // The charge entries cost the provider 0: they are in no provider ledger's priced rows.
    const chargeIds = [...(await charges(g.plain)), ...(await charges(g.esim))].map((item) => item.id);
    expect(detail.ledger.some((item) => chargeIds.includes(item.id))).toBe(false);
  });

  it('the point of sale reads the charge as a debit with its note and its own margin, and no mark on either row', async () => {
    const mine = await wallets.finance(actor(u.pos), {});
    const [charge] = await charges(g.plain);
    expect(mine.items.find((item) => item.id === charge.id)).toMatchObject({ kind: 'activate', amount: -P.posPrice, note: PROVIDER_CHARGED_LATER_NOTE, loss: null, margin: P.subscriberPrice - P.posPrice });
    expect(mine.items.find((item) => item.id === g.plain)).toMatchObject({ amount: 0, loss: null, margin: null });
    await expect(wallets.finance(actor(u.pos), { loss: 'charged_later' })).rejects.toMatchObject({ status: 403 });
    // The branch sees the mark and the filter.
    const theirs = await wallets.finance(branch, { loss: 'charged_later', q: name(u.pos.slice(0, 6)) });
    expect(theirs.items.map((item) => [item.id, item.loss]).sort()).toEqual([[g.plain, 'charged_later'], [g.esim, 'charged_later']].sort());
  });
});
