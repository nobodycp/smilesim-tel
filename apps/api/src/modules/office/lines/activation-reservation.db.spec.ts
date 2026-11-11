import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';

// PostgreSQL only (TEST_DATABASE_URL). An open activation task reserves its SIM serial and its number (ADR 0019,
// D5; plan slice S.2): what the database refuses, what the service answers, and that no money is held for a
// request that is refused. The package runs activation automatically, so in this test environment
// `outcome: 'fail'` opens a task (the manual route) and `outcome: 'success'` creates the line at once.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;

suite('activation reservations (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  /** Set to make the next notice write fail: an error after the task and the hold are written. */
  let breakNotices = false;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const body = (over: Record<string, unknown>) => ({ packageCode: `resv-${tag}`, posLoginName: `resv-${tag}-pos`, ...over });
  /** Opens an activation task (the manual route). */
  const openTask = (over: Record<string, unknown>) => service.activate(pos, body({ outcome: 'fail', ...over })) as Promise<{ applied: false; taskId: string }>;
  /** Creates the line at once. */
  const activateNow = (over: Record<string, unknown>) => service.activate(pos, body({ outcome: 'success', ...over }));
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const openTasks = () => prisma.officeTask.findMany({ where: { posId: ids.pos, action: 'activate', status: 'working' } });
  const entries = (kind: string) => prisma.walletEntry.count({ where: { userId: ids.pos, kind } });

  const outcomes = async (runs: Promise<unknown>[]) => {
    const settled = await Promise.allSettled(runs);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason as unknown);
    return {
      done: settled.filter((result) => result.status === 'fulfilled').length,
      refused: failures.filter((reason) => reason instanceof OfficeFailure).map((reason) => `${(reason as OfficeFailure).status} ${(reason as OfficeFailure).code}`).sort(),
      // Anything that is not a refusal the service chose: a deadlock, a constraint surfacing raw, a crash.
      crashed: failures.filter((reason) => !(reason instanceof OfficeFailure)).map((reason) => String((reason as Error)?.message ?? reason).slice(0, 200)),
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `resv-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: 1_000_000, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `resv-${tag}`, name: 'resv' } });
    await prisma.company.create({ data: { id: ids.company, code: `resv-${tag}`, name: 'resv' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.package.create({ data: { id: ids.pkg, code: `resv-${tag}`, name: 'resv', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const notice = {
      write: async () => {
        if (breakNotices) {
          breakNotices = false;
          throw new Error('notices are down');
        }
        return [];
      },
      publish: async () => undefined,
    } as unknown as NoticeService;
    service = new OfficeFacade(auth, notice);
  });

  afterEach(async () => {
    // Each test starts from no tasks, no lines, nothing held and a full wallet.
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: 1_000_000, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('is refused by the database itself: a second open activation task for one serial, or for one number', async () => {
    const row = (over: Record<string, unknown>) => ({ action: 'activate', status: 'working', posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: -PRICE, held: 0, ...over });
    const iccid = serial();
    const msisdn = number();
    const first = await prisma.officeTask.create({ data: row({ iccid, msisdn }) });
    // Straight to the table, past every lock and check of the service.
    await expect(prisma.officeTask.create({ data: row({ iccid, msisdn: number() }) })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.officeTask.create({ data: row({ iccid: serial(), msisdn }) })).rejects.toMatchObject({ code: 'P2002' });
    // Changing an open task onto a reserved serial is refused the same way.
    const other = await prisma.officeTask.create({ data: row({ iccid: serial(), msisdn: number() }) });
    await expect(prisma.officeTask.update({ where: { id: other.id }, data: { iccid } })).rejects.toMatchObject({ code: 'P2002' });
    // Only an open activation reserves: a SIM-swap task, a closed activation, and tasks with no serial or number do not.
    await prisma.officeTask.create({ data: row({ action: 'sim', iccid, msisdn }) });
    await prisma.officeTask.create({ data: row({ status: 'done', iccid, msisdn }) });
    await prisma.officeTask.create({ data: row({ status: 'cancelled', iccid, msisdn }) });
    await prisma.officeTask.create({ data: row({ iccid: null, msisdn: null }) });
    await prisma.officeTask.create({ data: row({ iccid: null, msisdn: null }) });
    // The reservation ends when the task leaves `working`, with no other write.
    await prisma.officeTask.update({ where: { id: first.id }, data: { status: 'cancelled' } });
    await prisma.officeTask.create({ data: row({ iccid, msisdn }) });
  });

  it('opens one task and holds once when ten activations name one serial at the same moment', async () => {
    const iccid = serial();
    const result = await outcomes(Array.from({ length: 10 }, () => openTask({ iccid })));
    expect(result).toEqual({ done: 1, refused: Array.from({ length: 9 }, () => '409 SIM_TAKEN'), crashed: [] });
    expect(await openTasks()).toMatchObject([{ iccid, held: PRICE, posDelta: -PRICE, unitPrice: PRICE }]);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });
    expect(await entries('hold')).toBe(1);
  });

  it('opens one task and holds once when ten activations ask for one number at the same moment', async () => {
    const msisdn = number();
    const result = await outcomes(Array.from({ length: 10 }, () => openTask({ iccid: serial(), msisdn })));
    expect(result).toEqual({ done: 1, refused: Array.from({ length: 9 }, () => '409 NUMBER_TAKEN'), crashed: [] });
    expect(await openTasks()).toMatchObject([{ msisdn, held: PRICE }]);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });
    expect(await entries('hold')).toBe(1);
  });

  it('refuses a direct activation, a SIM swap and a number change that would take what an open task has reserved', async () => {
    const iccid = serial();
    const msisdn = number();
    await openTask({ iccid, msisdn });
    expect(await outcomes([activateNow({ iccid })])).toMatchObject({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
    expect(await outcomes([activateNow({ iccid: serial(), msisdn })])).toMatchObject({ done: 0, refused: ['409 NUMBER_TAKEN'], crashed: [] });
    // No line, and no money moved beyond the one hold.
    expect(await prisma.line.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });

    // An existing line may not move onto the reserved serial or the reserved number either. This package leaves a
    // SIM swap and a number change to the branch: the request opens a task that names what it wants (such a task
    // reserves nothing), and the refusal comes when the branch completes it.
    const made = (await activateNow({ iccid: serial() })) as { line: { id: string } };
    const lineBefore = await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } });
    const swap = (await service.swapSim(pos, made.line.id, { iccid, outcome: 'success' })) as { applied: boolean; taskId: string };
    const rename = (await service.renameLine(pos, made.line.id, { outcome: 'success' })) as { applied: boolean; taskId: string };
    expect([swap.applied, rename.applied]).toEqual([false, false]);
    expect(await outcomes([service.completeTask(owner, swap.taskId, {})])).toMatchObject({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
    expect(await outcomes([service.completeTask(owner, rename.taskId, { msisdn })])).toMatchObject({ done: 0, refused: ['409 NUMBER_TAKEN'], crashed: [] });
    // The line is as it was, and both tasks are still open for the branch to reject.
    expect(await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } })).toMatchObject({ iccid: lineBefore.iccid, msisdn: lineBefore.msisdn });
    expect((await prisma.officeTask.findMany({ where: { id: { in: [swap.taskId, rename.taskId] } } })).map((task) => task.status)).toEqual(['working', 'working']);
    // With a free card and a free number the same completions go through: the line's own serial and number do not
    // stand in its way.
    await service.rejectTask(owner, swap.taskId, { reason: 'reserved by another sale' });
    const freeCard = serial();
    const freeNumber = number();
    const again = (await service.swapSim(pos, made.line.id, { iccid: freeCard, outcome: 'success' })) as { taskId: string };
    await service.completeTask(owner, again.taskId, {});
    await service.completeTask(owner, rename.taskId, { msisdn: freeNumber });
    expect(await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } })).toMatchObject({ iccid: freeCard, msisdn: freeNumber });
  });

  it('refuses the same when the package runs a SIM swap and a number change at once, with no task in between', async () => {
    const iccid = serial();
    const msisdn = number();
    await openTask({ iccid, msisdn });
    const made = (await activateNow({ iccid: serial() })) as { line: { id: string } };
    const lineBefore = await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } });
    await prisma.package.update({ where: { id: ids.pkg }, data: { actionModes: { sim: 'auto', rename: 'auto' } } });
    try {
      expect(await outcomes([service.swapSim(pos, made.line.id, { iccid, outcome: 'success' })])).toEqual({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
      expect(await outcomes([service.renameLine(pos, made.line.id, { msisdn, outcome: 'success' })])).toEqual({ done: 0, refused: ['409 NUMBER_TAKEN'], crashed: [] });
      expect(await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } })).toMatchObject({ iccid: lineBefore.iccid, msisdn: lineBefore.msisdn });
      // A free card and a free number are taken at once.
      const freeCard = serial();
      const freeNumber = number();
      expect(await service.swapSim(pos, made.line.id, { iccid: freeCard, outcome: 'success' })).toMatchObject({ applied: true });
      expect(await service.renameLine(pos, made.line.id, { msisdn: freeNumber, outcome: 'success' })).toMatchObject({ applied: true });
      expect(await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } })).toMatchObject({ iccid: freeCard, msisdn: freeNumber });
    } finally {
      await prisma.package.update({ where: { id: ids.pkg }, data: { actionModes: {} } });
    }
  });

  it('refuses to open a task for a serial a live line holds or a number a line has, and holds nothing', async () => {
    const iccid = serial();
    const made = (await activateNow({ iccid })) as { line: { id: string; msisdn: string } };
    const after = await wallet();
    expect(await outcomes([openTask({ iccid })])).toMatchObject({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
    expect(await outcomes([openTask({ iccid: serial(), msisdn: made.line.msisdn })])).toMatchObject({ done: 0, refused: ['409 NUMBER_TAKEN'], crashed: [] });
    expect(await openTasks()).toHaveLength(0);
    expect(await wallet()).toMatchObject({ balance: after.balance, held: 0 });
    expect(await entries('hold')).toBe(0);
  });

  it('gives one serial to a task or to a line, never both, when they ask at the same moment', async () => {
    for (let round = 0; round < 8; round += 1) {
      const iccid = serial();
      const result = await outcomes([openTask({ iccid }), activateNow({ iccid })]);
      expect(result).toEqual({ done: 1, refused: ['409 SIM_TAKEN'], crashed: [] });
      const [tasks, lines] = await Promise.all([prisma.officeTask.count({ where: { iccid, status: 'working' } }), prisma.line.count({ where: { iccid } })]);
      expect(tasks + lines).toBe(1);
    }
  });

  it('frees the serial and the number when the task is rejected or cancelled, and gives the hold back once', async () => {
    const iccid = serial();
    const msisdn = number();
    const first = await openTask({ iccid, msisdn });
    await service.rejectTask(owner, first.taskId, { reason: 'no stock' });
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 0 });
    const second = await openTask({ iccid, msisdn });
    expect(await wallet()).toMatchObject({ held: PRICE });
    await service.cancelTask(pos, second.taskId);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 0 });
    await openTask({ iccid, msisdn });
    expect(await openTasks()).toHaveLength(1);
    expect([await entries('hold'), await entries('release')]).toEqual([3, 2]);
  });

  it('hands the serial and the number to the line when the task is completed', async () => {
    const iccid = serial();
    const msisdn = number();
    const { taskId } = await openTask({ iccid, msisdn });
    await service.completeTask(owner, taskId, {});
    expect(await prisma.line.findMany({ where: { posId: ids.pos } })).toMatchObject([{ iccid, msisdn, status: 'active' }]);
    expect(await wallet()).toMatchObject({ balance: 1_000_000 - PRICE, held: 0 });
    expect(await openTasks()).toHaveLength(0);
    // The reservation is over in the table (a raw row is accepted again); the line is what refuses now.
    const raw = await prisma.officeTask.create({ data: { action: 'activate', status: 'working', posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: 0, iccid, msisdn } });
    await prisma.officeTask.delete({ where: { id: raw.id } });
    expect(await outcomes([openTask({ iccid })])).toMatchObject({ refused: ['409 SIM_TAKEN'] });
    expect(await outcomes([openTask({ iccid: serial(), msisdn })])).toMatchObject({ refused: ['409 NUMBER_TAKEN'] });
  });

  it('refuses to complete a task onto a serial another open task has reserved meanwhile', async () => {
    // An eSIM activation has no serial until the branch hands one back; another sale reserves that serial first.
    const waiting = await openTask({ esim: true, iccid: '' });
    const iccid = serial();
    await openTask({ iccid });
    expect(await outcomes([service.completeTask(owner, waiting.taskId, { iccid })])).toMatchObject({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
    // Nothing of the completion stayed: the task is open, its hold is held, no line was made.
    expect(await prisma.officeTask.findUniqueOrThrow({ where: { id: waiting.taskId } })).toMatchObject({ status: 'working' });
    expect(await prisma.line.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 2 * PRICE + (await prisma.officeTask.findUniqueOrThrow({ where: { id: waiting.taskId } })).held - PRICE });
  });

  it('holds nothing and leaves no task when the wallet cannot cover the price', async () => {
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: PRICE - 1, held: 0 } });
    const iccid = serial();
    expect(await outcomes([openTask({ iccid })])).toEqual({ done: 0, refused: ['400 BALANCE_CEILING'], crashed: [] });
    // The task was written before the hold was refused: the transaction took it back.
    expect(await prisma.officeTask.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: PRICE - 1, held: 0 });
    expect(await entries('hold')).toBe(0);
    // And the serial is not reserved by a task that never existed.
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: 1_000_000 } });
    await openTask({ iccid });
    expect(await wallet()).toMatchObject({ held: PRICE });
  });

  it('rolls everything back when an error comes after the task and the hold were written', async () => {
    const iccid = serial();
    const msisdn = number();
    breakNotices = true;
    const result = await outcomes([openTask({ iccid, msisdn })]);
    expect(result.done).toBe(0);
    expect(result.crashed.join()).toContain('notices are down');
    expect(await prisma.officeTask.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 0 });
    expect(await entries('hold')).toBe(0);
    // Neither the serial nor the number stayed reserved.
    await openTask({ iccid, msisdn });
    expect(await wallet()).toMatchObject({ held: PRICE });
  });

  it('never deadlocks: openings, completions, cancellations and direct activations on overlapping serials and one wallet', async () => {
    for (let round = 0; round < 12; round += 1) {
      const shared = serial();
      const handed = serial();
      const sharedNumber = number();
      // Two tasks already open: one to complete with a serial handed back, one to cancel.
      const esimTask = await openTask({ esim: true, iccid: '' });
      const toCancel = await openTask({ iccid: serial() });
      const result = await outcomes([
        // The branch completes the eSIM task onto `handed` (task → keys → wallet)…
        service.completeTask(owner, esimTask.taskId, { iccid: handed }),
        // …while the same point of sale asks for `handed` in new requests (keys → wallet).
        openTask({ iccid: handed }),
        activateNow({ iccid: handed }),
        openTask({ iccid: shared, msisdn: sharedNumber }),
        openTask({ iccid: shared }),
        activateNow({ iccid: serial(), msisdn: sharedNumber }),
        service.cancelTask(pos, toCancel.taskId),
        openTask({ iccid: serial() }),
        activateNow({ iccid: serial() }),
      ]);
      // Every request ended in an answer the service chose: done, or a 409. No deadlock, no raw database error.
      expect(result.crashed).toEqual([]);
      expect(result.refused.every((refusal) => refusal === '409 SIM_TAKEN' || refusal === '409 NUMBER_TAKEN')).toBe(true);
      // One holder each, whoever won.
      for (const iccid of [shared, handed]) {
        const [tasks, lines] = await Promise.all([prisma.officeTask.count({ where: { iccid, action: 'activate', status: 'working' } }), prisma.line.count({ where: { iccid, status: { not: 'disconnected' } } })]);
        expect(tasks + lines).toBe(1);
      }
      const [numberTasks, numberLines] = await Promise.all([prisma.officeTask.count({ where: { msisdn: sharedNumber, action: 'activate', status: 'working' } }), prisma.line.count({ where: { msisdn: sharedNumber } })]);
      expect(numberTasks + numberLines).toBe(1);
      // The wallet adds up: what is held is the open tasks' holds, and the balance fell by the lines sold.
      const [state, open, sold] = await Promise.all([wallet(), prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }), prisma.walletEntry.aggregate({ where: { userId: ids.pos, kind: 'activate' }, _sum: { amount: true } })]);
      expect(state.held).toBe(open._sum.held ?? 0);
      expect(state.balance).toBe(1_000_000 + (sold._sum.amount ?? 0));
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
      await prisma.line.deleteMany({ where: { posId: ids.pos } });
      await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: 1_000_000, held: 0 } });
    }
  });
});
