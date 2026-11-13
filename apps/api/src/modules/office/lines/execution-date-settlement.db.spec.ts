import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { ApiFailure } from '../../shared/api-failure';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';

// PostgreSQL only (TEST_DATABASE_URL). The two operations whose money is the money of the day they are carried
// out (owner's rule, 2026-11-10; rule 1.5 of backend-engineering.mdc): a package switch's difference and a
// disconnect's refund. Both are the value of the days still left, and a task may wait for days, so neither is
// fixed when the task opens. Every other operation charges the price fixed at opening.
//
// A switch task holds what was quoted when it opened and the amount of the day is settled against that hold
// (ADR 0019, D10); a disconnect task holds nothing and its refund is a credit.
//
// Packages run their operations automatically, so here `outcome: 'fail'` opens a task and `outcome: 'success'`
// applies at once. Time is moved by pulling the line's paid period back by whole days.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const START = 1_000_000;
const BASE_PRICE = 3000;
/** The day a line is sold counts as used: a new 30-day period has 29 days left to value. */
const LEFT = 29;
/**
 * What a switch from the base package to one priced `target` costs the point of sale after `daysPassed`: the
 * days left valued at the new price, less the same days at the price paid. Negative is money back.
 */
const owed = (target: number, daysPassed = 0, paid = BASE_PRICE) => Math.round((target * (LEFT - daysPassed)) / 30) - Math.round((paid * (LEFT - daysPassed)) / 30);
const QUOTED = owed(6000);
const DISCONNECT_FEE = 50;
/** What a disconnect gives back after `daysPassed`: the days left at the price paid, less the half-shekel fee. */
const refund = (daysPassed = 0) => Math.round((BASE_PRICE * (LEFT - daysPassed)) / 30) - DISCONNECT_FEE;

