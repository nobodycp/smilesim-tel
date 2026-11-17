import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Ladder } from '../../pricing';
import { ServiceGraph } from '../../testing/service-graph';
import { chainIdsOf, lossMargins, marginColumns } from '../../wallets/stored-margins';
import { WalletsRepository } from '../../wallets/wallets.repository';
import { WalletsService } from '../../wallets/wallets.service';
import { InsightsService } from '../reports/insights.service';
import { ReportsRepository } from '../reports/reports.repository';
import { DeskRepository } from './desk.repository';
import { OverviewService } from './overview.service';
import { bucketOf } from './pulse';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-17-scale-speed-cleanup, "Branch losses in the profit figures
// (DB.5 P.8)": for the branch, every profit figure — the home's profit, its trend's bucket, its package, company and
// provider groups, the period before, the profit report's rows and totals and its CSV, the finance summary — is the
// sales' margin plus the `branchMargin` (− cost) of the operations marked as its loss in the same period; the counts
// and volumes stay the sales'. A main agent's, agent's and point of sale's figures do not move, their new fields are
// null / 0, and no loss is read for them. The branch reads every entry of the database (other specs' too): its
// totals are compared before and after this spec's rows are written, its groups by this spec's own names.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the branch\'s losses in its profit figures (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const p = { sky: randomUUID(), lian: randomUUID() };
  const name = (key: string) => `bl-${tag}-${key}`;
  const layers: Record<string, string> = { [u.owner]: 'branch', [u.main]: 'main_agent', [u.agent]: 'agent', [u.pos]: 'pos' };
  const actor = (id: string, grants: string[] = []): Actor => ({ id, loginName: id, nickname: id, layer: layers[id], isBranchOwner: id === u.owner, grants, operatorId: id, impersonating: false });
  let prisma: PrismaClient;
  let repo: DeskRepository;
  let walletsRepo: WalletsRepository;
  let overview: OverviewService;
  let wallets: WalletsService;

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Today, a minute ago (never in today's first second); the loss of the period before a day and a minute earlier,
  // inside yesterday's span up to this time.
  const at = new Date(Math.max(dayStart.getTime() + 1000, now.getTime() - 60_000));
  const yesterday = new Date(at.getTime() - 86_400_000 - 1000);
  const ladder: Ladder = { kind: 'subscription', chain: [u.pos, u.agent, u.main, u.owner], costs: { [u.pos]: 3800, [u.agent]: 3500, [u.main]: 3000, [u.owner]: 2500 }, posSell: 4500 };
  const path = [{ id: u.pos, layer: 'pos' }, { id: u.agent, layer: 'agent' }, { id: u.main, layer: 'main_agent' }, { id: u.owner, layer: 'branch' }];
  const base = (id: string, packageName: string, companyName: string, providerId: string, when: Date) => ({
    id: `${tag}-${id}`, userId: u.pos, actorId: u.owner, balanceAfter: 0, kind: 'activate', packagePrice: 3800, packageName: name(packageName), companyName: name(companyName), providerId, createdAt: when,
  });
  /** A sale as `WalletLedger.post` writes it: the branch earns 500 on it. */
  const sale = (id: string, packageName: string, companyName: string, providerId: string, when = at) => ({ ...base(id, packageName, companyName, providerId, when), amount: -3800, providerCost: 2500, ladder: ladder as unknown as object, ...marginColumns(ladder, chainIdsOf(path)) });
  /** An operation marked as the branch's loss, as P.7 writes it: moved 0, its cost, `branchMargin` = − cost. */
  const loss = (id: string, packageName: string, companyName: string, providerId: string, cost: number, when = at) => ({ ...base(id, packageName, companyName, providerId, when), amount: 0, providerCost: cost, providerLoss: 'priced_zero', ...lossMargins(cost) });

  type Figures = Awaited<ReturnType<OverviewService['overview']>>;
  let before: { day: Figures; month: Figures; report: Awaited<ReturnType<WalletsService['profitReport']>>; summary: Awaited<ReturnType<WalletsService['financeSummary']>> };
  const branch = actor(u.owner, ['reports']);
  const today = { from: at.toISOString().slice(0, 10), to: at.toISOString().slice(0, 10) };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    walletsRepo = new WalletsRepository(graph.uow);
    wallets = new WalletsService(graph.uow, graph.tree, graph.ledger, walletsRepo);
    const none = { list: async () => ({ rows: [] }) };
    repo = new DeskRepository(graph.uow);
    overview = new OverviewService(graph.tree, new InsightsService(graph.tree, new ReportsRepository(graph.uow)), none as never, { current: async () => [] } as never, repo);
    const user = (id: string, parentId: string | null) => ({ id, loginName: name(layers[id] + id.slice(0, 4)), nickname: layers[id], passwordHash: 'x', layer: layers[id], parentId, isBranchOwner: id === u.owner });
    for (const row of [user(u.owner, null), user(u.main, u.owner), user(u.agent, u.main), user(u.pos, u.agent)]) await prisma.user.create({ data: row });
    await prisma.provider.create({ data: { id: p.sky, code: name('sky'), name: name('sky') } });
    await prisma.provider.create({ data: { id: p.lian, code: name('lian'), name: name('lian') } });
    // What every viewer read before this spec's rows were written.
    before = {
      day: await overview.overview(branch, { period: 'day' }),
      month: await overview.overview(branch, { period: 'month' }),
      report: await wallets.profitReport(branch, today),
      summary: await wallets.financeSummary(branch, { days: '7' }),
    };
    await prisma.walletEntry.createMany({
      data: [
        // A sale of package 400 at provider sky, and in the period two losses: one on the same package, one on a
        // package with no sale (provider lian); one more loss dated in the period before.
        sale('s1', '400', 'cellcom', p.sky),
        loss('l1', '400', 'cellcom', p.sky, 2000),
        loss('l2', '900', 'wecom', p.lian, 1200),
        loss('l0', '400', 'cellcom', p.sky, 700, yesterday),
      ],
    });
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.provider.deleteMany({ where: { id: { in: Object.values(p) } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('nets the branch\'s home profit, its trend\'s bucket and the period before of the losses, its counts and volume unchanged', async () => {
    const day = await overview.overview(branch, { period: 'day' });
    const was = before.day;
    // One sale (500 to the branch) and two losses (2000 and 1200) today.
    expect({
      count: day.sales.count - was.sales.count,
      amount: day.sales.amount - was.sales.amount,
      activations: day.sales.activations - was.sales.activations,
      refunds: day.sales.refunds - was.sales.refunds,
      net: day.sales.net - was.sales.net,
      profit: day.sales.profit - was.sales.profit,
    }).toEqual({ count: 1, amount: 3800, activations: 1, refunds: 0, net: 3800, profit: 500 - 2000 - 1200 });
    expect(day.sales.losses).toEqual({ count: (was.sales.losses?.count ?? 0) + 2, amount: (was.sales.losses?.amount ?? 0) + 3200 });
    expect(day.pulse.current.profit - was.pulse.current.profit).toBe(-2700);
    expect(day.pulse.current.losses - was.pulse.current.losses).toBe(3200);
    expect(day.pulse.current.count - was.pulse.current.count).toBe(1);
    // The hour of the trend that holds them, and the day of the sales trend.
    const hour = (figures: Figures) => figures.pulse.trend.find((point) => point.at === bucketOf('hour', at)) ?? { profit: 0, losses: 0, count: 0 };
    expect([hour(day).profit - hour(was).profit, hour(day).losses - hour(was).losses, hour(day).count - hour(was).count]).toEqual([-2700, 3200, 1]);
    const ofDay = (figures: Figures) => figures.sales.trend.find((row) => row.day === bucketOf('day', at)) ?? { profit: 0, count: 0 };
    expect([ofDay(day).profit - ofDay(was).profit, ofDay(day).count - ofDay(was).count]).toEqual([-2700, 1]);
    // The period before carries the loss dated in it, and no sale.
    expect([(day.pulse.previous?.profit ?? 0) - (was.pulse.previous?.profit ?? 0), (day.pulse.previous?.losses ?? 0) - (was.pulse.previous?.losses ?? 0), (day.pulse.previous?.count ?? 0) - (was.pulse.previous?.count ?? 0)]).toEqual([-700, 700, 0]);
    // This month: today's bucket of the month's trend, by the day.
    const month = await overview.overview(branch, { period: 'month' });
    const ofStep = (figures: Figures) => figures.pulse.trend.find((point) => point.at === bucketOf('day', at)) ?? { profit: 0, losses: 0 };
    expect([ofStep(month).profit - ofStep(before.month).profit, ofStep(month).losses - ofStep(before.month).losses]).toEqual([-2700, 3200]);
  });

  it('nets the branch\'s package, company and provider groups, a group with losses and no sale among them with count 0', async () => {
    const day = await overview.overview(branch, { period: 'day' });
    const mine = (rows: { label: string; count: number; amount: number; profit: number }[]) => rows.filter((row) => row.label.startsWith(name(''))).map((row) => [row.label, row.count, row.amount, row.profit]);
    expect(mine(day.top.packages)).toEqual([[name('400'), 1, 3800, 500 - 2000], [name('900'), 0, 0, -1200]]);
    // Companies and providers rank by profit: the smaller loss first.
    expect(mine(day.top.companies)).toEqual([[name('wecom'), 0, 0, -1200], [name('cellcom'), 1, 3800, -1500]]);
    expect(mine(day.top.providers)).toEqual([[name('lian'), 0, 0, -1200], [name('sky'), 1, 3800, -1500]]);
  });

  it('nets the branch\'s profit report, its rows and totals, and its CSV gains the two columns', async () => {
    const report = await wallets.profitReport(branch, today);
    const mine = report.packages.filter((row) => row.packageName.startsWith(name('')));
    expect(mine).toEqual([
      { packageName: name('400'), companyName: name('cellcom'), sales: 1, refunds: 0, profit: -1500, losses: 1, lossAmount: 2000 },
      { packageName: name('900'), companyName: name('wecom'), sales: 0, refunds: 0, profit: -1200, losses: 1, lossAmount: 1200 },
    ]);
    const was = before.report.totals;
    expect({ sales: report.totals.sales - was.sales, refunds: report.totals.refunds - was.refunds, profit: report.totals.profit - was.profit, losses: report.totals.losses - was.losses, lossAmount: report.totals.lossAmount - was.lossAmount })
      .toEqual({ sales: 1, refunds: 0, profit: -2700, losses: 2, lossAmount: 3200 });
    // The same filters: the search keeps the package's own losses, the period before's loss is out of today.
    const searched = await wallets.profitReport(branch, { ...today, q: name('900') });
    expect(searched.packages).toEqual([{ packageName: name('900'), companyName: name('wecom'), sales: 0, refunds: 0, profit: -1200, losses: 1, lossAmount: 1200 }]);
    const csv = (await wallets.profitCsv(branch, { ...today, q: name('900') })).split('\r\n');
    expect(csv[0]).toBe('﻿company,package,sales,refunds,profit,losses,lossAmount');
    expect(csv.slice(1, 3)).toEqual([`${name('wecom')},${name('900')},0,0,-12.00,1,12.00`, ',TOTAL,0,0,-12.00,1,12.00']);
  });

  it('nets the branch\'s finance summary and counts its losses', async () => {
    const summary = await wallets.financeSummary(branch, { days: '7' });
    // The window holds today's two losses and yesterday's one.
    expect(summary.profit - before.summary.profit).toBe(500 - 2000 - 1200 - 700);
    expect(summary.sales - before.summary.sales).toBe(1);
    expect(summary.losses).toEqual({ count: (before.summary.losses?.count ?? 0) + 3, amount: (before.summary.losses?.amount ?? 0) + 3900 });
  });

  it('leaves a main agent\'s, an agent\'s and a point of sale\'s figures as they are, with the new fields null / 0 and no loss read', async () => {
    const reads = [jest.spyOn(repo, 'lossesByBucket'), jest.spyOn(repo, 'firstLoss'), jest.spyOn(walletsRepo, 'lossGroups'), jest.spyOn(walletsRepo, 'lossTotal')];
    try {
      // Each one's share of the sale: main agent 500, agent 300, point of sale 700.
      for (const [id, earned] of [[u.main, 500], [u.agent, 300], [u.pos, 700]] as const) {
        const viewer = actor(id);
        for (const period of ['day', 'all'] as const) {
          const figures = await overview.overview(viewer, { period });
          expect(figures.sales).toMatchObject({ count: 1, amount: 3800, profit: earned, losses: null });
          expect(figures.pulse.current).toEqual({ count: 1, amount: 3800, activations: 1, profit: earned, losses: 0 });
          expect(figures.pulse.trend.every((point) => point.losses === 0)).toBe(true);
          expect(figures.top.packages.map((row) => [row.label, row.count, row.profit])).toEqual([[name('400'), 1, earned]]);
          if (period === 'day') expect(figures.pulse.previous).toEqual({ count: 0, amount: 0, activations: 0, profit: 0, losses: 0 });
        }
        const report = await wallets.profitReport(viewer, today);
        expect(report).toEqual({
          packages: [{ packageName: name('400'), companyName: name('cellcom'), sales: 1, refunds: 0, profit: earned, losses: 0, lossAmount: 0 }],
          totals: { sales: 1, refunds: 0, profit: earned, losses: 0, lossAmount: 0 },
        });
        expect((await wallets.profitCsv(viewer, today)).split('\r\n')[0]).toBe('﻿company,package,sales,refunds,profit');
        expect(await wallets.financeSummary(viewer, { days: '7' })).toMatchObject({ profit: earned, sales: 1, losses: null });
      }
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    } finally {
      for (const read of reads) read.mockRestore();
    }
  });

  it('reads the period\'s losses from the partial index `WalletEntry_loss_createdAt`', async () => {
    // Two years of marked operations (four a day, one at this spec's point of sale), analysed, then rolled back: the
    // table the index is for. A period of today then reads the time index, not the provider's (`WalletEntry_provider_loss`,
    // led by the provider) nor the table.
    const rollback = new Error('rolled back');
    let plans: string[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "WalletEntry" ("id", "userId", "actorId", "amount", "balanceAfter", "kind", "packageName", "companyName", "providerId", "providerCost", "providerLoss", "branchMargin", "createdAt")
        SELECT '${tag}-x' || n, '${u.pos}', '${u.owner}', 0, 0, 'activate', 'p' || (n % 7), 'c' || (n % 3), '${p.sky}', 1000, 'priced_zero', -1000, now() - interval '1 day' - n * interval '6 hours'
        FROM generate_series(1, 2920) AS n`);
      await tx.$executeRawUnsafe('ANALYZE "WalletEntry"');
      const plan = async (sql: string) => (await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN (COSTS OFF) ${sql}`)).map((row) => row['QUERY PLAN']).join('\n');
      const since = `'${dayStart.toISOString()}'::timestamp`;
      plans = [
        // The home's read (`lossesByBucket`), the summary's (`lossTotal`) and the report's (`lossGroups`), in their shape.
        await plan(`SELECT to_char("createdAt", 'YYYY-MM-DD') AS at, "packageName", "companyName", "providerId", count(*), sum("branchMargin") FROM "WalletEntry" WHERE "providerLoss" IS NOT NULL AND "createdAt" >= ${since} GROUP BY 1, 2, 3, 4`),
        await plan(`SELECT count(*), sum("branchMargin") FROM "WalletEntry" WHERE "providerLoss" IS NOT NULL AND "createdAt" >= ${since}`),
        await plan(`SELECT "companyName", "packageName", count(*), sum("branchMargin"), max("createdAt") FROM "WalletEntry" WHERE ("providerLoss" IS NOT NULL AND "createdAt" >= ${since} AND "createdAt" <= now()) GROUP BY 1, 2`),
      ];
      throw rollback;
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
    expect(plans).toHaveLength(3);
    for (const plan of plans) expect(plan).toContain('WalletEntry_loss_createdAt');
    expect(await prisma.walletEntry.count({ where: { id: { startsWith: `${tag}-x` } } })).toBe(0);
  });
});
