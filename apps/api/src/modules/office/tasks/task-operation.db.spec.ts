import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import { UnitOfWork } from '../kernel/unit-of-work';
import { operationKey } from '../lines/activation-settlement.rules';
import type { NoticeService } from '../notices/notice.service';
import { ProviderOperationsRepository } from '../providers/operations/provider-operations.repository';
import { ProviderOperationsService } from '../providers/operations/provider-operations.service';
import { OfficeFacade } from '../testing/office-facade';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D6 and D7; transactions T8 and T9; spec items 8 to 10 (the
// manual side) and 14 to 16; plan slice S.7. What a task's provider operation allows on the task: completion by
// hand and reject only with no operation or a failed one; cancel also while the operation is `requested`, closing
// it as abandoned in the same transaction as the release. No sale records an operation yet, so each test opens a
// real task through the service (the task, its reservation and its hold) and writes the operation by hand.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;

type State = 'requested' | 'requested-after-attempt' | 'pending' | 'unknown' | 'unapplied' | 'exception' | 'failed';
const IN_FLIGHT: State[] = ['requested', 'requested-after-attempt', 'pending', 'unknown', 'unapplied', 'exception'];

suite('what a task\'s provider operation allows on the manual path (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(180_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let operations: ProviderOperationsService;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  /** Set to make the next notice write fail: an error after the task, the operation and the wallet were written. */
  let breakNotices = false;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const openTask = async () => ((await service.activate(pos, { packageCode: `top-${tag}`, posLoginName: `top-${tag}-pos`, outcome: 'fail', iccid: serial() })) as { taskId: string }).taskId;
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const task = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  const operationOf = (taskId: string) => prisma.providerOperation.findUniqueOrThrow({ where: { taskId } });
  const kinds = async () => (await prisma.walletEntry.findMany({ where: { userId: ids.pos } })).map((row) => row.kind).sort();
  const lines = () => prisma.line.count({ where: { posId: ids.pos } });
  const refusal = (run: Promise<unknown>) => run.then(() => 'done', (error: unknown) => (error instanceof OfficeFailure ? `${error.status} ${error.code}` : Promise.reject(error)));

  /** Writes the task's operation in the given state, as the dispatcher, a settlement or recovery would have left it. */
  const operationIn = async (taskId: string, state: State) => {
    const soon = new Date(Date.now() + 60_000);
    const shape: Record<State, Record<string, unknown>> = {
      requested: { status: 'requested', attempts: 0 },
      // An attempt that never left was put back: nothing is at the provider.
      'requested-after-attempt': { status: 'requested', attempts: 1, lastAttemptAt: new Date(), lastError: 'unreachable' },
      pending: { status: 'pending', attempts: 1, lastAttemptAt: new Date(), leaseUntil: soon },
      unknown: { status: 'unknown', attempts: 1, lastAttemptAt: new Date(), sentAt: new Date(), lastError: 'timeout' },
      unapplied: { status: 'succeeded', attempts: 1, providerRef: 'ref-1', resultMsisdn: '0500000009' },
      exception: { status: 'succeeded', attempts: 1, providerRef: 'ref-1', applyError: 'number-taken', applyFailedAt: new Date() },
      failed: { status: 'failed', attempts: 1, lastError: 'refused' },
    };
    const row = await prisma.providerOperation.create({
      data: { idempotencyKey: operationKey(taskId), requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: `top-${tag}`, taskId, ...shape[state] } as never,
    });
    return row.id;
  };
  /** Everything a refused action must leave as it was. */
  const snapshot = async (taskId: string) => ({ task: await task(taskId), operation: await operationOf(taskId), wallet: await wallet(), kinds: await kinds(), lines: await lines() });

  /** What must hold after anything: held is the open tasks' holds, and the balance moved by exactly the entries. */
  const expectWalletAddsUp = async () => {
    const [state, open, moved] = await Promise.all([
      wallet(),
      prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }),
      prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } }),
    ]);
    expect(state.held).toBe(open._sum.held ?? 0);
    expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
    expect(moved._sum.held ?? 0).toBe(state.held);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({ id, loginName: `top-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: START, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `top-${tag}`, name: 'top' } });
    await prisma.company.create({ data: { id: ids.company, code: `top-${tag}`, name: 'top' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.package.create({ data: { id: ids.pkg, code: `top-${tag}`, name: 'top', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // Notices are counted nowhere and written nowhere: a real one goes to every branch user in the database.
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
    const uow = new UnitOfWork(notice);
    uow.prismaClient = prisma;
    operations = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  });

  afterEach(async () => {
    breakNotices = false;
    const rows = await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } });
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: rows.map((row) => row.id) } } });
    await prisma.providerOperation.deleteMany({ where: { providerId: ids.provider } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0, ceiling: 0 } });
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

  describe('completion by hand and reject (T8)', () => {
    it.each(IN_FLIGHT)('are refused while the operation is %s, and the task, its hold, the operation and the ledger stay as they were', async (state) => {
      const taskId = await openTask();
      await operationIn(taskId, state);
      const before = await snapshot(taskId);
      expect(before.wallet).toMatchObject({ balance: START, held: PRICE });
      expect(await refusal(service.completeTask(owner, taskId, { note: 'by hand' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.rejectTask(owner, taskId, { reason: 'not possible' }))).toBe('409 DUPLICATE_REQUEST');
      // Several at once fare the same.
      const many = await Promise.all([...Array.from({ length: 4 }, () => refusal(service.completeTask(owner, taskId, { note: 'x' }))), ...Array.from({ length: 4 }, () => refusal(service.rejectTask(owner, taskId, { reason: 'x' })))]);
      expect(new Set(many)).toEqual(new Set(['409 DUPLICATE_REQUEST']));
      expect(await snapshot(taskId)).toEqual(before);
      expect(before.task).toMatchObject({ status: 'working', held: PRICE, assigneeId: null, resultNote: null });
      expect(before.kinds).toEqual(['hold']);
    });

    it('a failed operation leaves the task to the branch: completed once, at its fixed price, from its hold (spec 9)', async () => {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, 'failed');
      const failed = await operationOf(taskId);
      const results = await Promise.all(Array.from({ length: 5 }, () => refusal(service.completeTask(owner, taskId, { note: 'done by hand' }))));
      expect(results.filter((result) => result === 'done')).toHaveLength(1);
      expect(await task(taskId)).toMatchObject({ status: 'done' });
      expect(await lines()).toBe(1);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      // One capture: the hold given back and the charge taken, once each (S.4).
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      // The operation is as it was, and the dispatcher never takes it again.
      expect(await operationOf(taskId)).toEqual(failed);
      expect(await operations.claim(operationId)).toBeNull();
      await expectWalletAddsUp();
    });

    it('a failed operation lets the branch reject: the hold is released once, and no claim follows (spec 9)', async () => {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, 'failed');
      const failed = await operationOf(taskId);
      const results = await Promise.all(Array.from({ length: 5 }, () => refusal(service.rejectTask(owner, taskId, { reason: 'the provider refused it' }))));
      expect(results.filter((result) => result === 'done')).toHaveLength(1);
      expect(await task(taskId)).toMatchObject({ status: 'cancelled', resultNote: 'the provider refused it' });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await operationOf(taskId)).toEqual(failed);
      expect(await operations.claim(operationId)).toBeNull();
      await expectWalletAddsUp();
    });

    it('a task with no operation is completed, rejected and cancelled as before', async () => {
      const [completed, rejected, cancelled] = [await openTask(), await openTask(), await openTask()];
      expect(await refusal(service.completeTask(owner, completed, { note: 'ok' }))).toBe('done');
      expect(await refusal(service.rejectTask(owner, rejected, { reason: 'no' }))).toBe('done');
      expect(await refusal(service.cancelTask(pos, cancelled))).toBe('done');
      expect([(await task(completed)).status, (await task(rejected)).status, (await task(cancelled)).status]).toEqual(['done', 'cancelled', 'cancelled']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect(await kinds()).toEqual(['activate', 'hold', 'hold', 'hold', 'release', 'release', 'release']);
      expect(await lines()).toBe(1);
      await expectWalletAddsUp();
    });
  });

  describe('cancel by the submitter (T9)', () => {
    it.each(['requested', 'requested-after-attempt'] as State[])('while the operation is %s: abandoned, the task cancelled and the hold released once, in one transaction (spec 14)', async (state) => {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, state);
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 5 }, () => refusal(service.cancelTask(pos, taskId))));
      expect(results.filter((result) => result === 'done')).toHaveLength(1);
      const operation = await operationOf(taskId);
      expect(operation).toMatchObject({ status: 'failed', lastError: 'abandoned', sentAt: null, attempts: state === 'requested' ? 0 : 1 });
      expect(operation.appliedAt?.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(await task(taskId)).toMatchObject({ status: 'cancelled', assigneeId: null });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await kinds()).toEqual(['hold', 'release']);
      // Nothing can send it any more: a later claim is null, and so is a send for the attempt it never became.
      expect(await operations.claim(operationId)).toBeNull();
      expect(await operations.beginSend(operationId, operation.attempts + 1)).toBeNull();
      expect(await operationOf(taskId)).toEqual(operation);
      await expectWalletAddsUp();
    });

    it.each(['pending', 'unknown', 'unapplied', 'exception'] as State[])('is refused while the operation is %s: nothing changes (spec 15)', async (state) => {
      const taskId = await openTask();
      await operationIn(taskId, state);
      const before = await snapshot(taskId);
      const results = await Promise.all(Array.from({ length: 5 }, () => refusal(service.cancelTask(pos, taskId))));
      expect(new Set(results)).toEqual(new Set(['409 DUPLICATE_REQUEST']));
      expect(await snapshot(taskId)).toEqual(before);
      expect(before.wallet).toMatchObject({ balance: START, held: PRICE });
    });

    it('with a failed operation: the task is cancelled and the hold released once; the operation is not touched', async () => {
      const taskId = await openTask();
      await operationIn(taskId, 'failed');
      const failed = await operationOf(taskId);
      const results = await Promise.all(Array.from({ length: 5 }, () => refusal(service.cancelTask(pos, taskId))));
      expect(results.filter((result) => result === 'done')).toHaveLength(1);
      expect(await task(taskId)).toMatchObject({ status: 'cancelled' });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await operationOf(taskId)).toEqual(failed);
    });

    it('rolls everything back when a step after the operation fails: still requested, still working, still held', async () => {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, 'requested');
      const before = await snapshot(taskId);
      breakNotices = true;
      await expect(service.cancelTask(pos, taskId)).rejects.toThrow('notices are down');
      expect(await snapshot(taskId)).toEqual(before);
      // It is still the dispatcher's to take, or the submitter's to cancel again.
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('done');
      expect(await operations.claim(operationId)).toBeNull();
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    });

    it('is the submitter\'s only: another account changes nothing, whatever the operation', async () => {
      const taskId = await openTask();
      await operationIn(taskId, 'requested');
      const before = await snapshot(taskId);
      expect(await refusal(service.cancelTask(owner, taskId))).toBe('400 INVALID');
      expect(await snapshot(taskId)).toEqual(before);
    });
  });

  it('an unknown operation keeps its hold across recovery sweeps, and every action stays refused (spec 10)', async () => {
    const taskId = await openTask();
    const operationId = await operationIn(taskId, 'unknown');
    const before = await snapshot(taskId);
    for (let sweep = 0; sweep < 3; sweep += 1) {
      expect(await operations.recover(operationId, new Date(Date.now() + 3_600_000))).toBeNull();
      expect(await operations.expiredPending(new Date(Date.now() + 3_600_000), 100)).not.toContain(operationId);
      expect(await operations.claim(operationId)).toBeNull();
      expect(await refusal(service.completeTask(owner, taskId, { note: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.rejectTask(owner, taskId, { reason: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('409 DUPLICATE_REQUEST');
    }
    expect(await snapshot(taskId)).toEqual(before);
  });

  it('cancel and the dispatcher\'s claim raced 60 times: cancelled and released with nothing sent, or pending with the hold; never a send after a release (spec 16)', async () => {
    const tally = { cancelled: 0, claimed: 0 };
    for (let round = 0; round < 60; round += 1) {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, round % 2 ? 'requested' : 'requested-after-attempt');
      const attemptsBefore = (await operationOf(taskId)).attempts;
      // A claim is one statement and a cancel a whole transaction, so started together the claim nearly always
      // lands first. The claim is held back by 0 to 56 ms, round by round, so that it lands before the cancel
      // began, while the cancel holds the task, while it holds the operation, and after it committed.
      const cancel = () => refusal(service.cancelTask(pos, taskId));
      const claim = () => operations.claim(operationId);
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const [cancelResult, attempt] = await Promise.all([cancel(), pause(round % 15 < 8 ? round % 15 : (round % 15) * 4).then(claim)]);
      // What the dispatcher does next with its claim: mark the send. It leaves only when that answers.
      const sent = attempt === null ? null : await operations.beginSend(operationId, attempt as number);
      const [operation, row, state] = [await operationOf(taskId), await task(taskId), await wallet()];
      const released = await prisma.walletEntry.count({ where: { userId: ids.pos, kind: 'release' } });
      if (cancelResult === 'done') {
        // The cancel won: nothing was claimed, nothing can be sent, the hold came back once.
        expect({ attempt, sent }).toEqual({ attempt: null, sent: null });
        expect(operation).toMatchObject({ status: 'failed', lastError: 'abandoned', sentAt: null, attempts: attemptsBefore });
        expect(operation.appliedAt).not.toBeNull();
        expect(row.status).toBe('cancelled');
        expect(state).toMatchObject({ balance: START, held: 0 });
        expect(released).toBe(1);
        expect(await operations.claim(operationId)).toBeNull();
        tally.cancelled += 1;
      } else {
        // The claim won: the operation is the dispatcher's, the cancel was refused and the money is still held.
        expect(cancelResult).toBe('409 DUPLICATE_REQUEST');
        expect(attempt).toBe(attemptsBefore + 1);
        expect(sent).not.toBeNull();
        expect(operation).toMatchObject({ status: 'pending', attempts: attemptsBefore + 1, appliedAt: null });
        expect(operation.sentAt).not.toBeNull();
        expect(row.status).toBe('working');
        expect(state).toMatchObject({ balance: START, held: PRICE });
        expect(released).toBe(0);
        tally.claimed += 1;
      }
      // Never both: a send and a release.
      expect(sent !== null && released > 0).toBe(false);
      // The next round starts clean.
      await prisma.providerOperation.deleteMany({ where: { id: operationId } });
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
      await prisma.officeTask.deleteMany({ where: { id: taskId } });
      await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0 } });
    }
    expect(tally.cancelled + tally.claimed).toBe(60);
    process.stdout.write(`cancel against claim, 60 rounds: the cancel won ${tally.cancelled}, the claim won ${tally.claimed}\n`);
    // Both endings were met, so both sides of the rule were exercised.
    expect(tally.cancelled).toBeGreaterThan(0);
    expect(tally.claimed).toBeGreaterThan(0);
  });

  it('reject and completion raced with the claim: always refused, the hold stays, the claim goes its own way', async () => {
    for (let round = 0; round < 20; round += 1) {
      const taskId = await openTask();
      const operationId = await operationIn(taskId, 'requested');
      const act = round % 2 ? () => service.rejectTask(owner, taskId, { reason: 'x' }) : () => service.completeTask(owner, taskId, { note: 'x' });
      const [result, attempt] = await Promise.all([refusal(act()), operations.claim(operationId)]);
      expect(result).toBe('409 DUPLICATE_REQUEST');
      expect(attempt).toBe(1);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await operationOf(taskId)).toMatchObject({ status: 'pending', appliedAt: null });
      expect(await lines()).toBe(0);
    }
    expect(await wallet()).toMatchObject({ balance: START, held: 20 * PRICE });
    expect(await kinds()).toEqual(Array.from({ length: 20 }, () => 'hold'));
    await expectWalletAddsUp();
  });

  it('never deadlocks and never loses or doubles money: every action on every state at once, with claims, settlements and recovery, on one wallet', async () => {
    const states: State[] = ['requested', 'requested-after-attempt', 'pending', 'unknown', 'unapplied', 'exception', 'failed'];
    const crashed: string[] = [];
    const settle = (run: Promise<unknown>) => run.catch((error: unknown) => { if (!(error instanceof OfficeFailure)) crashed.push(String((error as Error)?.message ?? error).slice(0, 200)); });
    for (let round = 0; round < 4; round += 1) {
      const opened: { taskId: string; operationId: string | null; state: State | 'none' }[] = [];
      for (const state of [...states, 'none' as const, ...states]) {
        const taskId = await openTask();
        opened.push({ taskId, operationId: state === 'none' ? null : await operationIn(taskId, state), state });
      }
      const runs: Promise<unknown>[] = [];
      for (const { taskId, operationId } of opened) {
        runs.push(settle(service.cancelTask(pos, taskId)), settle(service.rejectTask(owner, taskId, { reason: 'x' })), settle(service.completeTask(owner, taskId, { note: 'x' })));
        if (operationId) {
          runs.push(settle(operations.claim(operationId)), settle(operations.recover(operationId, new Date(Date.now() + 3_600_000))));
          runs.push(settle(operations.settle(operationId, 1, { kind: 'refused', error: 'refused' })));
        }
      }
      runs.push(...Array.from({ length: 4 }, () => settle(openTask())));
      await Promise.all(runs);
    }
    expect(crashed).toEqual([]);
    await expectWalletAddsUp();
    // Every task ended in one state, and its money with it: a closed task holds nothing, a task left open still
    // holds its price, and a task left open by an operation in flight was touched by nobody.
    const rows = await prisma.officeTask.findMany({ where: { posId: ids.pos }, include: { providerOperation: true } });
    for (const row of rows) {
      if (row.status === 'working') expect(row).toMatchObject({ held: PRICE, assigneeId: null });
      const operation = row.providerOperation;
      // A closed task never has an operation that could still be sent or is waiting for its answer.
      if (row.status !== 'working' && operation) expect(operation.status).toBe('failed');
      if (operation?.status === 'failed' && operation.lastError === 'abandoned') expect([row.status, operation.appliedAt !== null, operation.sentAt]).toEqual(['cancelled', true, null]);
    }
    const closed = rows.filter((row) => row.status === 'cancelled').length;
    const done = rows.filter((row) => row.status === 'done').length;
    const entries = await kinds();
    // A cancelled or rejected task gave its hold back once; a completed one had it captured once (a release and a charge).
    expect(entries.filter((kind) => kind === 'release')).toHaveLength(closed + done);
    expect(entries.filter((kind) => kind === 'activate')).toHaveLength(done);
    expect(await lines()).toBe(done);
    expect(entries.filter((kind) => kind === 'hold')).toHaveLength(rows.length);
  });
});
