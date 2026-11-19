import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Ladder } from '../../postpaid/pricing';
import { ServiceGraph } from '../../testing/service-graph';
import { chainIdsOf, marginColumns } from '../../wallets/stored-margins';
import { WalletsRepository } from '../../wallets/wallets.repository';
import { WalletsService } from '../../wallets/wallets.service';
import { InsightsService } from '../reports/insights.service';
import { ReportsRepository } from '../reports/reports.repository';
import { DeskRepository } from './desk.repository';
import { OverviewService } from './overview.service';
import { bucketOf } from './pulse';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0026, slice M.4: every profit figure is a SQL sum of the margins each sale
// and refund stored, over the sales whose chain held the viewer at the time of the sale (every one for the branch):
// the home overview (sales, refunds, net, profit, the trend, the rankings, the most active accounts, the period
// before), the providers report, the profit report and its CSV, the finance summary, and the finance list's margins
// and shares. No cap: exact over any period. A point of sale moved to another agent after a sale leaves that sale's
// figures with the agent of the time (the owner's answer 1).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the profit figures read from the stored margins (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), agent2: randomUUID(), pos: randomUUID(), pos2: randomUUID() };
  const p = { sky: randomUUID(), lian: randomUUID() };
  const name = (key: string) => `smr-${tag}-${key}`;
  const layers: Record<string, string> = { [u.owner]: 'branch', [u.main]: 'main_agent', [u.agent]: 'agent', [u.agent2]: 'agent', [u.pos]: 'pos', [u.pos2]: 'pos' };
  const actor = (id: string, grants: string[] = []): Actor => ({ id, loginName: id, nickname: id, layer: layers[id], isBranchOwner: id === u.owner, grants, operatorId: id, impersonating: false });
  let prisma: PrismaClient;
  let overview: OverviewService;
  let wallets: WalletsService;
  let insights: InsightsService;

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Today, a minute ago (never in today's first second), so every period holds them; the second sale half a second
  // before, so the package sold last is told apart.
  const at = new Date(Math.max(dayStart.getTime() + 1000, now.getTime() - 60_000));
  const before = new Date(at.getTime() - 500);
  const ladder = (pos: string): Ladder => ({ kind: 'subscription', chain: [pos, u.agent, u.main, u.owner], costs: { [pos]: 3800, [u.agent]: 3500, [u.main]: 3000, [u.owner]: 2500 }, posSell: 4500 });
  const path = (pos: string) => [{ id: pos, layer: 'pos' }, { id: u.agent, layer: 'agent' }, { id: u.main, layer: 'main_agent' }, { id: u.owner, layer: 'branch' }];
  /** An entry as `WalletLedger.post` writes it: the ladder and its margins in the same row. */
  const entry = (id: string, userId: string, kind: string, amount: number, sold: Ladder | null, packageName: string, providerId: string, when = at) => ({
    id: `${tag}-${id}`, userId, actorId: u.owner, amount, balanceAfter: 0, kind, packagePrice: 3800, packageName, companyName: name(packageName === '400' ? 'cellcom' : 'wecom'),
    providerId, providerCost: 2500, createdAt: when,
    ...(sold ? { ladder: sold as unknown as object, ...marginColumns(sold, chainIdsOf(path(sold.chain[0]))) } : {}),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    wallets = new WalletsService(graph.uow, graph.tree, graph.ledger, new WalletsRepository(graph.uow));
    insights = new InsightsService(graph.tree, new ReportsRepository(graph.uow));
    const none = { list: async () => ({ rows: [] }) };
    overview = new OverviewService(graph.tree, insights, none as never, { current: async () => [] } as never, new DeskRepository(graph.uow));
    const user = (id: string, parentId: string | null) => ({ id, loginName: name(layers[id] + id.slice(0, 4)), nickname: layers[id], passwordHash: 'x', layer: layers[id], parentId, isBranchOwner: id === u.owner });
    for (const row of [user(u.owner, null), user(u.main, u.owner), user(u.agent, u.main), user(u.agent2, u.main), user(u.pos, u.agent), user(u.pos2, u.agent)]) await prisma.user.create({ data: row });
    await prisma.provider.create({ data: { id: p.sky, code: name('sky'), name: 'سكاي' } });
    await prisma.provider.create({ data: { id: p.lian, code: name('lian'), name: 'ليان' } });
    await prisma.walletEntry.createMany({
      data: [
        entry('s1', u.pos, 'activate', -3800, ladder(u.pos), '400', p.sky),
        entry('s2', u.pos, 'charge', -3800, ladder(u.pos), '400', p.sky),
        entry('s3', u.pos2, 'activate', -3800, ladder(u.pos2), '100', p.lian, before),
        entry('r1', u.pos, 'disconnect', 1900, { ...ladder(u.pos), share: -0.5 }, '400', p.sky),
        // An operation that sells nothing: in the providers report's operations, in no profit.
        entry('f1', u.pos, 'freeze', 0, null, '400', p.sky),
      ],
    });
    // The second point of sale was moved to another agent after its sale (the owner's answer 1).
    await prisma.user.update({ where: { id: u.pos2 }, data: { parentId: u.agent2 } });
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.provider.deleteMany({ where: { id: { in: Object.values(p) } } });
    for (const id of [u.pos2, u.pos, u.agent2, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('sums the sales with the viewer\'s stored profit, takes refunds back, and ranks packages and companies', async () => {
    const result = await overview.overview(actor(u.agent), {});
    expect(result.period).toBe('month');
    // The agent earns 300 on each sale and gives back 150 on the refund.
    expect(result.sales).toEqual({ count: 3, amount: 11400, refunds: 1, refundAmount: 1900, net: 9500, profit: 3 * 300 - 150, activations: 2, trend: [{ day: at.toISOString().slice(0, 10), amount: 11400, profit: 750, count: 3 }], losses: null });
    expect(result.top.packages.map((row) => [row.label, row.count, row.amount, row.profit])).toEqual([['400', 2, 7600, 600], ['100', 1, 3800, 300]]);
    expect(result.top.companies.map((row) => [row.label, row.profit])).toEqual([[name('cellcom'), 600], [name('wecom'), 300]]);
    expect(result.top.providers).toEqual([]);
  });

  it('ranks the most active accounts per layer below the viewer, by the chain of the sale', async () => {
    const agent = await overview.overview(actor(u.agent), {});
    expect(agent.active.main_agent).toEqual([]);
    expect(agent.active.agent).toEqual([]);
    expect(agent.active.pos.map((row) => [row.key, row.count, row.profit])).toEqual([[u.pos, 2, 1400], [u.pos2, 1, 700]]);
    const main = await overview.overview(actor(u.main), {});
    expect(main.active.agent.map((row) => [row.key, row.count, row.profit])).toEqual([[u.agent, 3, 900]]);
    // The agent the point of sale was moved to has none of its earlier sales.
    const agent2 = await overview.overview(actor(u.agent2), { period: 'all' });
    expect(agent2.sales).toMatchObject({ count: 0, amount: 0, profit: 0 });
    expect(agent2.active.pos).toEqual([]);
  });

  it('gives the period cards and a trend whose buckets are the axis\'s, and nothing to compare over all time', async () => {
    const all = await overview.overview(actor(u.agent), { period: 'all' });
    expect(all.pulse.current).toEqual({ count: 3, amount: 11400, activations: 2, profit: 750, losses: 0 });
    expect(all.pulse.previous).toBeNull();
    // A short history is drawn by the hour; the SQL bucket of the sales is the axis's own key.
    expect(all.pulse.trend.find((point) => point.at === bucketOf('hour', at))).toMatchObject({ count: 3, amount: 11400, activations: 2, profit: 750 });
    const day = await overview.overview(actor(u.agent), { period: 'day' });
    expect(day.pulse.trend.find((point) => point.at === bucketOf('hour', at))).toMatchObject({ count: 3, profit: 750 });
    expect(day.pulse.trend.reduce((sum, point) => sum + point.count, 0)).toBe(3);
  });

  it('compares with the same span of the period before, from the stored margins', async () => {
    const yesterday = new Date(at.getTime() - 86_400_000);
    await prisma.walletEntry.create({ data: entry('s0', u.pos, 'activate', -3800, ladder(u.pos), '400', p.sky, yesterday) });
    try {
      const day = await overview.overview(actor(u.agent), { period: 'day' });
      expect(day.pulse.previous).toEqual({ count: 1, amount: 3800, activations: 1, profit: 300, losses: 0 });
      expect(day.pulse.current).toEqual({ count: 3, amount: 11400, activations: 2, profit: 750, losses: 0 });
    } finally {
      await prisma.walletEntry.delete({ where: { id: `${tag}-s0` } });
    }
  });

  it('gives the branch every sale with the branch\'s margin, ranks its providers by the provider each sale stored, and the providers report adds the same', async () => {
    const branch = actor(u.owner, ['reports']);
    const result = await overview.overview(branch, {});
    // The branch reads every sale of the database, other specs' too: only this spec's accounts and providers are asked.
    expect(result.top.providers.filter((row) => row.key.startsWith(name(''))).map((row) => [row.key, row.label, row.count, row.profit])).toEqual([[name('sky'), 'سكاي', 2, 1000], [name('lian'), 'ليان', 1, 500]]);
    expect(result.active.main_agent.filter((row) => row.key === u.main).map((row) => [row.key, row.count, row.profit])).toEqual([[u.main, 3, 1500]]);
    const supply = await insights.supply(branch, {});
    const mine = supply.rows.filter((row) => row.providerCode.startsWith(name('')));
    // Operations of every kind (the freeze too), what they stored as cost, and the branch's stored margin.
    expect(mine).toEqual([
      { providerCode: name('sky'), providerName: 'سكاي', operations: 4, cost: 4 * 2500, profit: 500 + 500 - 250 },
      { providerCode: name('lian'), providerName: 'ليان', operations: 1, cost: 2500, profit: 500 },
    ]);
    expect(Object.keys(supply)).toEqual(['rows', 'totals']);
  });

  it('reports profit by package and the finance summary from the stored margins, by the chain of the sale', async () => {
    const report = await wallets.profitReport(actor(u.agent), {});
    expect(report).toEqual({
      packages: [
        { packageName: '400', companyName: name('cellcom'), sales: 2, refunds: 1, profit: 450, losses: 0, lossAmount: 0 },
        { packageName: '100', companyName: name('wecom'), sales: 1, refunds: 0, profit: 300, losses: 0, lossAmount: 0 },
      ],
      totals: { sales: 3, refunds: 1, profit: 750, losses: 0, lossAmount: 0 },
    });
    expect((await wallets.profitCsv(actor(u.agent), {})).split('\r\n').slice(1, 4)).toEqual([`${name('cellcom')},400,2,1,4.50`, `${name('wecom')},100,1,0,3.00`, ',TOTAL,3,1,7.50']);
    // The point of sale reads its own: 700 a sale, −350 the refund; the moved one keeps its sale.
    expect((await wallets.profitReport(actor(u.pos), {})).totals).toEqual({ sales: 2, refunds: 1, profit: 1050, losses: 0, lossAmount: 0 });
    expect((await wallets.profitReport(actor(u.pos2), {})).totals).toEqual({ sales: 1, refunds: 0, profit: 700, losses: 0, lossAmount: 0 });
    expect((await wallets.profitReport(actor(u.agent2), {})).totals).toEqual({ sales: 0, refunds: 0, profit: 0, losses: 0, lossAmount: 0 });
    expect(await wallets.financeSummary(actor(u.agent), { days: '7' })).toMatchObject({ profit: 750, sales: 3 });
    expect(await wallets.financeSummary(actor(u.agent2), { days: '7' })).toMatchObject({ profit: 0, sales: 0 });
  });

  it('gives each finance row the viewer\'s stored margin, and the branch every account\'s share', async () => {
    const mine = <Row extends { id: string }>(rows: Row[]) => rows.filter((row) => row.id.startsWith(tag));
    // Every entry (`scope=all`): the freeze f1 moved nothing, so the money view, the default, does not list it (point 7).
    const branch = mine((await wallets.finance(actor(u.owner), { scope: 'all' })).items);
    const sale = branch.find((row) => row.id === `${tag}-s1`);
    expect(sale?.margin).toBe(500);
    expect(sale?.shares?.map((share) => [share.layer, share.margin])).toEqual([['branch', 500], ['main_agent', 500], ['agent', 300], ['pos', 700]]);
    expect(branch.find((row) => row.id === `${tag}-f1`)?.shares).toBeNull();
    const agent = mine((await wallets.finance(actor(u.agent), {})).items);
    expect(agent.find((row) => row.id === `${tag}-r1`)).toMatchObject({ margin: -150, shares: null });
    // The list itself is the accounts under the viewer now: the moved point of sale's rows are its new agent's to list,
    // with no margin of its own on them.
    expect(agent.find((row) => row.id === `${tag}-s3`)).toBeUndefined();
    expect(mine((await wallets.finance(actor(u.agent2), {})).items).find((row) => row.id === `${tag}-s3`)?.margin).toBeNull();
  });
});
