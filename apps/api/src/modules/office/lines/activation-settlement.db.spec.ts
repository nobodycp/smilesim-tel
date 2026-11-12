import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { OPERATIONS_QUEUE, SETTLEMENTS_QUEUE, buildActivationSettlement, buildProviderDispatch } from '../../../provider-dispatch';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import { open, seal } from '../../shared/secret-box';
import { capturedOutput } from '../../shared/testing/captured-output';
import type { Db } from '../kernel/unit-of-work';
import { NoticeService } from '../notices/notice.service';
import { OutboxRelay } from '../outbox/outbox-relay';
import { OutboxRepository, type ClaimedMessage } from '../outbox/outbox.repository';
import { OPERATION_REQUESTED, OPERATION_SETTLED, ProviderOperationsRepository } from '../providers/operations/provider-operations.repository';
import { ProviderOperationsService } from '../providers/operations/provider-operations.service';
import { ScriptedGateway } from '../providers/testing/scripted-gateway';
import { PROVIDER_EXCEPTION_NOTES, PROVIDER_FAILED_NOTE, PROVIDER_UNKNOWN_NOTE, SYSTEM_SENDER_NAME } from '../stored-text';
import { OfficeFacade } from '../testing/office-facade';
import type { ActivationSettlement } from './activation-settlement';
import { operationKey } from './activation-settlement.rules';

// PostgreSQL (TEST_DATABASE_URL); the queue test also needs Redis (TEST_REDIS_URL). ADR 0019, D8 to D12 and D16;
// transactions T4, T5, T5′, T6, T7; spec items 6, 7, 8, 11, 12, 13, 24, 27, 29; plan slice S.8.
// A provider's verdict is stored first (T4) and acted on in a transaction of its own: a confirmed activation
// becomes one line and one charge captured from the task's hold (T5), or an exception that keeps everything as it
// is (T5′); a failure hands the task to the branch (T6); an unknown answer tells those who may decide (T7).
// No sale records an operation yet (S.11), so each test opens a real task through the service and writes its
// operation by hand, as claimed and sent, then gives it the provider's answer through `settle`.
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;
const CODE = 'LPA:1$smdp.s8-settlement.example$S8-SECRET-ACTIVATION-CODE-7F3K9Q2M8X5W1Z6B4N0V';