suite('money of the day of execution: switch and disconnect (PostgreSQL)', () => {
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), base: randomUUID(), dearer: randomUUID(), cheaper: randomUUID() };
  const code = { base: `sw-${tag}-base`, dearer: `sw-${tag}-dearer`, cheaper: `sw-${tag}-cheaper` };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  let breakNotices = false;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const setWallet = (data: { balance?: number; held?: number; ceiling?: number }) => prisma.wallet.update({ where: { userId: ids.pos }, data });
  const entries = () => prisma.walletEntry.findMany({ where: { userId: ids.pos } });
  const lineOf = (id: string) => prisma.line.findUniqueOrThrow({ where: { id } });
  const taskOf = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  /** A new line on the base package, sold at once, with the wallet and the ledger then cleared of that sale. */
  const newLine = async () => {
    const made = (await service.activate(pos, { packageCode: code.base, posLoginName: `sw-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { line: { id: string } };
    // Keep the activation row (it carries the paid period) but take its money out of the picture.
    await prisma.walletEntry.updateMany({ where: { lineId: made.line.id, kind: 'activate' }, data: { amount: 0 } });
    await setWallet({ balance: START, held: 0, ceiling: 0 });
    return made.line.id;
  };
  /** `days` pass: the paid period and the line end that much sooner. */
  const passDays = async (lineId: string, days: number) => {
    await prisma.$executeRaw`UPDATE "WalletEntry" SET "periodEndsAt" = "periodEndsAt" - make_interval(days => ${days}) WHERE "lineId" = ${lineId} AND "periodEndsAt" IS NOT NULL`;
    await prisma.$executeRaw`UPDATE "Line" SET "endsAt" = "endsAt" - make_interval(days => ${days}) WHERE "id" = ${lineId}`;
  };
  const openSwitch = (lineId: string, to: string) => service.switchPackage(pos, lineId, { packageCode: to, outcome: 'fail' }) as Promise<{ applied: false; taskId: string }>;
  const switchNow = (lineId: string, to: string) => service.switchPackage(pos, lineId, { packageCode: to, outcome: 'success' });
  const complete = (taskId: string) => service.completeTask(owner, taskId, {});
  const openDisconnect = (lineId: string) => service.operate(pos, lineId, 'disconnect', { outcome: 'fail' }) as Promise<{ applied: false; taskId: string }>;
  const disconnectNow = (lineId: string) => service.operate(pos, lineId, 'disconnect', { outcome: 'success' });
  const entryOf = async (lineId: string, kind: string) => (await entries()).filter((row) => row.lineId === lineId && row.kind === kind);
  const priceOf = (id: string, renewalPosPrice: number) => prisma.package.update({ where: { id }, data: { renewalPosPrice } });
  const switchEntry = async () => (await entries()).filter((row) => row.kind === 'switch');

  const outcomes = async (runs: Promise<unknown>[]) => {
    const settled = await Promise.allSettled(runs);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason as unknown);
    return {
      done: settled.filter((result) => result.status === 'fulfilled').length,
      refused: failures.filter((reason) => reason instanceof ApiFailure).map((reason) => `${(reason as ApiFailure).status} ${(reason as ApiFailure).code}`).sort(),
      crashed: failures.filter((reason) => !(reason instanceof ApiFailure)).map((reason) => String((reason as Error)?.message ?? reason).slice(0, 200)),
    };
  };

  /** Held is the open tasks' holds; the balance moved by exactly the entries; holds and releases cancel out. */
  const expectWalletAddsUp = async () => {
    const [state, open, moved] = await Promise.all([
      wallet(),
      prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }),
      prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } }),
    ]);
    expect(state.held).toBe(open._sum.held ?? 0);
    expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
    expect(moved._sum.held ?? 0).toBe(state.held);
    return state;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `sw-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: START, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `sw-${tag}`, name: 'sw' } });
    await prisma.company.create({ data: { id: ids.company, code: `sw-${tag}`, name: 'sw' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const pkg = (id: string, pkgCode: string, pos: number, cost: number) => prisma.package.create({
      data: {
        id, code: pkgCode, name: pkgCode, providerId: ids.provider, companyId: ids.company, ...auto,
        branchCost: cost, mainPrice: cost + 300, agentPrice: cost + 600, posPrice: pos, subscriberPrice: pos + 300,
        renewalBranchCost: cost, renewalMainPrice: cost + 300, renewalAgentPrice: cost + 600, renewalPosPrice: pos, renewalSubscriberPrice: pos + 300,
      },
    });
    await pkg(ids.base, code.base, 3000, 1800);
    await pkg(ids.dearer, code.dearer, 6000, 3600);
    await pkg(ids.cheaper, code.cheaper, 1500, 900);
    await prisma.packageSwitch.createMany({ data: [{ packageId: ids.base, targetPackageId: ids.dearer }, { packageId: ids.base, targetPackageId: ids.cheaper }] });
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
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await setWallet({ balance: START, held: 0, ceiling: 0 });
    await priceOf(ids.dearer, 6000);
    await priceOf(ids.cheaper, 1500);
    breakNotices = false;
  });

  afterAll(async () => {
    await prisma.packageSwitch.deleteMany({ where: { packageId: ids.base } });
    await prisma.package.deleteMany({ where: { id: { in: [ids.base, ids.dearer, ids.cheaper] } } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('holds the difference quoted when the task opens', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    const task = await taskOf(taskId);
    // The dearer package costs 6,000 a period against 3,000 paid, for the 29 days left.
    expect(QUOTED).toBe(2900);
    expect(task).toMatchObject({ action: 'switch', status: 'working', posDelta: -QUOTED, held: QUOTED, nextPackageId: ids.dearer });
    expect(await wallet()).toMatchObject({ balance: START, held: QUOTED });
  });

  it('charges the difference of the day it is completed, not of the day it opened, and gives the rest of the hold back', async () => {
    const lineId = await newLine();
    const twin = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    // The task waits ten days: a third of the period is used up, on both lines.
    await passDays(lineId, 10);
    await passDays(twin, 10);
    await complete(taskId);

    const [charge] = await switchEntry();
    // Less than what was held, because fewer days are left to pay the difference for.
    expect(charge.amount).toBeLessThan(0);
    expect(-charge.amount).toBeLessThan(QUOTED);
    expect(charge.amount).toBe(-owed(6000, 10));
    expect(owed(6000, 10)).toBe(1900);
    expect(await wallet()).toMatchObject({ balance: START - 1900, held: 0 });
    expect((await entries()).filter((row) => row.kind === 'release').map((row) => row.held)).toEqual([-QUOTED]);
    expect(await taskOf(taskId)).toMatchObject({ status: 'done', posDelta: -1900 });
    expect(await lineOf(lineId)).toMatchObject({ packageId: ids.dearer });

    // It is exactly what a switch applied at once costs that same day: amount, price, provider cost and ladder.
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos, kind: { in: ['hold', 'release'] } } });
    await switchNow(twin, code.dearer);
    const [byTask, atOnce] = (await switchEntry()).sort((a, b) => (a.lineId === lineId ? -1 : 1) - (b.lineId === lineId ? -1 : 1));
    const money = (row: typeof byTask) => ({ amount: row.amount, packagePrice: row.packagePrice, providerCost: row.providerCost, periodDays: row.periodDays, packageName: row.packageName, hasLadder: row.ladder !== null });
    expect(money(byTask)).toEqual(money(atOnce));
    // The branch's side of the same days: 3,600 a period against 1,800.
    expect(byTask.providerCost).toBe(owed(3600, 10, 1800));
  });

  it('checks only the increase when the difference grew, and completes when the wallet covers it', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    // The target's price rises while the task waits: the difference is now twice what is held.
    await priceOf(ids.dearer, 9000);
    const now = owed(9000);
    expect(now).toBe(2 * QUOTED);
    // The wallet has the hold and exactly the increase, no credit.
    await setWallet({ balance: now, ceiling: 0 });
    await complete(taskId);
    expect(await wallet()).toMatchObject({ balance: 0, held: 0 });
    expect((await switchEntry()).map((row) => [row.amount, row.packagePrice])).toEqual([[-now, 9000]]);
    expect(await lineOf(lineId)).toMatchObject({ packageId: ids.dearer });
  });

  it('refuses, and changes neither the line nor the task, when the wallet cannot cover the increase', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    const before = { line: await lineOf(lineId), entries: await entries() };
    await priceOf(ids.dearer, 9000);
    const now = owed(9000);
    // One agora short of the increase.
    await setWallet({ balance: now - 1, ceiling: 0 });
    expect(await outcomes([complete(taskId)])).toEqual({ done: 0, refused: ['400 BALANCE_CEILING'], crashed: [] });
    expect(await taskOf(taskId)).toMatchObject({ status: 'working', held: QUOTED, posDelta: -QUOTED });
    expect(await lineOf(lineId)).toEqual(before.line);
    expect(await wallet()).toMatchObject({ balance: now - 1, held: QUOTED });
    expect(await entries()).toEqual(before.entries);
    // Money held for another task does not pay for it either: 3,000 more is in the wallet, and it is held elsewhere.
    await setWallet({ balance: now + 3000 - 1, held: QUOTED + 3000 });
    expect(await outcomes([complete(taskId)])).toMatchObject({ done: 0, refused: ['400 BALANCE_CEILING'] });
    // With the increase covered it completes, and the other hold is untouched.
    await setWallet({ balance: now + 3000, held: QUOTED + 3000 });
    await complete(taskId);
    expect(await wallet()).toMatchObject({ balance: 3000, held: 3000 });
  });

  it('is not stopped by a ceiling lowered after it opened while the amount stays within the hold', async () => {
    const lineId = await newLine();
    await setWallet({ balance: 500, ceiling: 5000 });
    const { taskId } = await openSwitch(lineId, code.dearer);
    await setWallet({ ceiling: 0 });
    await passDays(lineId, 10);
    await complete(taskId);
    // 1,900 charged on credit that the hold had already secured.
    expect(await wallet()).toMatchObject({ balance: 500 - owed(6000, 10), held: 0 });
  });

  it('gives the whole hold back and posts no debit when nothing is owed any more, or money is due back', async () => {
    // The target became as cheap as the line's package: nothing to pay.
    const even = await newLine();
    const evenTask = await openSwitch(even, code.dearer);
    await priceOf(ids.dearer, 3000);
    await complete(evenTask.taskId);
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    expect((await switchEntry()).map((row) => row.amount)).toEqual([0]);
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });

    // The target became cheaper than the line's package: the hold goes back and the difference is credited.
    await priceOf(ids.dearer, 6000);
    const less = await newLine();
    const lessTask = await openSwitch(less, code.dearer);
    expect((await wallet()).held).toBe(QUOTED);
    await priceOf(ids.dearer, 1500);
    const back = -owed(1500);
    expect(back).toBe(1450);
    await complete(lessTask.taskId);
    expect(await wallet()).toMatchObject({ balance: START + back, held: 0 });
    expect((await entries()).filter((row) => row.kind !== 'activate').map((row) => [row.kind, row.amount, row.held]).sort()).toEqual([['hold', 0, QUOTED], ['release', 0, -QUOTED], ['switch', back, null]]);
  });

  it('credits the refund of the day for a switch to a cheaper package, which holds nothing', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.cheaper);
    expect(await taskOf(taskId)).toMatchObject({ posDelta: -owed(1500), held: 0 });
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    await passDays(lineId, 10);
    await complete(taskId);
    // Ten days fewer to refund: less comes back than was quoted.
    const back = -owed(1500, 10);
    expect(back).toBe(950);
    expect(back).toBeLessThan(-owed(1500));
    expect(await wallet()).toMatchObject({ balance: START + back, held: 0 });
    expect(await taskOf(taskId)).toMatchObject({ status: 'done', posDelta: back });
    expect((await entries()).some((row) => row.kind === 'release' || row.kind === 'hold')).toBe(false);
  });

  it('checks the whole debit when a switch that was a refund at opening costs money at completion', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.cheaper);
    await priceOf(ids.cheaper, 4000);
    const now = owed(4000);
    expect(now).toBeGreaterThan(0);
    await setWallet({ balance: now - 1, ceiling: 0 });
    expect(await outcomes([complete(taskId)])).toEqual({ done: 0, refused: ['400 BALANCE_CEILING'], crashed: [] });
    expect(await lineOf(lineId)).toMatchObject({ packageId: ids.base });
    await setWallet({ balance: now });
    await complete(taskId);
    expect(await wallet()).toMatchObject({ balance: 0, held: 0 });
  });

  it('charges once when the task is completed twice, by several at once, or against a cancellation', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    const result = await outcomes(Array.from({ length: 6 }, () => complete(taskId)));
    expect(result).toEqual({ done: 1, refused: Array.from({ length: 5 }, () => '400 INVALID'), crashed: [] });
    expect((await switchEntry()).map((row) => row.amount)).toEqual([-QUOTED]);
    expect(await wallet()).toMatchObject({ balance: START - QUOTED, held: 0 });
    expect(await outcomes([complete(taskId)])).toMatchObject({ done: 0, refused: ['400 INVALID'] });
    await expectWalletAddsUp();

    // Completed and cancelled at the same moment: either it was switched and charged, or the hold went back.
    for (let round = 0; round < 6; round += 1) {
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
      const other = await newLine();
      const raced = await openSwitch(other, code.dearer);
      const pair = await outcomes([complete(raced.taskId), service.cancelTask(pos, raced.taskId)]);
      expect(pair).toMatchObject({ done: 1, refused: ['400 INVALID'], crashed: [] });
      const [task, line, state] = await Promise.all([taskOf(raced.taskId), lineOf(other), wallet()]);
      if (task.status === 'done') expect([line.packageId, state.balance, state.held]).toEqual([ids.dearer, START - QUOTED, 0]);
      else expect([task.status, line.packageId, state.balance, state.held]).toEqual(['cancelled', ids.base, START, 0]);
    }
  });

  it('rolls the charge back with everything else when the completion fails after the money moved', async () => {
    const lineId = await newLine();
    const { taskId } = await openSwitch(lineId, code.dearer);
    const before = { line: await lineOf(lineId), entries: await entries() };
    breakNotices = true;
    const result = await outcomes([complete(taskId)]);
    expect(result.done).toBe(0);
    expect(result.crashed.join()).toContain('notices are down');
    expect(await taskOf(taskId)).toMatchObject({ status: 'working', held: QUOTED });
    expect(await lineOf(lineId)).toEqual(before.line);
    expect(await wallet()).toMatchObject({ balance: START, held: QUOTED });
    expect(await entries()).toEqual(before.entries);
  });

  it('keeps the wallet in step through switches up and down, delays, a refusal and a cancellation, with no deadlock', async () => {
    for (let round = 0; round < 6; round += 1) {
      const lines = await Promise.all(Array.from({ length: 5 }, () => newLine()));
      // newLine clears the wallet after each sale; start this round from a clean ledger.
      await prisma.walletEntry.updateMany({ where: { userId: ids.pos }, data: { amount: 0 } });
      await setWallet({ balance: START, held: 0 });
      const up = await Promise.all([openSwitch(lines[0], code.dearer), openSwitch(lines[1], code.dearer), openSwitch(lines[2], code.dearer)]);
      const down = await openSwitch(lines[3], code.cheaper);
      await Promise.all([passDays(lines[0], 10), passDays(lines[3], 20)]);
      const result = await outcomes([
        complete(up[0].taskId),
        complete(up[1].taskId),
        complete(up[1].taskId),
        service.cancelTask(pos, up[2].taskId),
        complete(down.taskId),
        openSwitch(lines[4], code.dearer),
      ]);
      expect(result.crashed).toEqual([]);
      expect(result.refused).toEqual(['400 INVALID']);
      const state = await expectWalletAddsUp();
      // Ten days late, on time, twenty days late to a cheaper package (money back); one switch still open.
      expect(state).toMatchObject({ balance: START - owed(6000, 10) - owed(6000) - owed(1500, 20), held: QUOTED });
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
      await prisma.line.deleteMany({ where: { posId: ids.pos } });
      await setWallet({ balance: START, held: 0 });
    }
  });
  it('charges a switch less for every day its task waited: the amount follows the day it is completed', async () => {
    const delays = [0, 3, 12, 25];
    const charged: number[] = [];
    for (const days of delays) {
      const lineId = await newLine();
      const { taskId } = await openSwitch(lineId, code.dearer);
      // Whatever the delay, the same amount was quoted and held on the day the task opened.
      expect(await taskOf(taskId)).toMatchObject({ posDelta: -QUOTED, held: QUOTED });
      await passDays(lineId, days);
      await complete(taskId);
      const [entry] = await entryOf(lineId, 'switch');
      expect([days, entry.amount]).toEqual([days, -owed(6000, days)]);
      expect(await taskOf(taskId)).toMatchObject({ status: 'done', posDelta: -owed(6000, days) });
      charged.push(-entry.amount);
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos, kind: { in: ['hold', 'release', 'switch'] } } });
      await setWallet({ balance: START, held: 0 });
    }
    expect(charged).toEqual([2900, 2600, 1700, 400]);
    // Strictly less with each longer wait, and never the amount of the opening day once a day has passed.
    expect([...charged].sort((a, b) => b - a)).toEqual(charged);
    expect(new Set(charged).size).toBe(delays.length);
  });

  it('opens a disconnect task that fixes no refund and holds nothing', async () => {
    const lineId = await newLine();
    const quoted = await service.disconnectQuote(pos, lineId);
    expect(quoted.amount).toBe(refund());
    const { taskId } = await openDisconnect(lineId);
    expect(await taskOf(taskId)).toMatchObject({ action: 'disconnect', status: 'working', posDelta: 0, held: 0 });
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    expect(await lineOf(lineId)).toMatchObject({ status: 'active' });
    expect(await entryOf(lineId, 'disconnect')).toHaveLength(0);
  });

  it('refunds a disconnect by the day its task is completed: less for every day it waited', async () => {
    const delays = [0, 3, 12, 25];
    const refunded: number[] = [];
    for (const days of delays) {
      const lineId = await newLine();
      const quotedAtOpening = (await service.disconnectQuote(pos, lineId)).amount;
      const { taskId } = await openDisconnect(lineId);
      await passDays(lineId, days);
      await complete(taskId);
      const [entry] = await entryOf(lineId, 'disconnect');
      expect([days, entry.amount]).toEqual([days, refund(days)]);
      // What was shown when the task opened is not what is paid once days have passed.
      expect(quotedAtOpening).toBe(refund(0));
      if (days > 0) expect(entry.amount).toBeLessThan(quotedAtOpening);
      // The provider's side moves with the same day: the days used so far, plus the fee.
      expect(entry.providerCost).toBe(Math.round((1800 * (30 - (LEFT - days))) / 30) + DISCONNECT_FEE);
      expect(await taskOf(taskId)).toMatchObject({ status: 'done', posDelta: refund(days) });
      expect(await lineOf(lineId)).toMatchObject({ status: 'disconnected' });
      // The wallet (reset for each line by `newLine`) moved by that refund and nothing else.
      expect(await wallet()).toMatchObject({ balance: START + refund(days), held: 0 });
      refunded.push(entry.amount);
    }
    expect(refunded).toEqual([2850, 2550, 1650, 350]);
    expect([...refunded].sort((a, b) => b - a)).toEqual(refunded);
  });

  it('refunds from a task exactly what a disconnect applied at once refunds that same day', async () => {
    const lineId = await newLine();
    const twin = await newLine();
    const { taskId } = await openDisconnect(lineId);
    await passDays(lineId, 8);
    await passDays(twin, 8);
    await complete(taskId);
    await disconnectNow(twin);
    const [[byTask], [atOnce]] = await Promise.all([entryOf(lineId, 'disconnect'), entryOf(twin, 'disconnect')]);
    const money = (row: typeof byTask) => ({ amount: row.amount, packagePrice: row.packagePrice, providerCost: row.providerCost, packageName: row.packageName, hasLadder: row.ladder !== null });
    expect(money(byTask)).toEqual(money(atOnce));
    expect(byTask.amount).toBe(refund(8));
  });

  it('refunds nothing, and still disconnects, when the paid period ran out while the task waited', async () => {
    const lineId = await newLine();
    const { taskId } = await openDisconnect(lineId);
    await passDays(lineId, 31);
    await complete(taskId);
    expect(await lineOf(lineId)).toMatchObject({ status: 'disconnected' });
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    expect((await entryOf(lineId, 'disconnect')).map((row) => row.amount)).toEqual([0]);
  });

  it('refunds once when a disconnect task is completed twice, by several at once, or against a disconnect applied at once', async () => {
    const lineId = await newLine();
    const { taskId } = await openDisconnect(lineId);
    await passDays(lineId, 5);
    const result = await outcomes(Array.from({ length: 6 }, () => complete(taskId)));
    expect(result).toEqual({ done: 1, refused: Array.from({ length: 5 }, () => '400 INVALID'), crashed: [] });
    expect(await outcomes([complete(taskId)])).toMatchObject({ done: 0, refused: ['400 INVALID'] });
    expect((await entryOf(lineId, 'disconnect')).map((row) => row.amount)).toEqual([refund(5)]);
    expect(await wallet()).toMatchObject({ balance: START + refund(5), held: 0 });

    // The task is completed while the same line is disconnected at once: one refund, whoever got there first.
    for (let round = 0; round < 6; round += 1) {
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
      const other = await newLine();
      const raced = await openDisconnect(other);
      const pair = await outcomes([complete(raced.taskId), disconnectNow(other)]);
      expect(pair.crashed).toEqual([]);
      expect(pair.done).toBe(1);
      expect(await lineOf(other)).toMatchObject({ status: 'disconnected' });
      expect((await entryOf(other, 'disconnect')).map((row) => row.amount)).toEqual([refund()]);
      expect(await wallet()).toMatchObject({ balance: START + refund(), held: 0 });
    }
  });

  it('rolls a disconnect\'s refund back with everything else when the completion fails after the money moved', async () => {
    const lineId = await newLine();
    const { taskId } = await openDisconnect(lineId);
    await passDays(lineId, 4);
    const before = { line: await lineOf(lineId), entries: await entries() };
    breakNotices = true;
    const result = await outcomes([complete(taskId)]);
    expect(result.done).toBe(0);
    expect(result.crashed.join()).toContain('notices are down');
    expect(await taskOf(taskId)).toMatchObject({ status: 'working', posDelta: 0 });
    expect(await lineOf(lineId)).toEqual(before.line);
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    expect(await entries()).toEqual(before.entries);
    // The next completion pays the refund of its own day, once.
    await complete(taskId);
    expect((await entryOf(lineId, 'disconnect')).map((row) => row.amount)).toEqual([refund(4)]);
  });

  it('still charges the price fixed at opening for an operation that is not a switch or a disconnect, however long it waited', async () => {
    const lineId = await newLine();
    const renewal = (await service.extend(pos, lineId, { outcome: 'fail' })) as { taskId: string };
    const held = (await taskOf(renewal.taskId)).held;
    expect(held).toBe(BASE_PRICE);
    // The renewal price changes and twenty days pass before the branch gets to it.
    await prisma.package.update({ where: { id: ids.base }, data: { renewalPosPrice: 4500 } });
    await passDays(lineId, 20);
    await complete(renewal.taskId);
    expect((await entryOf(lineId, 'extend')).map((row) => row.amount)).toEqual([-BASE_PRICE]);
    expect(await wallet()).toMatchObject({ balance: START - BASE_PRICE, held: 0 });
    await prisma.package.update({ where: { id: ids.base }, data: { renewalPosPrice: 3000 } });
  });
});
