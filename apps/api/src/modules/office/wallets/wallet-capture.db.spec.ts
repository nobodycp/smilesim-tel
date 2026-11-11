import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { Prisma } from '../../../generated/prisma/client';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import type { Sale } from '../kernel/types';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';
import type { WalletLedger } from './wallet-ledger';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D10 (plan slice S.4): completing a task turns its hold into its
// charge (`WalletLedger.capture`) instead of releasing the hold and debiting again under the ceiling check. The
// package runs its operations automatically, so here `outcome: 'fail'` opens a task and `outcome: 'success'`
// applies at once.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const RENEWAL = 3200;
const START = 1_000_000;

suite('capturing a task\'s hold (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let ledger: WalletLedger;
  let runTx: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  /** The kinds of notice written, in order: the ledger's notices must stay what they were. */
  let notices: string[] = [];

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const body = (over: Record<string, unknown>) => ({ packageCode: `capt-${tag}`, posLoginName: `capt-${tag}-pos`, ...over });
  const openTask = (over: Record<string, unknown> = {}) => service.activate(pos, body({ outcome: 'fail', iccid: serial(), ...over })) as Promise<{ applied: false; taskId: string }>;
  const activateNow = (over: Record<string, unknown> = {}) => service.activate(pos, body({ outcome: 'success', iccid: serial(), ...over })) as Promise<{ line: { id: string; msisdn: string } }>;
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const setWallet = (data: { balance?: number; held?: number; ceiling?: number }) => prisma.wallet.update({ where: { userId: ids.pos }, data });
  const entryRows = () => prisma.walletEntry.findMany({ where: { userId: ids.pos } });
  const kinds = async () => (await entryRows()).map((row) => row.kind).sort();
  const task = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });

  const outcomes = async (runs: Promise<unknown>[]) => {
    const settled = await Promise.allSettled(runs);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason as unknown);
    return {
      done: settled.filter((result) => result.status === 'fulfilled').length,
      refused: failures.filter((reason) => reason instanceof OfficeFailure).map((reason) => `${(reason as OfficeFailure).status} ${(reason as OfficeFailure).code}`).sort(),
      crashed: failures.filter((reason) => !(reason instanceof OfficeFailure)).map((reason) => String((reason as Error)?.message ?? reason).slice(0, 200)),
    };
  };

  /** What must hold after anything: held is the open tasks' holds, and the balance moved by exactly the entries. */
  const expectWalletAddsUp = async () => {
    const [state, open, moved] = await Promise.all([
      wallet(),
      prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }),
      prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } }),
    ]);
    expect(state.held).toBe(open._sum.held ?? 0);
    expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
    // Every hold entry is matched by a release entry or by a task still open.
    expect(moved._sum.held ?? 0).toBe(state.held);
    return state;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `capt-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: START, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `capt-${tag}`, name: 'capt' } });
    await prisma.company.create({ data: { id: ids.company, code: `capt-${tag}`, name: 'capt' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: RENEWAL, renewalSubscriberPrice: 3500,
    };
    await prisma.package.create({ data: { id: ids.pkg, code: `capt-${tag}`, name: 'capt', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const notice = {
      write: async (_db: unknown, _audience: unknown, _actor: unknown, draft: { kind: string }) => {
        notices.push(draft.kind);
        return [];
      },
      publish: async () => undefined,
    } as unknown as NoticeService;
    service = new OfficeFacade(auth, notice);
    const graph = (service as unknown as { graph: { ledger: WalletLedger; uow: { runTx: typeof runTx } } }).graph;
    ledger = graph.ledger;
    runTx = (run) => graph.uow.runTx(run);
  });

  afterEach(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await setWallet({ balance: START, held: 0, ceiling: 0 });
    notices = [];
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

  it('completes a task whose ceiling was lowered after it opened; a plain debit of the same amount is still refused (spec 17)', async () => {
    // 1,000 in the wallet and a ceiling of 5,000: the price is affordable, on credit, when the task opens.
    await setWallet({ balance: 1000, ceiling: 5000 });
    const { taskId } = await openTask();
    expect(await wallet()).toMatchObject({ balance: 1000, held: PRICE });
    // The parent lowers the ceiling while the task waits.
    await setWallet({ ceiling: 0 });

    // A debit that no hold covers is refused under the new ceiling, with the money still held…
    expect(await outcomes([runTx((tx) => ledger.move(tx, ids.pos, -PRICE, ids.pos, 'activate', ''))])).toMatchObject({ refused: ['400 BALANCE_CEILING'], crashed: [] });
    // …and so is the same debit once the hold is gone: what completion used to do, release and then debit.
    expect(await outcomes([runTx(async (tx) => {
      await ledger.release(tx, ids.pos, PRICE, ids.pos, '');
      await ledger.move(tx, ids.pos, -PRICE, ids.pos, 'activate', '');
    })])).toMatchObject({ refused: ['400 BALANCE_CEILING'], crashed: [] });
    expect(await wallet()).toMatchObject({ balance: 1000, held: PRICE });
    notices = [];

    // The completion captures the hold: no second ceiling check.
    await service.completeTask(owner, taskId, {});
    expect(await wallet()).toMatchObject({ balance: 1000 - PRICE, held: 0, ceiling: 0 });
    expect(await task(taskId)).toMatchObject({ status: 'done' });
    expect(await prisma.line.count({ where: { posId: ids.pos, status: 'active' } })).toBe(1);
    expect(await kinds()).toEqual(['activate', 'hold', 'release']);
    // The wallet went below zero: that notice is still written; the ceiling notice is not.
    expect(notices).toContain('wallet.negative');
    expect(notices).not.toContain('wallet.ceiling');
  });

  it('refuses to capture when the wallet holds less than the task\'s hold, and rolls the whole completion back (spec 18)', async () => {
    const { taskId } = await openTask();
    // Something gave part of this hold back already: the wallet holds less than the task says.
    await setWallet({ held: PRICE - 1 });
    const before = await entryRows();
    expect(await outcomes([service.completeTask(owner, taskId, {})])).toEqual({ done: 0, refused: ['409 DUPLICATE_REQUEST'], crashed: [] });
    // Nothing of the completion stayed: not the claim, not the line, not a release, not a debit.
    expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
    expect(await prisma.line.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: START, held: PRICE - 1 });
    expect(await entryRows()).toEqual(before);
    // With no hold at all in the wallet it is refused the same way.
    await setWallet({ held: 0 });
    expect(await outcomes([service.completeTask(owner, taskId, {})])).toMatchObject({ done: 0, refused: ['409 DUPLICATE_REQUEST'] });
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
  });

  it('takes a debit and a hold of any two sizes: covered up to the hold, the excess checked, the surplus given back', async () => {
    await setWallet({ held: 5000 });
    const capture = (held: number, amount: number) => runTx((tx) => ledger.capture(tx, ids.pos, held, amount, ids.pos, 'switch', ''));
    // Not a debit, not whole numbers, a negative hold: refused, nothing changed.
    for (const [held, amount] of [[100, 0], [100, 100], [-100, -100], [100.5, -100], [100, -99.5]]) {
      expect([held, amount, (await outcomes([capture(held, amount)])).refused]).toEqual([held, amount, ['400 INVALID']]);
    }
    // A hold larger than what the wallet holds was already given back: refused although the debit would fit.
    expect((await outcomes([capture(5001, -100)])).refused).toEqual(['409 DUPLICATE_REQUEST']);
    expect(await wallet()).toMatchObject({ balance: START, held: 5000 });
    expect(await entryRows()).toHaveLength(0);

    // A debit smaller than its hold: the whole hold goes back and only the debit is charged.
    await capture(3000, -2500);
    expect(await wallet()).toMatchObject({ balance: START - 2500, held: 2000 });
    // A debit larger than its hold: the hold goes back and the whole debit is charged (the wallet has the excess).
    await capture(1500, -1800);
    expect(await wallet()).toMatchObject({ balance: START - 2500 - 1800, held: 500 });
    // No hold at all: a plain debit, with one entry and no release.
    await capture(0, -700);
    expect(await wallet()).toMatchObject({ balance: START - 2500 - 1800 - 700, held: 500 });
    expect((await entryRows()).map((row) => [row.kind, row.amount, row.held]).sort()).toEqual([['release', 0, -1500], ['release', 0, -3000], ['switch', -1800, null], ['switch', -2500, null], ['switch', -700, null]].sort());
  });

  it('checks only the excess over the hold against the ceiling, with the hold still counted as held', async () => {
    const capture = (held: number, amount: number) => runTx((tx) => ledger.capture(tx, ids.pos, held, amount, ids.pos, 'switch', ''));
    // 1,000 in the wallet, 800 of it held for this task, no credit.
    await setWallet({ balance: 1000, held: 800, ceiling: 0 });
    // 200 more than the hold fits exactly: 1,000 − 800 held = 200 spendable.
    notices = [];
    expect((await outcomes([capture(800, -1001)])).refused).toEqual(['400 BALANCE_CEILING']);
    expect(notices).toEqual(['wallet.ceiling']);
    expect(await wallet()).toMatchObject({ balance: 1000, held: 800 });
    expect(await entryRows()).toHaveLength(0);
    await capture(800, -1000);
    expect(await wallet()).toMatchObject({ balance: 0, held: 0 });

    // Money held for OTHER tasks is not there for the excess: 1,000 in the wallet, 800 held for this task and
    // 150 for another leaves 50 spendable.
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await setWallet({ balance: 1000, held: 950, ceiling: 0 });
    expect((await outcomes([capture(800, -851)])).refused).toEqual(['400 BALANCE_CEILING']);
    await capture(800, -850);
    expect(await wallet()).toMatchObject({ balance: 150, held: 150 });

    // A ceiling lowered below the debt already owed stops the excess, never the covered part.
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await setWallet({ balance: -2000, held: 800, ceiling: 0 });
    expect((await outcomes([capture(800, -801)])).refused).toEqual(['400 BALANCE_CEILING']);
    await capture(800, -800);
    expect(await wallet()).toMatchObject({ balance: -2800, held: 0 });
  });

  it('charges once when a task is completed twice, or by several at the same moment (spec 18)', async () => {
    const first = await openTask();
    await service.completeTask(owner, first.taskId, {});
    expect(await outcomes([service.completeTask(owner, first.taskId, {})])).toMatchObject({ done: 0, refused: ['400 INVALID'], crashed: [] });

    const second = await openTask();
    const result = await outcomes(Array.from({ length: 6 }, () => service.completeTask(owner, second.taskId, {})));
    expect(result).toEqual({ done: 1, refused: Array.from({ length: 5 }, () => '400 INVALID'), crashed: [] });

    // Two tasks, two lines, two charges, two releases; nothing held.
    expect(await prisma.line.count({ where: { posId: ids.pos } })).toBe(2);
    expect(await kinds()).toEqual(['activate', 'activate', 'hold', 'hold', 'release', 'release']);
    expect(await wallet()).toMatchObject({ balance: START - 2 * PRICE, held: 0 });
    await expectWalletAddsUp();
  });

  it('rolls the settlement back with everything else when the line cannot be created', async () => {
    const iccid = serial();
    const { taskId } = await openTask({ iccid });
    const opened = await task(taskId);
    // Another line takes the serial behind the reservation's back (written straight to the table).
    const intruder = await prisma.line.create({ data: { msisdn: `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, iccid, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(), terms: {} } });
    const before = await entryRows();
    expect(await outcomes([service.completeTask(owner, taskId, {})])).toEqual({ done: 0, refused: ['409 SIM_TAKEN'], crashed: [] });
    expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
    expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    expect(await entryRows()).toEqual(before);

    // The same when the number is what was taken: the failure comes from the insert itself, after the checks.
    await prisma.line.update({ where: { id: intruder.id }, data: { iccid: serial(), msisdn: opened.msisdn as string } });
    expect(await outcomes([service.completeTask(owner, taskId, {})])).toEqual({ done: 0, refused: ['409 NUMBER_TAKEN'], crashed: [] });
    expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
    expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    expect(await entryRows()).toEqual(before);

    // Once the way is clear the task completes and is charged once.
    await prisma.line.delete({ where: { id: intruder.id } });
    await service.completeTask(owner, taskId, {});
    expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
  });

  it('writes the same ledger rows as a release followed by a debit: amounts, balances, provider cost and the price ladder', async () => {
    const made = await activateNow();
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await setWallet({ balance: START, held: 0 });
    const line = await prisma.line.findUniqueOrThrow({ where: { id: made.line.id } });
    const sale: Sale = { msisdn: line.msisdn, lineId: line.id, companyName: 'capt', packageName: 'capt', packagePrice: RENEWAL, providerCost: 1800, period: { days: 30, endsAt: new Date('2026-12-10T00:00:00Z') } };
    const ROLLBACK = new Error('rolled back on purpose');
    /** Holds, settles one way or the other, and answers what the transaction would have left; then rolls it back. */
    const rowsOf = async (settle: (tx: Prisma.TransactionClient) => Promise<void>) => {
      let seen: { entries: unknown[]; wallet: unknown } | null = null;
      await runTx(async (tx) => {
        await ledger.hold(tx, ids.pos, RENEWAL, ids.pos, 'note', sale);
        await settle(tx);
        const entries = await tx.walletEntry.findMany({ where: { userId: ids.pos } });
        // Rows written in one transaction share its time: order them by what they are.
        const order = ['hold', 'release', 'extend'];
        seen = {
          entries: entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map((row) => ({ ...row, id: 'any', createdAt: null })),
          wallet: await tx.wallet.findUniqueOrThrow({ where: { userId: ids.pos } }),
        };
        throw ROLLBACK;
      }).catch((error: unknown) => (error === ROLLBACK ? undefined : Promise.reject(error)));
      return seen as unknown as { entries: Record<string, unknown>[]; wallet: unknown };
    };
    const before = await rowsOf(async (tx) => {
      await ledger.release(tx, ids.pos, RENEWAL, ids.pos, 'done by hand');
      await ledger.move(tx, ids.pos, -RENEWAL, ids.pos, 'extend', 'done by hand', sale);
    });
    const after = await rowsOf((tx) => ledger.capture(tx, ids.pos, RENEWAL, -RENEWAL, ids.pos, 'extend', 'done by hand', sale));
    expect(after).toEqual(before);
    // And they are what a sale is made of: the three rows, the charge with its cost and a ladder that has the layers.
    expect(after.entries.map((row) => [row.kind, row.amount, row.held, row.balanceAfter])).toEqual([['hold', 0, RENEWAL, START], ['release', 0, -RENEWAL, START], ['extend', -RENEWAL, null, START - RENEWAL]]);
    expect(after.entries[2]).toMatchObject({ packagePrice: RENEWAL, providerCost: 1800, periodDays: 30, lineId: line.id, msisdn: line.msisdn });
    expect(after.entries[2].ladder).not.toBeNull();
    expect(await entryRows()).toHaveLength(0);
  });

  it('keeps balance, held and entries in step through a mix of openings, completions, rejections, cancellations and renewals', async () => {
    const lines = await Promise.all([activateNow(), activateNow()]);
    const tasks = await Promise.all(Array.from({ length: 5 }, () => openTask()));
    const renewal = (await service.extend(pos, lines[0].line.id, { outcome: 'fail' })) as { taskId: string };
    await expectWalletAddsUp();
    expect((await task(renewal.taskId)).held).toBe(RENEWAL);

    await service.completeTask(owner, tasks[0].taskId, {});
    await service.rejectTask(owner, tasks[1].taskId, { reason: 'no stock' });
    await service.cancelTask(pos, tasks[2].taskId);
    await service.completeTask(owner, renewal.taskId, {});
    await service.completeTask(owner, tasks[3].taskId, {});
    // tasks[4] stays open.
    const state = await expectWalletAddsUp();
    expect(state).toMatchObject({ balance: START - 2 * PRICE - 2 * PRICE - RENEWAL, held: PRICE });
    const byKind = (await entryRows()).reduce<Record<string, number>>((count, row) => ({ ...count, [row.kind]: (count[row.kind] ?? 0) + 1 }), {});
    // Six holds; five gave way (two captured activations, the captured renewal, a rejection, a cancellation).
    expect(byKind).toEqual({ activate: 4, extend: 1, hold: 6, release: 5 });
    // Each charge is the price fixed when its task opened.
    const charges = (await entryRows()).filter((row) => row.amount < 0).map((row) => [row.kind, row.amount, row.packagePrice]).sort();
    expect(charges).toEqual([['activate', -PRICE, PRICE], ['activate', -PRICE, PRICE], ['activate', -PRICE, PRICE], ['activate', -PRICE, PRICE], ['extend', -RENEWAL, RENEWAL]]);
  });

  it('never deadlocks: completions capturing, openings holding, cancellations and rejections releasing, on one wallet', async () => {
    for (let round = 0; round < 10; round += 1) {
      const open = await Promise.all(Array.from({ length: 6 }, () => openTask()));
      const line = await activateNow();
      const renewal = (await service.extend(pos, line.line.id, { outcome: 'fail' })) as { taskId: string };
      const result = await outcomes([
        service.completeTask(owner, open[0].taskId, {}),
        service.completeTask(owner, open[1].taskId, {}),
        service.completeTask(owner, open[1].taskId, {}),
        service.rejectTask(owner, open[2].taskId, { reason: 'no stock' }),
        service.cancelTask(pos, open[3].taskId),
        // One task, completed and cancelled at once: one of the two.
        service.completeTask(owner, open[4].taskId, {}),
        service.cancelTask(pos, open[4].taskId),
        service.completeTask(owner, renewal.taskId, {}),
        openTask(),
        openTask(),
        activateNow(),
      ]);
      expect(result.crashed).toEqual([]);
      // What was refused was a repeat or the loser of a pair, never a ceiling: there is money for all of it.
      expect(result.refused.every((refusal) => refusal === '400 INVALID')).toBe(true);
      expect(result.refused.length).toBe(2);
      await expectWalletAddsUp();
      const done = await prisma.officeTask.count({ where: { posId: ids.pos, status: 'done' } });
      const charged = (await entryRows()).filter((row) => row.amount < 0 && (row.kind === 'activate' || row.kind === 'extend')).length;
      // One charge per completed task, plus the two lines sold at once.
      expect(charged).toBe(done + 2);
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
      await prisma.line.deleteMany({ where: { posId: ids.pos } });
      await setWallet({ balance: START, held: 0 });
    }
  });
});