suite('settling a provider\'s verdict on an activation task (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(240_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const prefix = `s8-${tag}`;
  const ids = { owner: randomUUID(), accountant: randomUUID(), clerk: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID(), role: randomUUID(), plain: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let dispatch: ReturnType<typeof buildProviderDispatch>;
  /** The settlement over this spec's own operations: other specs keep operations of their own in the same database. */
  let settlement: ActivationSettlement;
  let redis: IORedis | null = null;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  /** Every notice written: who it went to, its kind and payload, and the account it is from (its name and id). */
  let notices: { to: string[]; kind: string; payload: Record<string, unknown>; sender: string; actorId: string }[] = [];
  /** How many of the next notice writes fail: a fault after the line and the money were written. */
  let breakNotices = 0;

  class OwnOperations extends ProviderOperationsRepository {
    override async unsettledIds(db: Db, limit: number): Promise<string[]> {
      const mine = new Set((await db.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } })).map((row) => row.id));
      return (await super.unsettledIds(db, 10_000)).filter((id) => mine.has(id)).slice(0, limit);
    }

    override async unknownTaskOperationIds(db: Db, limit: number): Promise<string[]> {
      const mine = new Set((await db.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } })).map((row) => row.id));
      return (await super.unknownTaskOperationIds(db, 10_000)).filter((id) => mine.has(id)).slice(0, limit);
    }
  }

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const openTask = async (over: Record<string, unknown> = {}) =>
    ((await service.activate(pos, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', ...(over.esim ? {} : { iccid: serial() }), ...over })) as { taskId: string }).taskId;
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const task = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  const operation = (id: string) => prisma.providerOperation.findUniqueOrThrow({ where: { id } });
  const entries = () => prisma.walletEntry.findMany({ where: { userId: ids.pos }, orderBy: { createdAt: 'asc' } });
  const kinds = async () => (await entries()).map((row) => row.kind).sort();
  const lines = () => prisma.line.findMany({ where: { posId: ids.pos } });
  const messages = async (operationId: string, topic = OPERATION_SETTLED) => prisma.outboxMessage.findMany({ where: { aggregateId: operationId, topic }, orderBy: { sequence: 'asc' } });
  const refusal = (run: Promise<unknown>) => run.then(() => 'done', (error: unknown) => (error instanceof OfficeFailure ? `${error.status} ${error.code}` : Promise.reject(error)));
  const told = (kind: string, taskId: string) => notices.filter((notice) => notice.kind === kind && notice.payload.taskId === taskId);

  /** The task's operation as the dispatcher leaves it once the request has gone out: claimed, leased, marked. */
  const sent = async (taskId: string) => {
    const row = await prisma.providerOperation.create({
      data: {
        idempotencyKey: operationKey(taskId), requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: `s8-${tag}`, taskId,
        status: 'pending', attempts: 1, lastAttemptAt: new Date(), leaseUntil: new Date(Date.now() + 60_000), sentAt: new Date(),
      },
    });
    return row.id;
  };
  const confirmed = (result?: { msisdn?: string | null; iccid?: string | null; esimCode?: string | null }) => ({ kind: 'confirmed' as const, providerRef: 'REF-1', result: result ?? null });
  /** A task whose provider confirmed: the verdict is stored (T4) and not acted on yet. */
  const succeeded = async (over: Record<string, unknown> = {}, result?: Parameters<typeof confirmed>[0]) => {
    const taskId = await openTask(over);
    const operationId = await sent(taskId);
    expect(await dispatch.operations.settle(operationId, 1, confirmed(result))).toBe('succeeded');
    return { taskId, operationId };
  };
  /** Everything an action that must change nothing leaves as it was. */
  const snapshot = async (taskId: string, operationId: string) => ({ task: await task(taskId), operation: await operation(operationId), wallet: await wallet(), kinds: await kinds(), lines: (await lines()).length });

  /** What must hold after anything: held is the open tasks' holds, and the balance moved by exactly the entries. */
  const expectWalletAddsUp = async () => {
    const [state, openTasks, moved] = await Promise.all([
      wallet(),
      prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }),
      prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } }),
    ]);
    expect(state.held).toBe(openTasks._sum.held ?? 0);
    expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
    expect(moved._sum.held ?? 0).toBe(state.held);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, name: string, layer: string, parentId: string | null, isBranchOwner = false, roleId: string | null = null) => ({ id, loginName: `s8-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner, roleId });
    // Two staff roles: one holds the grant that lets an account decide on a provider operation, one does not.
    await prisma.role.create({ data: { id: ids.role, name: `s8-${tag}-accounting`, accounting: true, grants: 'read,accounting' } });
    await prisma.role.create({ data: { id: ids.plain, name: `s8-${tag}-plain`, grants: 'read' } });
    const rows = [
      user(ids.owner, 'owner', 'branch', null, true), user(ids.accountant, 'accountant', 'branch', ids.owner, false, ids.role),
      user(ids.clerk, 'clerk', 'branch', ids.owner, false, ids.plain), user(ids.pos, 'pos', 'pos', ids.owner),
    ];
    for (const row of rows) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.id === ids.pos ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `s8-${tag}`, name: 's8' } });
    await prisma.company.create({ data: { id: ids.company, code: `s8-${tag}`, name: 's8' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.package.create({ data: { id: ids.pkg, code: `s8-${tag}`, name: 's8 package', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // The real notice writer, so who is left out and who is told is the production rule. A real notice goes to
    // every branch user in the database, the accounts of other spec files included: the audience is narrowed to
    // this spec's own accounts before it is written, and what was written is kept in `notices`.
    const own = new Set<string>([ids.owner, ids.accountant, ids.clerk, ids.pos]);
    const real = new NoticeService();
    const notice = {
      write: async (tx: Parameters<NoticeService['write']>[0], audience: string[], actor: Parameters<NoticeService['write']>[2], draft: Parameters<NoticeService['write']>[3], options?: Parameters<NoticeService['write']>[4]) => {
        if (breakNotices > 0) {
          breakNotices -= 1;
          throw new Error('notices are down');
        }
        const rows = await real.write(tx, audience.filter((id) => own.has(id)), actor, draft, options);
        notices.push({ to: rows.map((row) => row.userId).sort(), kind: draft.kind, payload: draft.payload as unknown as Record<string, unknown>, sender: actor.nickname, actorId: actor.id });
        return rows;
      },
      publish: async () => undefined,
    } as unknown as NoticeService;
    service = new OfficeFacade(auth, notice);
    if (redisUrl) redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    dispatch = buildProviderDispatch(prisma, redis ?? ({} as IORedis), new ScriptedGateway(), prefix, notice);
    settlement = buildActivationSettlement(dispatch.uow, new ProviderOperationsService(dispatch.uow, new OwnOperations()));
  });

  afterEach(async () => {
    breakNotices = 0;
    notices = [];
    const rows = await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } });
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: rows.map((row) => row.id) } } });
    await prisma.providerOperation.deleteMany({ where: { providerId: ids.provider } });
    await prisma.notice.deleteMany({ where: { userId: { in: [ids.owner, ids.accountant, ids.clerk, ids.pos] } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await dispatch.publisher.close();
    redis?.disconnect();
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.accountant, ids.clerk, ids.pos] } } });
    for (const id of [ids.pos, ids.clerk, ids.accountant, ids.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.role.deleteMany({ where: { id: { in: [ids.role, ids.plain] } } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  describe('T4: the verdict is stored, and nothing is applied', () => {
    it('stores a confirmed result with its eSIM code sealed and one message; no line, no money, the task as it was', async () => {
      const taskId = await openTask({ esim: true });
      const operationId = await sent(taskId);
      const before = { task: await task(taskId), wallet: await wallet(), kinds: await kinds() };
      const [msisdn, iccid] = [number(), serial()];
      expect(await dispatch.operations.settle(operationId, 1, confirmed({ msisdn: ` ${msisdn} `, iccid, esimCode: CODE }))).toBe('succeeded');
      const row = await operation(operationId);
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'REF-1', resultMsisdn: msisdn, resultIccid: iccid, appliedAt: null, applyError: null });
      expect(row.resultEsimCode?.startsWith('v1:')).toBe(true);
      expect(row.resultEsimCode).not.toContain('S8-SECRET');
      expect(open(row.resultEsimCode as string)).toBe(CODE);
      // One message, carrying the operation's id and nothing else.
      expect((await messages(operationId)).map((message) => [message.sequence, message.payload, message.publishedAt])).toEqual([[2, { operationId }, null]]);
      // Nothing was applied.
      expect({ task: await task(taskId), wallet: await wallet(), kinds: await kinds() }).toEqual(before);
      expect(await lines()).toEqual([]);
      expect(notices).toEqual([expect.objectContaining({ kind: 'task.opened' })]);
    });

    it('never changes a recorded verdict or its result: a second answer, another attempt and a late verdict are refused', async () => {
      const { operationId } = await succeeded({}, { msisdn: number() });
      const recorded = await operation(operationId);
      expect(await refusal(dispatch.operations.settle(operationId, 1, confirmed({ msisdn: number(), esimCode: CODE })))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(dispatch.operations.settle(operationId, 1, { kind: 'refused', error: 'refused' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(dispatch.operations.settle(operationId, 2, confirmed({ msisdn: number() })))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(dispatch.operations.resolveUnknown(operationId, { status: 'failed', error: 'refused' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await dispatch.operations.claim(operationId)).toBeNull();
      expect(await operation(operationId)).toEqual(recorded);
      expect(await messages(operationId)).toHaveLength(1);
    });

    it('refuses to record a result whose eSIM code cannot be sealed: the attempt stays pending, nothing is stored in the clear', async () => {
      const taskId = await openTask({ esim: true });
      const operationId = await sent(taskId);
      const key = process.env.SECRETS_KEY;
      delete process.env.SECRETS_KEY;
      try {
        await expect(dispatch.operations.settle(operationId, 1, confirmed({ esimCode: CODE }))).rejects.toThrow('cannot be sealed');
      } finally {
        process.env.SECRETS_KEY = key;
      }
      expect(await operation(operationId)).toMatchObject({ status: 'pending', resultEsimCode: null, resultMsisdn: null });
      expect(await messages(operationId)).toEqual([]);
      // Recovery then makes it unknown, never failed and never sent again: the money stays held.
      expect(await dispatch.operations.recover(operationId, new Date(Date.now() + 3_600_000))).toBe('unknown');
      expect(await wallet()).toMatchObject({ balance: START, held: (await task(taskId)).held });
    });

    it('announces a failure and an unknown answer once each, and nothing for an attempt that goes back to be sent', async () => {
      const [failed, unknown, again] = [await sent(await openTask()), await sent(await openTask()), await sent(await openTask())];
      await prisma.providerOperation.update({ where: { id: again }, data: { sentAt: null } });
      expect(await dispatch.operations.settle(failed, 1, { kind: 'refused', error: 'refused' })).toBe('failed');
      expect(await dispatch.operations.settle(unknown, 1, { kind: 'no-answer', error: 'timeout' })).toBe('unknown');
      expect(await dispatch.operations.settle(again, 1, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
      expect((await messages(failed)).map((message) => message.sequence)).toEqual([2]);
      expect((await messages(unknown)).map((message) => message.sequence)).toEqual([2]);
      expect(await messages(again)).toEqual([]);
      expect((await messages(again, OPERATION_REQUESTED)).map((message) => message.sequence)).toEqual([1]);
      expect(await wallet()).toMatchObject({ balance: START, held: 3 * PRICE });
      expect(await kinds()).toEqual(['hold', 'hold', 'hold']);
    });
  });

  describe('T5: a confirmed activation is applied once', () => {
    it('makes one line and one charge at the task\'s price from its hold, closes the task and names the submitter and the system (spec 6)', async () => {
      const { taskId, operationId } = await succeeded();
      const opened = await task(taskId);
      expect(await settlement.apply(operationId)).toBe('applied');

      const [line] = await lines();
      expect(await lines()).toHaveLength(1);
      expect(line).toMatchObject({ msisdn: opened.msisdn, iccid: opened.iccid, esim: false, esimQr: null, status: 'active', packageId: ids.pkg });
      expect(await task(taskId)).toMatchObject({ status: 'done', assigneeId: null, held: PRICE, posDelta: -PRICE });
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      // One capture: the hold given back and the charge taken, once each. The charge is the price fixed at opening.
      const rows = await entries();
      expect(rows.map((row) => row.kind).sort()).toEqual(['activate', 'hold', 'release']);
      const charge = rows.find((row) => row.kind === 'activate');
      expect(charge).toMatchObject({ amount: -PRICE, packagePrice: PRICE, lineId: line.id, msisdn: line.msisdn, actorId: ids.pos, balanceAfter: START - PRICE });
      expect((await operation(operationId)).appliedAt).toBeInstanceOf(Date);
      expect(await operation(operationId)).toMatchObject({ status: 'succeeded', applyError: null });
      // D12: the notice names the submitter as the actor and «النظام» as the handler, and the point of sale that
      // owns the number is told, though it is the submitter itself.
      expect(told('task.done', taskId)).toEqual([{ to: [ids.pos], kind: 'task.done', sender: 'pos', actorId: ids.pos, payload: expect.objectContaining({ handlerName: SYSTEM_SENDER_NAME, amount: -PRICE, packageName: 's8 package' }) }]);
      expect(await prisma.notice.findMany({ where: { kind: 'task.done', userId: ids.pos }, select: { actorId: true, actorName: true } })).toEqual([{ actorId: ids.pos, actorName: 'pos' }]);
      await expectWalletAddsUp();

      // Again, by message or by the sweeper: nothing to do, nothing changed.
      const after = await snapshot(taskId, operationId);
      expect(await settlement.apply(operationId)).toBe('skipped');
      expect(await settlement.applyPending()).toBe(0);
      expect(await snapshot(taskId, operationId)).toEqual(after);
      expect(told('task.done', taskId)).toHaveLength(1);
    });

    it('puts on the line what the provider handed back: its number, its serial and its eSIM code as a sealed picture', async () => {
      const [msisdn, iccid] = [number(), serial()];
      const { taskId, operationId } = await succeeded({ esim: true }, { msisdn, iccid, esimCode: CODE });
      const fee = -(await task(taskId)).posDelta;
      expect(await settlement.apply(operationId)).toBe('applied');
      const [line] = await lines();
      expect(line).toMatchObject({ msisdn, iccid, esim: true });
      expect(line.esimQr?.startsWith('v1:')).toBe(true);
      expect(open(line.esimQr as string)).toMatch(/^data:image\/png;base64,/);
      expect(await task(taskId)).toMatchObject({ status: 'done', msisdn, iccid });
      expect(await wallet()).toMatchObject({ balance: START - fee, held: 0 });
      // The entry and the notices name the line, never its code.
      const everything = JSON.stringify([await entries(), notices]);
      expect(everything).not.toContain('S8-SECRET');
      expect(everything).not.toContain((line.esimQr as string).slice(10, 40));
      // The point of sale reads its code from the line's detail, as for any eSIM line.
      const detail = (await service.line(pos, line.id)) as { line: { esimQr: string | null } };
      expect(detail.line.esimQr).toMatch(/^data:image\/png;base64,/);
    });

    it('is applied once by ten workers and a repeated message at the same moment (spec 7)', async () => {
      const { taskId, operationId } = await succeeded();
      const results = await Promise.allSettled([...Array.from({ length: 10 }, () => settlement.apply(operationId)), settlement.applyPending(), settlement.applyPending()]);
      expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
      const outcomes = results.slice(0, 10).map((result) => (result as PromiseFulfilledResult<string>).value);
      const swept = results.slice(10).reduce((sum, result) => sum + (result as PromiseFulfilledResult<number>).value, 0);
      // Exactly one of them all applied it.
      expect(outcomes.filter((outcome) => outcome === 'applied').length + swept).toBe(1);
      expect(outcomes.filter((outcome) => outcome !== 'applied' && outcome !== 'skipped')).toEqual([]);
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect(await task(taskId)).toMatchObject({ status: 'done' });
      expect(told('task.done', taskId)).toHaveLength(1);
      await expectWalletAddsUp();
    });

    it('against a completion, a reject and a cancel by hand at the same instant: the settlement applies, the others change nothing (spec 8)', async () => {
      for (let round = 0; round < 12; round += 1) {
        const { taskId, operationId } = await succeeded();
        const byHand = [() => service.completeTask(owner, taskId, { note: 'by hand' }), () => service.rejectTask(owner, taskId, { reason: 'no' }), () => service.cancelTask(pos, taskId)][round % 3];
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const [applied, manual] = await Promise.all([pause(round % 4).then(() => settlement.apply(operationId)), refusal(byHand())]);
        expect(applied).toBe('applied');
        // Refused by the operation's guard while the settlement had not run yet, or by the closed task after it.
        expect(['409 DUPLICATE_REQUEST', '400 INVALID']).toContain(manual);
        expect(await task(taskId)).toMatchObject({ status: 'done', assigneeId: null });
      }
      expect(await lines()).toHaveLength(12);
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(12);
      expect((await kinds()).filter((kind) => kind === 'release')).toHaveLength(12);
      expect(await wallet()).toMatchObject({ balance: START - 12 * PRICE, held: 0 });
      await expectWalletAddsUp();
    });

    // D9: three guards, any one of which is enough. Each is met here with the other two out of the way, so that
    // taking one of them out is seen.
    describe('each guard against a second application, on its own', () => {
      /** T5 for an operation as it was read earlier, the way a worker holding a stale read would run it. */
      const applyAsRead = (stale: Awaited<ReturnType<typeof operation>>, taskRow: Awaited<ReturnType<typeof task>>) =>
        (settlement as unknown as { applySucceeded: (operation: unknown, task: unknown, actor: unknown) => Promise<string> })
          .applySucceeded(stale, taskRow, { id: ids.pos, loginName: `s8-${tag}-pos`, nickname: 'pos', layer: 'pos', isBranchOwner: false, grants: [], operatorId: ids.pos, impersonating: false });

      it('the task claim: a task that is no longer open is not applied, though its operation still says "not applied"', async () => {
        const { taskId, operationId } = await succeeded();
        const [stale, opened] = [await operation(operationId), await task(taskId)];
        // Closed by another hand, with the operation left as it was (which the guards of S.7 do not allow: by hand).
        await prisma.officeTask.update({ where: { id: taskId }, data: { status: 'cancelled' } });
        const before = await snapshot(taskId, operationId);
        expect(await applyAsRead(stale, opened)).toBe('skipped');
        expect(await snapshot(taskId, operationId)).toEqual(before);
        expect(before).toMatchObject({ lines: 0, kinds: ['hold'], operation: { appliedAt: null } });
      });

      it('the compare-and-set on appliedAt: an operation already applied is not applied again, though its task is open and its number free', async () => {
        const { taskId, operationId } = await succeeded();
        const [stale, opened] = [await operation(operationId), await task(taskId)];
        // Applied by another worker a moment ago, as far as the operation says; the task and the number are as before.
        await prisma.providerOperation.update({ where: { id: operationId }, data: { appliedAt: new Date() } });
        const before = await snapshot(taskId, operationId);
        expect(await applyAsRead(stale, opened)).toBe('skipped');
        expect(await snapshot(taskId, operationId)).toEqual(before);
        expect(before).toMatchObject({ lines: 0, kinds: ['hold'], task: { status: 'working' }, wallet: { balance: START, held: PRICE } });
      });

      it('the compare-and-set on the result: a result that is not the one that was read is not applied', async () => {
        const { taskId, operationId } = await succeeded({}, { msisdn: number() });
        const [stale, opened] = [await operation(operationId), await task(taskId)];
        await prisma.providerOperation.update({ where: { id: operationId }, data: { resultMsisdn: number() } });
        const before = await snapshot(taskId, operationId);
        expect(await applyAsRead(stale, opened)).toBe('skipped');
        expect(await snapshot(taskId, operationId)).toEqual(before);
        expect(before.lines).toBe(0);
      });

      it('the number and the serial: with the task open and the operation not applied, a number or a serial a line holds makes no second line', async () => {
        // The line of an earlier application of the very same task: its number and its serial.
        const { taskId, operationId } = await succeeded();
        const opened = await task(taskId);
        await prisma.line.create({ data: { msisdn: opened.msisdn as string, iccid: opened.iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
        expect(await settlement.apply(operationId)).toBe('exception');
        expect(await lines()).toHaveLength(1);
        expect(await kinds()).toEqual(['hold']);
        expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
        expect(['number-taken', 'sim-taken']).toContain((await operation(operationId)).applyError);
      });
    });

    it('rolls back whole on a fault after the line and the charge were written, records no exception, and is applied by the sweeper later', async () => {
      const { taskId, operationId } = await succeeded();
      const before = await snapshot(taskId, operationId);
      breakNotices = 1;
      await expect(settlement.apply(operationId)).rejects.toThrow('notices are down');
      // Nothing of it stayed: no line, no entry, the task open with its hold, the operation not applied and with no exception.
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(before).toMatchObject({ lines: 0, kinds: ['hold'], wallet: { balance: START, held: PRICE }, task: { status: 'working' }, operation: { appliedAt: null, applyError: null } });
      // The sweeper meets it again; a fault there is logged by its code and does not stop the round.
      breakNotices = 1;
      const output = await capturedOutput(async () => expect(await settlement.applyPending()).toBe(0));
      expect(output).toContain(`operation ${operationId}: the settlement failed and will be tried again (unclassified)`);
      expect(output).not.toContain('notices are down');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await settlement.applyPending()).toBe(1);
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
    });

    it('rolls back whole when the wallet no longer holds the task\'s hold: a fault to be looked at, never an exception and never a clamp', async () => {
      const { taskId, operationId } = await succeeded();
      await prisma.wallet.update({ where: { userId: ids.pos }, data: { held: 0 } });
      const before = await snapshot(taskId, operationId);
      const output = await capturedOutput(async () => expect(await refusal(settlement.apply(operationId))).toBe('409 DUPLICATE_REQUEST'));
      expect(output).toContain('capture refused');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(before).toMatchObject({ lines: 0, task: { status: 'working' }, operation: { status: 'succeeded', appliedAt: null, applyError: null } });
      expect(notices.filter((notice) => notice.kind === 'task.note')).toEqual([]);
      // Put right, it is applied once.
      await prisma.wallet.update({ where: { userId: ids.pos }, data: { held: PRICE } });
      expect(await settlement.applyPending()).toBe(1);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
    });
  });

  describe('T5′: the provider confirmed and the line cannot be created', () => {
    it('keeps the verdict, its result, the task, the hold and the reservation, records why once, and tells those who may decide (spec 13)', async () => {
      // The number the provider assigned belongs to a line by now.
      const taken = number();
      await prisma.line.create({ data: { msisdn: taken, iccid: serial(), esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      const { taskId, operationId } = await succeeded({}, { msisdn: taken });
      const opened = await task(taskId);
      notices = [];
      const started = Date.now();
      expect(await settlement.apply(operationId)).toBe('exception');

      const row = await operation(operationId);
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'REF-1', resultMsisdn: taken, applyError: 'number-taken', appliedAt: null });
      expect(row.applyFailedAt?.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(await task(taskId)).toEqual(opened);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await kinds()).toEqual(['hold']);
      expect(await lines()).toHaveLength(1);
      // The serial is still the task's: another activation cannot take it.
      expect(await refusal(service.activate(pos, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', iccid: opened.iccid }))).toBe('409 SIM_TAKEN');
      // The owner and the account that holds the decision grant are told, in fixed words; nobody else.
      expect(notices).toEqual([{ to: [ids.accountant, ids.owner].sort(), kind: 'task.note', sender: 'pos', actorId: ids.pos, payload: { taskId, action: 'activate', msisdn: opened.msisdn, authorName: SYSTEM_SENDER_NAME, handlerName: SYSTEM_SENDER_NAME, excerpt: PROVIDER_EXCEPTION_NOTES['number-taken'] } }]);

      // Terminal: never claimed or sent again, never applied again, left alone by the sweeper, closed to every hand.
      const after = await snapshot(taskId, operationId);
      expect(await dispatch.operations.claim(operationId)).toBeNull();
      expect(await settlement.apply(operationId)).toBe('skipped');
      for (let sweep = 0; sweep < 3; sweep += 1) expect(await settlement.applyPending()).toBe(0);
      expect(await refusal(service.completeTask(owner, taskId, { note: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.rejectTask(owner, taskId, { reason: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('409 DUPLICATE_REQUEST');
      expect(await snapshot(taskId, operationId)).toEqual(after);
      expect(notices).toHaveLength(1);
    });

    it('records a serial the provider issued that a line already carries as sim-taken, once, however many workers meet it', async () => {
      const taken = serial();
      await prisma.line.create({ data: { msisdn: number(), iccid: taken, esim: true, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      const { taskId, operationId } = await succeeded({ esim: true }, { iccid: taken, esimCode: CODE });
      const held = (await task(taskId)).held;
      notices = [];
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => settlement.apply(operationId)));
      expect(outcomes.filter((outcome) => outcome === 'exception')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== 'exception' && outcome !== 'skipped')).toEqual([]);
      expect(await operation(operationId)).toMatchObject({ status: 'succeeded', applyError: 'sim-taken', appliedAt: null, resultIccid: taken });
      // The result is kept as it was stored, its code still sealed.
      expect(open((await operation(operationId)).resultEsimCode as string)).toBe(CODE);
      expect(await task(taskId)).toMatchObject({ status: 'working', held });
      expect(await wallet()).toMatchObject({ balance: START, held });
      expect(notices.map((notice) => notice.payload.excerpt)).toEqual([PROVIDER_EXCEPTION_NOTES['sim-taken']]);
      expect(JSON.stringify(notices)).not.toContain('S8-SECRET');
    });
  });

  describe('T5′ is written once, and only for an operation that is still succeeded and neither applied nor already an exception', () => {
    const submitter = { id: ids.pos, loginName: `s8-${tag}-pos`, nickname: 'pos', layer: 'pos', isBranchOwner: false, grants: [], operatorId: ids.pos, impersonating: false };
    const exceptionAsRead = (stale: Awaited<ReturnType<typeof operation>>, taskRow: Awaited<ReturnType<typeof task>>, reason: string) =>
      (settlement as unknown as { recordException: (operation: unknown, task: unknown, actor: unknown, reason: string) => Promise<string> }).recordException(stale, taskRow, submitter, reason);

    it('does not write over an exception already recorded, and tells nobody twice', async () => {
      const { taskId, operationId } = await succeeded();
      const [stale, opened] = [await operation(operationId), await task(taskId)];
      notices = [];
      expect(await exceptionAsRead(stale, opened, 'number-taken')).toBe('exception');
      const recorded = await operation(operationId);
      // A second worker that met the refusal too, with its own reading of why.
      expect(await exceptionAsRead(stale, opened, 'sim-taken')).toBe('skipped');
      expect(await operation(operationId)).toEqual(recorded);
      expect(recorded).toMatchObject({ applyError: 'number-taken', status: 'succeeded', appliedAt: null });
      expect(notices).toHaveLength(1);
    });

    it('writes no exception on an operation that was applied meanwhile', async () => {
      const { taskId, operationId } = await succeeded();
      const [stale, opened] = [await operation(operationId), await task(taskId)];
      expect(await settlement.apply(operationId)).toBe('applied');
      const applied = await operation(operationId);
      notices = [];
      expect(await exceptionAsRead(stale, opened, 'number-taken')).toBe('skipped');
      expect(await operation(operationId)).toEqual(applied);
      expect(applied).toMatchObject({ applyError: null, applyFailedAt: null });
      expect(notices).toEqual([]);
    });
  });

  describe('who a settlement notice names and who it reaches (D12)', () => {
    const stored = (kind: string, taskId: string) =>
      prisma.notice.findMany({ where: { kind, payload: { path: ['taskId'], equals: taskId } }, select: { userId: true, actorId: true, actorName: true }, orderBy: { userId: 'asc' } });
    const byUser = <Row extends { userId: string }>(rows: Row[]) => [...rows].sort((left, right) => left.userId.localeCompare(right.userId));

    it('names the submitter as the actor and «النظام» as the handler, and tells the submitter and the owning point of sale', async () => {
      // The branch owner submits an activation for the point of sale: two accounts on the task's side.
      const taskId = ((await service.activate(owner, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', iccid: serial() })) as { taskId: string }).taskId;
      const operationId = await sent(taskId);
      await dispatch.operations.settle(operationId, 1, confirmed());
      notices = [];
      expect(await settlement.apply(operationId)).toBe('applied');
      expect(notices).toEqual([{ to: [ids.owner, ids.pos].sort(), kind: 'task.done', sender: 'owner', actorId: ids.owner, payload: expect.objectContaining({ taskId, handlerName: SYSTEM_SENDER_NAME, amount: -PRICE }) }]);
      // As stored: one row each, from the submitter by id and by name.
      expect(await stored('task.done', taskId)).toEqual(byUser([{ userId: ids.owner, actorId: ids.owner, actorName: 'owner' }, { userId: ids.pos, actorId: ids.owner, actorName: 'owner' }]));
      // The entry names the submitter too.
      expect((await entries()).find((row) => row.kind === 'activate')).toMatchObject({ actorId: ids.owner, userId: ids.pos });
      // The same message again, and the sweeper: nobody is told twice.
      for (let again = 0; again < 3; again += 1) await dispatch.settle({ operationId });
      expect(await settlement.applyPending()).toBe(0);
      expect(await stored('task.done', taskId)).toHaveLength(2);
    });

    it('tells an exception and an unknown answer to the accounts that may decide and to nobody else, the submitter among them only when it may decide', async () => {
      const taken = number();
      await prisma.line.create({ data: { msisdn: taken, iccid: serial(), esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      // Submitted by the point of sale: it may not decide, so it is not told.
      const byPos = await succeeded({}, { msisdn: taken });
      // Submitted by the owner, who may decide: told, though the note is in the owner's own name.
      const ownerTask = ((await service.activate(owner, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', iccid: serial() })) as { taskId: string }).taskId;
      const byOwner = await sent(ownerTask);
      await dispatch.operations.settle(byOwner, 1, { kind: 'no-answer', error: 'timeout' });
      notices = [];
      expect(await settlement.apply(byPos.operationId)).toBe('exception');
      expect(await settlement.apply(byOwner)).toBe('awaiting-decision');
      const deciders = [ids.accountant, ids.owner].sort();
      expect(notices.map((notice) => [notice.kind, notice.to, notice.actorId, notice.payload.handlerName])).toEqual([
        ['task.note', deciders, ids.pos, SYSTEM_SENDER_NAME],
        ['task.note', deciders, ids.owner, SYSTEM_SENDER_NAME],
      ]);
      // Never the clerk (a branch account without the grant) and never the point of sale.
      expect(await prisma.notice.count({ where: { kind: 'task.note', userId: { in: [ids.clerk, ids.pos] } } })).toBe(0);
      // Delivered again, in any number: each was said once.
      for (let again = 0; again < 3; again += 1) {
        await dispatch.settle({ operationId: byPos.operationId });
        await dispatch.settle({ operationId: byOwner });
      }
      expect(await settlement.applyPending()).toBe(0);
      expect(await stored('task.note', byPos.taskId)).toHaveLength(2);
      expect(await stored('task.note', ownerTask)).toHaveLength(2);
    });

    it('leaves every other notice as it was: whoever does a thing by hand is not told of it', async () => {
      // Opened by the point of sale: the handlers are told, the point of sale is not.
      const taskId = await openTask();
      expect(told('task.opened', taskId).map((notice) => [notice.to, notice.actorId])).toEqual([[[ids.owner], ids.pos]]);
      // Completed by the owner by hand: the point of sale is told, the owner is not, and the owner is the handler named.
      notices = [];
      await service.completeTask(owner, taskId, { note: 'by hand' });
      expect(told('task.done', taskId)).toEqual([{ to: [ids.pos], kind: 'task.done', sender: 'owner', actorId: ids.owner, payload: expect.objectContaining({ handlerName: 'owner' }) }]);
      // Opened by the owner for the point of sale, then cancelled by the owner: the owner is told of neither.
      notices = [];
      const own = ((await service.activate(owner, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', iccid: serial() })) as { taskId: string }).taskId;
      await service.cancelTask(owner, own);
      expect(notices.flatMap((notice) => notice.to)).not.toContain(ids.owner);
    });
  });

  describe('an eSIM the provider confirmed without an activation code (D16, proposed: esim-code-missing)', () => {
    it('makes no line: an exception that keeps the verdict, its result, the task, the hold and the reservation, said once to those who may decide', async () => {
      const [msisdn, iccid] = [number(), serial()];
      const { taskId, operationId } = await succeeded({ esim: true }, { msisdn, iccid });
      const opened = await task(taskId);
      expect(opened).toMatchObject({ esim: true, esimQr: null });
      notices = [];
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => settlement.apply(operationId)));
      expect(outcomes.filter((outcome) => outcome === 'exception')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== 'exception' && outcome !== 'skipped')).toEqual([]);

      const row = await operation(operationId);
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'REF-1', resultMsisdn: msisdn, resultIccid: iccid, resultEsimCode: null, applyError: 'esim-code-missing', appliedAt: null });
      expect(row.applyFailedAt).toBeInstanceOf(Date);
      expect(await task(taskId)).toEqual(opened);
      expect(await lines()).toEqual([]);
      expect(await wallet()).toMatchObject({ balance: START, held: opened.held });
      expect(await kinds()).toEqual(['hold']);
      expect(notices).toEqual([{ to: [ids.accountant, ids.owner].sort(), kind: 'task.note', sender: 'pos', actorId: ids.pos, payload: expect.objectContaining({ taskId, excerpt: PROVIDER_EXCEPTION_NOTES['esim-code-missing'], handlerName: SYSTEM_SENDER_NAME }) }]);

      // Never sent again, never applied by the sweeper, closed to every hand; the number stays the task's.
      const after = await snapshot(taskId, operationId);
      expect(await dispatch.operations.claim(operationId)).toBeNull();
      for (let sweep = 0; sweep < 3; sweep += 1) expect(await settlement.applyPending()).toBe(0);
      for (let again = 0; again < 3; again += 1) await dispatch.settle({ operationId });
      expect(await refusal(service.completeTask(owner, taskId, { note: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.rejectTask(owner, taskId, { reason: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.activate(pos, { packageCode: `s8-${tag}`, posLoginName: `s8-${tag}-pos`, outcome: 'fail', esim: true, msisdn: opened.msisdn }))).toMatch(/^4/);
      expect(await snapshot(taskId, operationId)).toEqual(after);
      expect(notices).toHaveLength(1);
    });

    it('is not an exception when a code is there: the provider\'s, or the one the task has carried', async () => {
      // The provider's code.
      const withCode = await succeeded({ esim: true }, { iccid: serial(), esimCode: CODE });
      expect(await settlement.apply(withCode.operationId)).toBe('applied');
      // No code from the provider, and the task carries one (sealed, as a task stores it).
      const carried = await openTask({ esim: true });
      const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      await prisma.officeTask.update({ where: { id: carried }, data: { esimQr: seal(picture) } });
      const operationId = await sent(carried);
      await dispatch.operations.settle(operationId, 1, confirmed({ iccid: serial() }));
      expect(await settlement.apply(operationId)).toBe('applied');
      const made = await lines();
      expect(made).toHaveLength(2);
      expect(made.map((line) => open(line.esimQr as string).startsWith('data:image/png;base64,'))).toEqual([true, true]);
      expect(made.map((line) => open(line.esimQr as string))).toContain(picture);
      expect((await operation(operationId)).applyError).toBeNull();
    });

    it('a plain SIM needs no code, and a code that is there and cannot be opened is a fault to retry, not this exception', async () => {
      const plain = await succeeded({}, { msisdn: number() });
      expect(await settlement.apply(plain.operationId)).toBe('applied');
      const { taskId, operationId } = await succeeded({ esim: true }, { iccid: serial(), esimCode: CODE });
      const before = await snapshot(taskId, operationId);
      const key = process.env.SECRETS_KEY;
      process.env.SECRETS_KEY = Buffer.alloc(32, 99).toString('base64');
      try {
        await expect(settlement.apply(operationId)).rejects.toThrow();
        expect(await settlement.applyPending()).toBe(0);
      } finally {
        process.env.SECRETS_KEY = key;
      }
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(before.operation).toMatchObject({ applyError: null, appliedAt: null });
      expect(await settlement.applyPending()).toBe(1);
      expect(await task(taskId)).toMatchObject({ status: 'done' });
    });
  });

  describe('T6: the provider did not run it', () => {
    it('hands the task to the branch once: noted as a provider failure, the hold kept, nothing refunded, never sent again (spec 9)', async () => {
      const taskId = await openTask();
      // As a sale on the dispatch route will open it: with a note of its own, not the failure's.
      await prisma.officeTask.update({ where: { id: taskId }, data: { note: 'sent to the provider' } });
      const operationId = await sent(taskId);
      await dispatch.operations.settle(operationId, 1, { kind: 'refused', error: 'refused' });
      notices = [];
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => settlement.apply(operationId)));
      expect(outcomes.filter((outcome) => outcome === 'handed-to-branch')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== 'handed-to-branch' && outcome !== 'skipped')).toEqual([]);
      expect(await task(taskId)).toMatchObject({ status: 'working', note: PROVIDER_FAILED_NOTE, held: PRICE, assigneeId: null });
      expect(await operation(operationId)).toMatchObject({ status: 'failed', lastError: 'refused' });
      expect((await operation(operationId)).appliedAt).toBeInstanceOf(Date);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await kinds()).toEqual(['hold']);
      expect(await lines()).toEqual([]);
      // The accounts that handle tasks are told that it is theirs.
      expect(told('task.opened', taskId)).toEqual([expect.objectContaining({ sender: 'pos', actorId: ids.pos, to: [ids.owner], payload: expect.objectContaining({ handlerName: SYSTEM_SENDER_NAME }) })]);
      expect(await settlement.applyPending()).toBe(0);
      expect(await dispatch.operations.claim(operationId)).toBeNull();
      // The branch then completes it by hand: one line, one capture.
      expect(await refusal(service.completeTask(owner, taskId, { note: 'done by hand' }))).toBe('done');
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
    });

    it('only stamps the operation when the submitter had cancelled meanwhile: no note, no notice, the release stays one', async () => {
      const taskId = await openTask();
      await prisma.officeTask.update({ where: { id: taskId }, data: { note: 'sent to the provider' } });
      const operationId = await sent(taskId);
      await dispatch.operations.settle(operationId, 1, { kind: 'refused', error: 'refused' });
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('done');
      notices = [];
      expect(await settlement.apply(operationId)).toBe('handed-to-branch');
      expect(await task(taskId)).toMatchObject({ status: 'cancelled', note: 'sent to the provider' });
      expect(notices).toEqual([]);
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
    });
  });

  describe('T7: the answer is not known', () => {
    it('tells those who may decide once and changes nothing; the provider\'s late verdict then applies with no decision (specs 10, 12)', async () => {
      const taskId = await openTask();
      const operationId = await sent(taskId);
      // The worker died after the send mark: recovery makes the attempt unknown and announces it.
      expect(await dispatch.operations.recover(operationId, new Date(Date.now() + 3_600_000))).toBe('unknown');
      expect((await messages(operationId)).map((message) => message.sequence)).toEqual([2]);
      const before = await snapshot(taskId, operationId);
      notices = [];
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => settlement.apply(operationId)));
      // Told once, however many workers and repeats: the others find the note already sent.
      expect(outcomes.filter((outcome) => outcome === 'awaiting-decision')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== 'awaiting-decision' && outcome !== 'skipped')).toEqual([]);
      expect(notices).toHaveLength(1);
      expect(await settlement.apply(operationId)).toBe('skipped');
      expect(notices).toHaveLength(1);
      expect(notices[0]).toEqual({ to: [ids.accountant, ids.owner].sort(), kind: 'task.note', sender: 'pos', actorId: ids.pos, payload: { taskId, action: 'activate', msisdn: before.task.msisdn, authorName: SYSTEM_SENDER_NAME, handlerName: SYSTEM_SENDER_NAME, excerpt: PROVIDER_UNKNOWN_NOTE } });
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(before).toMatchObject({ lines: 0, kinds: ['hold'], wallet: { balance: START, held: PRICE }, task: { status: 'working' } });
      // The sweeper leaves it; nothing sends it; every hand is refused.
      expect(await settlement.applyPending()).toBe(0);
      expect(await dispatch.operations.claim(operationId)).toBeNull();
      expect(await refusal(service.completeTask(owner, taskId, { note: 'x' }))).toBe('409 DUPLICATE_REQUEST');
      expect(await refusal(service.cancelTask(pos, taskId))).toBe('409 DUPLICATE_REQUEST');
      expect(await snapshot(taskId, operationId)).toEqual(before);

      // The provider's own answer about that attempt arrives late: recorded, announced under its own sequence, applied.
      expect(await dispatch.operations.settle(operationId, 1, confirmed())).toBe('succeeded');
      expect((await messages(operationId)).map((message) => message.sequence)).toEqual([2, 3]);
      expect(await settlement.apply(operationId)).toBe('applied');
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect(await task(taskId)).toMatchObject({ status: 'done' });
    });

    it('a late refusal hands the task to the branch; an operation with no task is nobody\'s to settle', async () => {
      const taskId = await openTask();
      const operationId = await sent(taskId);
      await prisma.officeTask.update({ where: { id: taskId }, data: { note: 'sent to the provider' } });
      await dispatch.operations.settle(operationId, 1, { kind: 'no-answer', error: 'timeout' });
      expect(await dispatch.operations.settle(operationId, 1, { kind: 'refused', error: 'refused' })).toBe('failed');
      expect(await settlement.apply(operationId)).toBe('handed-to-branch');
      expect(await task(taskId)).toMatchObject({ status: 'working', note: PROVIDER_FAILED_NOTE, held: PRICE });
      const loose = await prisma.providerOperation.create({ data: { idempotencyKey: `s8:${randomUUID()}`, requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: 'x', status: 'succeeded', attempts: 1 } });
      expect(await settlement.apply(loose.id)).toBe('skipped');
      expect(await settlement.apply(randomUUID())).toBe('skipped');
      expect(await settlement.applyPending()).toBe(0);
    });
  });

  describe('the sweeper and a worker that stops', () => {
    it('applies a verdict whose message was never delivered, hands over a failure, and leaves an exception and an unknown alone (spec 11)', async () => {
      const taken = number();
      await prisma.line.create({ data: { msisdn: taken, iccid: serial(), esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      const lost = await succeeded();
      const exception = await succeeded({}, { msisdn: taken });
      expect(await settlement.apply(exception.operationId)).toBe('exception');
      const failed = await sent(await openTask());
      await dispatch.operations.settle(failed, 1, { kind: 'refused', error: 'refused' });
      const unknown = await sent(await openTask());
      await dispatch.operations.settle(unknown, 1, { kind: 'no-answer', error: 'timeout' });
      const waiting = await sent(await openTask());
      // No message of any of them was ever published or handled. The sweeper's list is the two it can act on.
      expect((await new OwnOperations().unsettledIds(prisma, 100)).sort()).toEqual([lost.operationId, failed].sort());
      notices = [];
      // Three things happen: the lost verdict is applied, the failure is handed over, and the unknown answer,
      // whose message was lost too, is announced.
      expect(await settlement.applyPending()).toBe(3);
      expect(await new OwnOperations().unsettledIds(prisma, 100)).toEqual([]);
      expect(notices.filter((notice) => notice.payload.excerpt === PROVIDER_UNKNOWN_NOTE).map((notice) => notice.to)).toEqual([[ids.accountant, ids.owner].sort()]);
      expect(await task(lost.taskId)).toMatchObject({ status: 'done' });
      expect((await operation(failed)).appliedAt).toBeInstanceOf(Date);
      expect(await operation(exception.operationId)).toMatchObject({ applyError: 'number-taken', appliedAt: null });
      expect(await operation(unknown)).toMatchObject({ status: 'unknown', appliedAt: null });
      expect(await operation(waiting)).toMatchObject({ status: 'pending', appliedAt: null });
      // Further rounds find nothing, and say nothing twice.
      const said = notices.length;
      for (let sweep = 0; sweep < 3; sweep += 1) expect(await settlement.applyPending()).toBe(0);
      expect(notices).toHaveLength(said);
      expect(await lines()).toHaveLength(2);
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(1);
      // Four tasks are still open and each still holds its price.
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 4 * PRICE });
      await expectWalletAddsUp();
    });

    it('a worker that died before applying loses nothing, and one that died after applying applies nothing twice', async () => {
      // Before: the verdict is stored, the job was taken and never ran. The sweeper is the retry.
      const before = await succeeded();
      expect(await task(before.taskId)).toMatchObject({ status: 'working' });
      expect(await settlement.applyPending()).toBe(1);
      // After: it applied and died before it could say so; the queue hands the same job to another worker.
      const after = await succeeded();
      expect(await settlement.apply(after.operationId)).toBe('applied');
      const state = await snapshot(after.taskId, after.operationId);
      for (let again = 0; again < 3; again += 1) await dispatch.settle({ operationId: after.operationId });
      expect(await snapshot(after.taskId, after.operationId)).toEqual(state);
      expect(await lines()).toHaveLength(2);
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(2);
      expect(await wallet()).toMatchObject({ balance: START - 2 * PRICE, held: 0 });
    });
  });

  it('keeps the money right through everything at once, with no deadlock: settlements, sweeps, hands, claims and verdicts on one wallet (specs 27, 29)', async () => {
    const taken = number();
    await prisma.line.create({ data: { msisdn: taken, iccid: serial(), esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
    const crashed: string[] = [];
    const quiet = (run: Promise<unknown>) => run.catch((error: unknown) => { if (!(error instanceof OfficeFailure)) crashed.push(String((error as Error)?.message ?? error).slice(0, 200)); });
    const untouched: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const runs: Promise<unknown>[] = [];
      for (let each = 0; each < 3; each += 1) {
        const good = await succeeded();
        const exception = await succeeded({}, { msisdn: taken });
        const failed = await sent(await openTask());
        const unknownTask = await openTask();
        const unknown = await sent(unknownTask);
        const pendingTask = await openTask();
        const pending = await sent(pendingTask);
        const requestedTask = await openTask();
        const requested = await sent(requestedTask);
        await prisma.providerOperation.update({ where: { id: requested }, data: { status: 'requested', attempts: 0, sentAt: null, leaseUntil: null } });
        untouched.push(exception.taskId, unknownTask, pendingTask);
        runs.push(quiet(dispatch.operations.settle(failed, 1, { kind: 'refused', error: 'refused' })), quiet(dispatch.operations.settle(unknown, 1, { kind: 'no-answer', error: 'timeout' })));
        for (const id of [good.operationId, exception.operationId, failed, unknown, pending, requested]) {
          runs.push(quiet(settlement.apply(id)), quiet(settlement.apply(id)), quiet(dispatch.operations.claim(id)), quiet(dispatch.operations.recover(id, new Date())));
        }
        for (const taskId of [good.taskId, exception.taskId, unknownTask, pendingTask, requestedTask]) {
          runs.push(quiet(service.completeTask(owner, taskId, { note: 'x' })), quiet(service.rejectTask(owner, taskId, { reason: 'x' })), quiet(service.cancelTask(pos, taskId)));
        }
      }
      runs.push(quiet(settlement.applyPending()), quiet(settlement.applyPending()), ...Array.from({ length: 3 }, () => quiet(openTask())));
      await Promise.all(runs);
      await settlement.applyPending();
    }
    expect(crashed).toEqual([]);
    await expectWalletAddsUp();
    const rows = await prisma.officeTask.findMany({ where: { posId: ids.pos }, include: { providerOperation: true } });
    const done = rows.filter((row) => row.status === 'done');
    const closed = rows.filter((row) => row.status === 'cancelled');
    const all = await kinds();
    // One line and one charge for each task that is done; one release for each closed or captured hold; one hold each.
    expect(await lines()).toHaveLength(done.length + 1);
    expect(all.filter((kind) => kind === 'activate')).toHaveLength(done.length);
    expect(all.filter((kind) => kind === 'release')).toHaveLength(done.length + closed.length);
    expect(all.filter((kind) => kind === 'hold')).toHaveLength(rows.length);
    expect(done.length).toBeGreaterThanOrEqual(9);
    for (const row of rows) {
      const state = row.providerOperation;
      // A task settled by the system has its operation applied; an operation applied has its task done.
      if (state?.status === 'succeeded' && state.appliedAt) expect(row.status).toBe('done');
      if (row.status === 'done' && state) expect(['succeeded', 'failed']).toContain(state.status);
      if (state?.status === 'succeeded' && !state.appliedAt) expect([row.status, state.applyError]).toEqual(['working', 'number-taken']);
      if (row.status === 'working') expect(row.held).toBe(PRICE);
    }
    // Money untouched where it must not move: an exception, an unknown answer and an attempt in flight.
    for (const taskId of untouched) {
      const row = rows.find((candidate) => candidate.id === taskId);
      expect(row).toMatchObject({ status: 'working', held: PRICE, assigneeId: null });
    }
  });

  (redisUrl ? describe : describe.skip)('through the outbox and a real queue (Redis)', () => {
    let workers: Worker[] = [];
    let queues: Queue[] = [];
    let gateway: ScriptedGateway;
    let piped: ReturnType<typeof buildProviderDispatch>;

    /** The real relay, over this spec's own operations only. */
    class OwnMessages extends OutboxRepository {
      override claimUnpublished(db: Parameters<OutboxRepository['claimUnpublished']>[0], topics: string[], now: Date, leaseUntil: Date, limit: number) {
        return db.$queryRaw<ClaimedMessage[]>`
          UPDATE "OutboxMessage" SET "claimedUntil" = ${leaseUntil}
          WHERE "id" IN (
            SELECT m."id" FROM "OutboxMessage" m JOIN "ProviderOperation" o ON o."id" = m."aggregateId"
            WHERE o."providerId" = ${ids.provider} AND m."topic" = ANY(${topics}) AND m."publishedAt" IS NULL AND (m."claimedUntil" IS NULL OR m."claimedUntil" < ${now})
            ORDER BY m."createdAt", m."id" LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED
          )
          RETURNING "id", "topic", "aggregateId", "sequence", "payload"`;
      }
    }
    const until = async (check: () => Promise<boolean>) => {
      for (let waited = 0; waited < 20_000; waited += 50) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('the condition was not met in 20 s');
    };
    const connection = () => new IORedis(redisUrl as string, { maxRetriesPerRequest: null });

    beforeEach(() => {
      gateway = new ScriptedGateway();
      piped = buildProviderDispatch(prisma, redis as IORedis, gateway, prefix, dispatch.uow.notice);
      workers = [];
      queues = [new Queue(OPERATIONS_QUEUE, { connection: connection(), prefix }), new Queue(SETTLEMENTS_QUEUE, { connection: connection(), prefix })];
    });
    afterEach(async () => {
      await Promise.all(workers.map((worker) => worker.close()));
      for (const queue of queues) {
        await queue.obliterate({ force: true });
        await queue.close();
      }
      await piped.publisher.close();
    });

    it('carries an eSIM activation from the request to its line: sent once, settled once, and no part of the code in the output, the outbox, Redis or a notice (spec 24)', async () => {
      const taskId = await openTask({ esim: true });
      const [msisdn, iccid] = [number(), serial()];
      const operationRow = await prisma.providerOperation.create({ data: { idempotencyKey: operationKey(taskId), requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: `s8-${tag}`, taskId, status: 'requested' } });
      await prisma.outboxMessage.create({ data: { topic: OPERATION_REQUESTED, aggregateId: operationRow.id, sequence: 0, payload: { operationId: operationRow.id } } });
      gateway.next({ left: true, answer: 'confirmed', providerRef: 'REF-PIPE', result: { msisdn, iccid, esimCode: CODE } });
      const relay = new OutboxRelay(piped.uow, new OwnMessages(), piped.publisher, [OPERATION_REQUESTED, OPERATION_SETTLED]);
      notices = [];
      let redisDump = '';
      const output = await capturedOutput(async () => {
        // Two workers on each queue, as two worker processes would be.
        for (let each = 0; each < 2; each += 1) {
          workers.push(new Worker(OPERATIONS_QUEUE, (job) => piped.handle(job.data), { connection: connection(), prefix }));
          workers.push(new Worker(SETTLEMENTS_QUEUE, (job) => piped.settle(job.data), { connection: connection(), prefix }));
        }
        await until(async () => {
          await relay.runOnce();
          return (await task(taskId)).status === 'done';
        });
        // Everything the queue holds for this run, while the jobs are still kept.
        const scan = new IORedis(redisUrl as string, { maxRetriesPerRequest: 1 });
        try {
          const names = await scan.keys(`${prefix}:*`);
          redisDump = names.join('\n');
          for (const name of names) {
            const kind = await scan.type(name);
            if (kind === 'string') redisDump += (await scan.get(name)) ?? '';
            else if (kind === 'hash') redisDump += JSON.stringify(await scan.hgetall(name));
            else if (kind === 'list') redisDump += JSON.stringify(await scan.lrange(name, 0, -1));
            else if (kind === 'zset') redisDump += JSON.stringify(await scan.zrange(name, '0', '-1'));
            else if (kind === 'set') redisDump += JSON.stringify(await scan.smembers(name));
            else if (kind === 'stream') redisDump += JSON.stringify(await scan.xrange(name, '-', '+'));
          }
        } finally {
          scan.disconnect();
        }
      });

      // Sent once, applied once.
      expect(gateway.calls.map((call) => [call.attempt, call.idempotencyKey])).toEqual([[1, operationKey(taskId)]]);
      const [line] = await lines();
      expect(await lines()).toHaveLength(1);
      expect(line).toMatchObject({ msisdn, iccid, esim: true });
      expect(open(line.esimQr as string)).toMatch(/^data:image\/png;base64,/);
      const stored = await operation(operationRow.id);
      expect(stored).toMatchObject({ status: 'succeeded', providerRef: 'REF-PIPE', applyError: null });
      expect(stored.appliedAt).toBeInstanceOf(Date);
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(1);
      expect(await wallet()).toMatchObject({ held: 0 });
      // Both messages went out, each carrying the operation's id and nothing else.
      const outbox = await prisma.outboxMessage.findMany({ where: { aggregateId: operationRow.id } });
      expect(outbox.map((message) => [message.topic, message.payload, message.publishedAt !== null]).sort()).toEqual([[OPERATION_REQUESTED, { operationId: operationRow.id }, true], [OPERATION_SETTLED, { operationId: operationRow.id }, true]]);
      expect(redisDump.length).toBeGreaterThan(100);
      expect(redisDump).toContain(operationRow.id);

      // No part of the code: as the provider gave it, as it is sealed on the operation, as the line carries it.
      const picture = open(line.esimQr as string);
      const parts = (text: string, from: number) => Array.from({ length: 6 }, (_, at) => text.slice(from + at * 11, from + at * 11 + 16)).filter((part) => part.length === 16);
      const secrets = [...parts(CODE, 6), ...parts(stored.resultEsimCode as string, 8), ...parts(line.esimQr as string, 8), ...parts(picture, 120)];
      expect(secrets.length).toBeGreaterThan(18);
      // What PostgreSQL holds of it: the operation and the line carry it sealed only; every other row not at all.
      const sealedOnly = (text: string) => text.split(stored.resultEsimCode as string).join('').split(line.esimQr as string).join('');
      const database = sealedOnly(JSON.stringify([
        stored, line, await task(taskId), await entries(), outbox,
        await prisma.notice.findMany({ where: { userId: { in: [ids.owner, ids.accountant, ids.clerk, ids.pos] } } }),
        await prisma.activityEvent.findMany({ where: { at: { gte: new Date(Date.now() - 120_000) } } }),
      ]));
      const places = { output, redis: redisDump, outbox: JSON.stringify(outbox), notices: JSON.stringify(notices), entries: JSON.stringify(await entries()), task: JSON.stringify({ ...(await task(taskId)), esimQr: null }), database };
      for (const [place, text] of Object.entries(places)) for (const secret of secrets) expect([place, text.includes(secret)]).toEqual([place, false]);

      // The same jobs delivered again change nothing.
      const state = await snapshot(taskId, operationRow.id);
      await piped.handle({ operationId: operationRow.id });
      await piped.settle({ operationId: operationRow.id });
      expect(await snapshot(taskId, operationRow.id)).toEqual(state);
      expect(gateway.calls).toHaveLength(1);
    });
  });
});
