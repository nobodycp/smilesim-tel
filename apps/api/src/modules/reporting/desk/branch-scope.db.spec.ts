import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { LineReads } from '../../sales/line-reads';
import { expiringWhere, suspendedWhere } from '../../sales/rules/line-filters';
import { LinesRepository } from '../../sales/lines.repository';
import { ServiceGraph } from '../../testing/service-graph';
import { DeskRepository } from './desk.repository';
import { DeskService } from './desk.service';
import { OverviewService } from './overview.service';

// PostgreSQL only (TEST_DATABASE_URL). Database plan DB.10: the branch's numbers list, overview and desk send no
// point-of-sale id list. Before, the branch sent every account of layer `pos` (`visibleAccountIds` gives the branch
// every account: frozen ones and its own staff included; the filter on `pos` left the staff out). A line is only ever
// opened on or moved to a point of sale, and an operation entry is written on the line's point of sale, so the list
// excluded no row. This pins it on the real database: the branch's answers equal the ones the id list gave (the
// oracle), and still hold a line of a frozen point of sale and one four levels down.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the branch sends no point-of-sale id list (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const digits = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const ids = { owner: randomUUID(), staff: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID(), frozen: randomUUID(), provider: randomUUID(), pkg: randomUUID() };
  const actor = (id: string, layer: string): Actor => ({ id, loginName: `bs-${tag}-${id.slice(0, 4)}`, nickname: layer, layer, isBranchOwner: false, grants: [], operatorId: id, impersonating: false });
  const branch = actor(ids.owner, 'branch');
  let prisma: PrismaClient;
  let lines: LineReads;
  let desk: DeskService;
  let overview: OverviewService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    const repo = new DeskRepository(graph.uow);
    lines = new LineReads(graph.tree, new LinesRepository(graph.uow));
    desk = new DeskService(graph.tree, repo);
    overview = new OverviewService(graph.tree, {} as never, {} as never, {} as never, repo);

    const user = (id: string, layer: string, parentId: string | null, disabledAt: Date | null = null) => ({
      id, loginName: `bs-${tag}-${layer}-${id.slice(0, 4)}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner: id === ids.owner, disabledAt,
    });
    for (const row of [
      user(ids.owner, 'branch', null), user(ids.staff, 'branch', ids.owner), user(ids.main, 'main_agent', ids.owner), user(ids.agent, 'agent', ids.main),
      user(ids.pos, 'pos', ids.agent), user(ids.frozen, 'pos', ids.agent, new Date('2026-11-01T00:00:00Z')),
    ]) await prisma.user.create({ data: row });
    await prisma.provider.create({ data: { id: ids.provider, code: `bs-${tag}`, name: `bs-${tag}` } });
    await prisma.postpaidPackage.create({
      data: {
        id: ids.pkg, code: `bs-${tag}`, name: `bs-${tag}`, providerId: ids.provider, branchCost: 1, mainPrice: 1, agentPrice: 1, posPrice: 1, subscriberPrice: 1,
        renewalBranchCost: 1, renewalMainPrice: 1, renewalAgentPrice: 1, renewalPosPrice: 1, renewalSubscriberPrice: 1, autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false,
      },
    });
    const day = 86_400_000;
    const line = (n: number, posId: string, status: string, endsInDays: number) => ({
      msisdn: `059${digits}${n}`, status, posId, packageId: ids.pkg, terms: {}, endsAt: new Date(Date.now() + endsInDays * day),
    });
    await prisma.postpaidLine.createMany({
      data: [
        line(1, ids.pos, 'active', 30), line(2, ids.pos, 'active', 1), line(3, ids.pos, 'frozen', 30), line(4, ids.pos, 'active', -200),
        line(5, ids.frozen, 'active', 30), line(6, ids.frozen, 'disconnected', -10),
      ],
    });
    const seeded = await prisma.postpaidLine.findMany({ where: { packageId: ids.pkg }, select: { id: true, posId: true } });
    await prisma.walletEntry.createMany({
      data: seeded.map((row, index) => ({ userId: row.posId, actorId: row.posId, amount: 0, balanceAfter: 0, kind: 'freeze', providerId: ids.provider, providerCost: 0, lineId: row.id, createdAt: new Date(Date.now() + 60_000 + index) })),
    });
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.pos, ids.frozen] } } });
    await prisma.postpaidLine.deleteMany({ where: { packageId: ids.pkg } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.frozen, ids.pos, ids.agent, ids.main, ids.staff, ids.owner] } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  /** What the branch's id list held: every account of layer `pos` (frozen ones too). */
  const everyPos = async () => (await prisma.user.findMany({ where: { layer: 'pos' }, select: { id: true } })).map((row) => row.id);

  it('the list the branch sent held every point of sale, frozen and deep ones too, and no staff', async () => {
    const list = await everyPos();
    expect(list).toEqual(expect.arrayContaining([ids.pos, ids.frozen]));
    expect(list).not.toContain(ids.staff);
    // No line and no line operation belongs to an account outside that list: dropping it shows no new row.
    expect(await prisma.postpaidLine.count({ where: { posId: { notIn: list } } })).toBe(0);
    expect(await prisma.walletEntry.count({ where: { userId: { notIn: list }, kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } } })).toBe(0);
  });

  it('the numbers list: the branch\'s total equals the id list\'s, and it holds every seeded line', async () => {
    const list = await everyPos();
    const all = await lines.list(branch, {});
    expect(all.total).toBe(await prisma.postpaidLine.count({ where: { posId: { in: list } } }));
    const found = await lines.list(branch, { q: `059${digits}` });
    expect(found.items.map((row) => row.msisdn).sort()).toEqual([1, 2, 3, 4, 5, 6].map((n) => `059${digits}${n}`));
    for (const status of ['active', 'frozen', 'disconnected', 'expiring', 'suspended']) {
      const { total } = await lines.list(branch, { status, q: `059${digits}` });
      const { total: deep } = await lines.list(actor(ids.agent, 'agent'), { status, q: `059${digits}` });
      expect([status, total]).toEqual([status, deep]);
    }
  });

  it('the desk and the overview: the branch\'s counts equal the ones the id list gave', async () => {
    const list = await everyPos();
    const home = await desk.home(branch);
    expect(home.activeLines).toBe(await prisma.postpaidLine.count({ where: { posId: { in: list }, status: 'active' } }));
    expect(home.inactiveLines).toBe(await prisma.postpaidLine.count({ where: { posId: { in: list }, status: 'disconnected' } }));
    const latest = await prisma.walletEntry.findMany({
      where: { userId: { in: list }, kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } },
      orderBy: { createdAt: 'desc' }, take: 8, select: { id: true },
    });
    expect(home.operations.map((row) => row.id)).toEqual(latest.map((row) => row.id));
    // The overview's donut, the old way: five counts over the id list (the lines' end dates are days from now).
    const now = new Date();
    const scope = { posId: { in: list } };
    const periods = (await prisma.postpaidPackage.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } })).map((row) => row.suspendAfterDays);
    const [active, expiring, frozen, disconnected, suspended] = await Promise.all([
      prisma.postpaidLine.count({ where: { ...scope, status: 'active' } }),
      prisma.postpaidLine.count({ where: { AND: [scope, expiringWhere(now)] } }),
      prisma.postpaidLine.count({ where: { ...scope, status: 'frozen' } }),
      prisma.postpaidLine.count({ where: { ...scope, status: 'disconnected' } }),
      prisma.postpaidLine.count({ where: { AND: [scope, suspendedWhere(periods, now)] } }),
    ]);
    const { lines: counts } = await overview.overview(branch, { period: 'all' });
    expect(counts).toEqual({ active: Math.max(0, active - expiring - suspended), expiring, frozen, disconnected, suspended });
  });
});
