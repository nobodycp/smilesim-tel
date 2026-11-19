import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { PrismaClient } from '../../../generated/prisma/client';
import { visibleAccountIds } from '../../access/account-visibility';
import type { Actor } from '../../access/types';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { expiringWhere, suspendedWhere } from '../../sales/rules/line-filters';
import { taskWhereFor } from '../../tasks/task-access';
import { ServiceGraph } from '../../testing/service-graph';
import { DeskRepository } from './desk.repository';
import { OverviewService } from './overview.service';

// PostgreSQL only (TEST_DATABASE_URL). Database plan DB.11: the overview counts the stored line statuses and the task
// statuses with one grouped read each. Its `lines` and `tasks` must stay key for key and number for number what the
// separate counts gave. The oracle below is the old computation, kept as it was: one count per status over the
// viewer's point-of-sale id list, and one count per task status. Seeded: every stored status (`suspended` stored too),
// lines inside and outside the expiring window (one a minute inside its edge), suspended under two package periods,
// a frozen point of sale, every task status, and a task the viewer sees only as its submitter.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const TASK_STATUSES = ['working', 'done', 'rejected', 'cancelled'];

suite('the overview\'s grouped counts (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const digits = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const ids = {
    owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos1: randomUUID(), pos2: randomUUID(), pos3: randomUUID(),
    provider: randomUUID(), short: randomUUID(), long: randomUUID(),
  };
  const actor = (id: string, layer: string): Actor => ({ id, loginName: `oc-${tag}-${id.slice(0, 4)}`, nickname: layer, layer, isBranchOwner: false, grants: [], operatorId: id, impersonating: false });
  const viewers = [actor(ids.owner, 'branch'), actor(ids.main, 'main_agent'), actor(ids.agent, 'agent'), actor(ids.pos1, 'pos'), actor(ids.pos3, 'pos')];
  let prisma: PrismaClient;
  let graph: ServiceGraph;
  let overview: OverviewService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    graph = new ServiceGraph(new MemoryAuthStore());
    graph.prismaClient = prisma;
    overview = new OverviewService(graph.tree, {} as never, {} as never, {} as never, new DeskRepository(graph.uow));

    const user = (id: string, layer: string, parentId: string | null, disabledAt: Date | null = null) => ({
      id, loginName: `oc-${tag}-${layer}-${id.slice(0, 4)}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner: id === ids.owner, disabledAt,
    });
    for (const row of [
      user(ids.owner, 'branch', null), user(ids.main, 'main_agent', ids.owner), user(ids.agent, 'agent', ids.main),
      user(ids.pos1, 'pos', ids.agent), user(ids.pos2, 'pos', ids.agent, new Date('2026-11-01T00:00:00Z')), user(ids.pos3, 'pos', ids.main),
    ]) await prisma.user.create({ data: row });
    await prisma.provider.create({ data: { id: ids.provider, code: `oc-${tag}`, name: `oc-${tag}` } });
    const pkg = (id: string, suspendAfterDays: number) => ({
      id, code: `oc-${tag}-${suspendAfterDays}`, name: `oc-${tag}-${suspendAfterDays}`, providerId: ids.provider, suspendAfterDays,
      branchCost: 1, mainPrice: 1, agentPrice: 1, posPrice: 1, subscriberPrice: 1, renewalBranchCost: 1, renewalMainPrice: 1, renewalAgentPrice: 1, renewalPosPrice: 1, renewalSubscriberPrice: 1,
      autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false,
    });
    await prisma.postpaidPackage.createMany({ data: [pkg(ids.short, 30), pkg(ids.long, 90)] });
    const day = 86_400_000;
    const now = Date.now();
    let n = 0;
    const line = (posId: string, status: string, packageId: string, endsAt: number) => ({ msisdn: `058${digits}${(n += 1).toString().padStart(2, '0')}`, status, posId, packageId, terms: {}, endsAt: new Date(endsAt) });
    await prisma.postpaidLine.createMany({
      data: [
        line(ids.pos1, 'active', ids.long, now + 30 * day),
        line(ids.pos1, 'active', ids.long, now + 1 * day), // expiring
        line(ids.pos1, 'active', ids.long, now + 3 * day - 60_000), // expiring, a minute inside the edge
        line(ids.pos1, 'active', ids.long, now + 3 * day + 3_600_000), // not yet
        line(ids.pos1, 'active', ids.long, now - 1 * day), // ended, neither expiring nor suspended
        line(ids.pos1, 'active', ids.short, now - 40 * day), // suspended under a 30-day period
        line(ids.pos1, 'active', ids.long, now - 40 * day), // not under a 90-day one
        line(ids.pos1, 'suspended', ids.long, now - 100 * day), // stored suspended, and past its period
        line(ids.pos1, 'frozen', ids.long, now + 10 * day),
        line(ids.pos1, 'disconnected', ids.long, now - 5 * day),
        line(ids.pos2, 'active', ids.long, now + 2 * day), // a frozen point of sale's line, expiring
        line(ids.pos2, 'frozen', ids.short, now - 50 * day),
        line(ids.pos3, 'active', ids.short, now + 20 * day),
        line(ids.pos3, 'disconnected', ids.short, now - 50 * day),
      ],
    });
    const task = (status: string, posId: string, submitterId: string, minutesAgo: number) => ({
      action: 'activate', status, posId, submitterId, packageId: ids.long, posDelta: 0, createdAt: new Date(now - minutesAgo * 60_000 - 20_000),
    });
    await prisma.task.createMany({
      data: [
        task('working', ids.pos1, ids.pos1, 90), task('working', ids.pos2, ids.pos2, 30), task('done', ids.pos1, ids.pos1, 10),
        task('rejected', ids.pos1, ids.agent, 5), task('cancelled', ids.pos2, ids.pos2, 5), task('done', ids.pos3, ids.pos3, 5),
        task('working', ids.pos3, ids.agent, 15), // the agent submitted it on a point of sale outside its tree
      ],
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { packageId: { in: [ids.short, ids.long] } } });
    await prisma.postpaidLine.deleteMany({ where: { packageId: { in: [ids.short, ids.long] } } });
    await prisma.postpaidPackage.deleteMany({ where: { id: { in: [ids.short, ids.long] } } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.pos3, ids.pos2, ids.pos1, ids.agent, ids.main, ids.owner] } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  /** The old computation (before DB.10 and DB.11), as the overview ran it: separate counts over the id list. */
  async function oracle(viewer: Actor, now: Date) {
    const accounts = await graph.tree.accounts();
    const visible = visibleAccountIds(viewer.id, viewer.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const scope = { posId: { in: posIds } };
    const periods = (await prisma.postpaidPackage.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } })).map((row) => row.suspendAfterDays);
    const [active, expiring, frozen, disconnected, suspended] = await Promise.all([
      prisma.postpaidLine.count({ where: { posId: { in: posIds }, status: 'active' } }),
      prisma.postpaidLine.count({ where: { AND: [scope, expiringWhere(now)] } }),
      prisma.postpaidLine.count({ where: { posId: { in: posIds }, status: 'frozen' } }),
      prisma.postpaidLine.count({ where: { posId: { in: posIds }, status: 'disconnected' } }),
      prisma.postpaidLine.count({ where: { AND: [scope, suspendedWhere(periods, now)] } }),
    ]);
    const where = taskWhereFor(viewer, accounts);
    const counts = await Promise.all(TASK_STATUSES.map((status) => prisma.task.count({ where: { AND: [where, { status }] } })));
    const oldest = await prisma.task.findFirst({ where: { AND: [where, { status: 'working' }] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      lines: { active: Math.max(0, active - expiring - suspended), expiring, frozen, disconnected, suspended },
      tasks: { ...Object.fromEntries(TASK_STATUSES.map((status, index) => [status, counts[index]])), oldestOpenMinutes: oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 60_000)) : null },
    };
  }

  it.each(viewers.map((viewer) => [viewer.layer, viewer]))('gives a %s the same line and task counts as the separate counts did', async (_layer, viewer) => {
    const result = await overview.overview(viewer, { period: 'month' });
    const expected = await oracle(viewer, new Date());
    expect(result.lines).toEqual(expected.lines);
    // The oldest open task's wait is in minutes from each read's own clock: equal, or one apart across a minute.
    const { oldestOpenMinutes, ...tasks } = result.tasks;
    const { oldestOpenMinutes: expectedMinutes, ...expectedTasks } = expected.tasks;
    expect(tasks).toEqual(expectedTasks);
    expect(Object.keys(result.tasks)).toEqual([...TASK_STATUSES, 'oldestOpenMinutes']);
    expect(Math.abs((oldestOpenMinutes ?? -1) - (expectedMinutes ?? -1))).toBeLessThanOrEqual(1);
  });

  it('pins the seeded numbers for the agent, whose tree holds only seeded rows', async () => {
    const { lines, tasks } = await overview.overview(actor(ids.agent, 'agent'), { period: 'month' });
    // pos1 and pos2: 8 stored active (3 expiring, pos2's included; 1 suspended), 1 stored suspended (suspended too),
    // frozen 2, disconnected 1. The active slice takes both suspended lines off, as it always has.
    expect(lines).toEqual({ active: 8 - 3 - 2, expiring: 3, frozen: 2, disconnected: 1, suspended: 2 });
    expect(tasks).toEqual({ working: 3, done: 1, rejected: 1, cancelled: 1, oldestOpenMinutes: 90 });
  });
});
