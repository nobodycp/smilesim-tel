import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';
import { STORED_TASK_STATUSES } from './task-status';

// PostgreSQL only (TEST_DATABASE_URL). Speed plan PF.5: GET /v1/tasks/counts answers the tasks screen's tabs from
// one grouped count, with the list's own visibility (`taskWhereFor`). Each layer is shown its own numbers, and each
// number is the list's total for that status. The branch reads every task in the database, so its numbers are
// compared with its list, not with fixed values.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('task counts by status (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos1: randomUUID(), pos2: randomUUID(),
    provider: randomUUID(), company: randomUUID(), pkg: randomUUID(),
  };
  const sessions: Record<'owner' | 'main' | 'agent' | 'pos1' | 'pos2', { sessionId: string }> = {} as never;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let serial = 0;

  const task = (posId: string, submitterId: string, status: string) => ({
    action: 'charge', status, posId, submitterId, packageId: ids.pkg, posDelta: 0,
    msisdn: `05${tag.replace(/\D/g, '0').slice(0, 4)}${String(serial++).padStart(4, '0')}`,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const people = [
      { id: ids.owner, layer: 'branch', parentId: null, isBranchOwner: true, name: 'owner' },
      { id: ids.main, layer: 'main', parentId: ids.owner, isBranchOwner: false, name: 'main' },
      { id: ids.agent, layer: 'agent', parentId: ids.main, isBranchOwner: false, name: 'agent' },
      { id: ids.pos1, layer: 'pos', parentId: ids.agent, isBranchOwner: false, name: 'pos1' },
      // A point of sale on another chain: the main agent and the agent above pos1 do not see it.
      { id: ids.pos2, layer: 'pos', parentId: ids.owner, isBranchOwner: false, name: 'pos2' },
    ] as const;
    for (const person of people) {
      const row = { id: person.id, loginName: `cnt-${tag}-${person.name}`, nickname: person.name, passwordHash: 'x', layer: person.layer, parentId: person.parentId, isBranchOwner: person.isBranchOwner };
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
      sessions[person.name] = { sessionId: await auth.saveSession({ userId: person.id, scope: 'full', userAgent: '', ip: '' }) };
    }
    await prisma.provider.create({ data: { id: ids.provider, code: `cnt-${tag}`, name: 'cnt' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code: `cnt-${tag}`, name: 'cnt' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code: `cnt-${tag}`, name: 'cnt', providerId: ids.provider, companyId: ids.company, ...prices, autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true } });
    await prisma.task.createMany({
      data: [
        ...['working', 'working', 'working', 'done', 'done', 'rejected', 'cancelled'].map((status) => task(ids.pos1, ids.pos1, status)),
        task(ids.pos2, ids.pos2, 'working'),
        task(ids.pos2, ids.pos2, 'done'),
        // Submitted by the main agent for a point of sale it does not see: it reads it as its submitter.
        task(ids.pos2, ids.main, 'done'),
      ],
    });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { packageId: ids.pkg } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    const people = [ids.pos1, ids.pos2, ids.agent, ids.main, ids.owner];
    await prisma.wallet.deleteMany({ where: { userId: { in: people } } });
    for (const id of people) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  /** Each count is the list's total for its status, and together they are the whole list. */
  async function expectListTotals(who: keyof typeof sessions) {
    const counts = await service.taskCounts(sessions[who]);
    expect(Object.keys(counts).sort()).toEqual([...STORED_TASK_STATUSES].sort());
    // The list filters by working, done and cancelled; `rejected` is in the whole list's total.
    for (const status of ['working', 'done', 'cancelled'] as const) {
      expect([status, (await service.tasks(sessions[who], { status })).total]).toEqual([status, counts[status]]);
    }
    const all = (await service.tasks(sessions[who])).total;
    expect(STORED_TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0)).toBe(all);
    return counts;
  }

  it('shows each layer the counts of the tasks it may read', async () => {
    const ofPos1 = { working: 3, done: 2, rejected: 1, cancelled: 1 };
    expect(await expectListTotals('pos1')).toEqual(ofPos1);
    expect(await expectListTotals('agent')).toEqual(ofPos1);
    expect(await expectListTotals('main')).toEqual({ ...ofPos1, done: 3 });
    expect(await expectListTotals('pos2')).toEqual({ working: 1, done: 2, rejected: 0, cancelled: 0 });
  });

  it('shows the branch every task, the same numbers as its list', async () => {
    const counts = await expectListTotals('owner');
    expect(counts.working).toBeGreaterThanOrEqual(4);
    expect(counts.done).toBeGreaterThanOrEqual(4);
  });

  it('counts in one grouped query, not one per status', async () => {
    const client = (service as unknown as { prisma: { task: Record<string, unknown> } }).prisma.task;
    const spied = { groupBy: jest.spyOn(client as never, 'groupBy' as never), count: jest.spyOn(client as never, 'count' as never) };
    try {
      await service.taskCounts(sessions.main);
      expect(spied.groupBy).toHaveBeenCalledTimes(1);
      expect(spied.count).not.toHaveBeenCalled();
    } finally {
      spied.groupBy.mockRestore();
      spied.count.mockRestore();
    }
  });
});
