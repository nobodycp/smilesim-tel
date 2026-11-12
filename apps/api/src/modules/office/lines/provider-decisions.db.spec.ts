import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import request from 'supertest';
import { createPrismaClient } from '../../../db';
import { buildProviderDispatch } from '../../../provider-dispatch';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { open } from '../../shared/secret-box';
import { purgeActivity, purgeBefore } from '../activity/activity-log';
import { NoticeService } from '../notices/notice.service';
import { ScriptedGateway } from '../providers/testing/scripted-gateway';
import { OPERATION_REQUESTED, OPERATION_SETTLED } from '../providers/operations/provider-operations.repository';
import { PROVIDER_EXCEPTION_NOTES, PROVIDER_FAILED_NOTE, PROVIDER_RELEASED_NOTE, SYSTEM_SENDER_NAME } from '../stored-text';
import { officeTestApp } from '../testing/office-test-app';
import { operationKey } from './activation-settlement.rules';

// PostgreSQL only (TEST_DATABASE_URL), over HTTP. ADR 0019, D15 and D16; transactions T10 and T11; spec items 19
// to 22; plan slice S.9. The four decisions people take on a task's provider operation, through the two routes
// the office serves: who may, what each one writes, what the second account does, the permanent record, and what
// happens when several act at once. No sale records an operation yet (S.11), so each test opens a real task
// through the activation route and writes its operation by hand, as recovery or the settlement would have left it.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;
const CODE = 'LPA:1$smdp.s9-decisions.example$S9-SECRET-ACTIVATION-CODE-4H8D2K7P1R9T3V6Y0C5J';
const NOTE = 'Checked on the provider portal: the line is active there.';
const EVIDENCE = { evidenceKind: 'provider-portal', note: NOTE, providerRef: 'PORTAL-REF-77' };

type Answer = { status: number; body: Record<string, unknown> };
type State = 'unknown' | 'exception';

suite('decisions by people on a task\'s provider operation (PostgreSQL, HTTP)', () => {
  useSealingKey();
  jest.setTimeout(300_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const name = (who: string) => `s9-${tag}-${who}`;
  const ids = {
    owner: randomUUID(), acc1: randomUUID(), acc2: randomUUID(), clerk: randomUUID(), pos: randomUUID(), other: randomUUID(),
    provider: randomUUID(), company: randomUUID(), pkg: randomUUID(), role: randomUUID(), plain: randomUUID(),
  };
  const people = [ids.owner, ids.acc1, ids.acc2, ids.clerk, ids.pos, ids.other];
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let recorded: unknown[][];
  let dispatch: ReturnType<typeof buildProviderDispatch>;
  /** A session cookie per account; `entered` is the owner working as the second accountant. */
  const sid: Record<'owner' | 'acc1' | 'acc2' | 'clerk' | 'pos' | 'other' | 'entered', string> = { owner: '', acc1: '', acc2: '', clerk: '', pos: '', other: '', entered: '' };
  let notices: { to: string[]; kind: string; payload: Record<string, unknown>; actorId: string }[] = [];
  let breakNotices = 0;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const post = async (who: keyof typeof sid, path: string, body: Record<string, unknown> = {}): Promise<Answer> => {
    const response = await request(app.getHttpServer()).post(path).set('Cookie', `sid=${sid[who]}`).send(body);
    return { status: response.status, body: response.body as Record<string, unknown> };
  };
  const decide = (who: keyof typeof sid, taskId: string, decision: string, over: Record<string, unknown> = {}) => post(who, `/office/tasks/${taskId}/provider-decision`, { decision, ...EVIDENCE, ...over });
  const answer = (who: keyof typeof sid, taskId: string, approve: boolean) => post(who, `/office/tasks/${taskId}/provider-decision/approval`, { approve });
  /** A refusal as `status CODE`, or `200 outcome`. */
  const said = (got: Answer) => (got.status === 201 || got.status === 200 ? `ok ${String(got.body.outcome)}` : `${got.status} ${String(got.body.code)}`);

  const openTask = async (over: Record<string, unknown> = {}, by: keyof typeof sid = 'pos') => {
    const got = await post(by, '/office/lines', { packageCode: name('pkg'), posLoginName: name('pos'), outcome: 'fail', ...(over.esim ? {} : { iccid: serial() }), ...over });
    if (typeof got.body.taskId !== 'string') throw new Error(`the activation opened no task: ${got.status} ${JSON.stringify(got.body)}`);
    return got.body.taskId;
  };
  /** Writes the task's operation as recovery (`unknown`) or a settlement that could not apply (`exception`) left it. */
  const operationIn = async (taskId: string, state: State, over: Record<string, unknown> = {}) => {
    const shape: Record<State, Record<string, unknown>> = {
      unknown: { status: 'unknown', attempts: 1, lastAttemptAt: new Date(), sentAt: new Date(), lastError: 'timeout' },
      exception: { status: 'succeeded', attempts: 1, providerRef: 'REF-1', applyError: 'number-taken', applyFailedAt: new Date() },
    };
    const row = await prisma.providerOperation.create({
      data: { idempotencyKey: operationKey(taskId), requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: name('pkg'), taskId, ...shape[state], ...over } as never,
    });
    return row.id;
  };
  const waiting = async (state: State, over: Record<string, unknown> = {}, taskOver: Record<string, unknown> = {}, by: keyof typeof sid = 'pos') => {
    const taskId = await openTask(taskOver, by);
    return { taskId, operationId: await operationIn(taskId, state, over) };
  };

  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const task = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  const operation = (id: string) => prisma.providerOperation.findUniqueOrThrow({ where: { id } });
  const events = (operationId: string) => prisma.providerDecisionEvent.findMany({ where: { operationId }, orderBy: { sequence: 'asc' } });
  const steps = async (operationId: string) => (await events(operationId)).map((row) => `${row.sequence} ${row.type} ${row.decision} ${row.accountLoginName.replace(`s9-${tag}-`, '')}`);
  const kinds = async () => (await prisma.walletEntry.findMany({ where: { userId: ids.pos } })).map((row) => row.kind).sort();
  const lines = () => prisma.line.findMany({ where: { posId: ids.pos } });
  const takenLine = (msisdn: string, iccid: string = serial()) =>
    prisma.line.create({ data: { msisdn, iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.other, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
  /** Everything a refused or merely proposed decision must leave as it was. */
  const snapshot = async (taskId: string, operationId: string) => ({
    task: await task(taskId), operation: await operation(operationId), wallet: await wallet(), kinds: await kinds(), lines: (await lines()).length,
    outbox: await prisma.outboxMessage.count({ where: { aggregateId: operationId } }),
  });
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
  /**
   * Removes this spec's own decision events, which nothing in the product can: the table's triggers are switched
   * off for the length of one transaction, by the table's owner, and are back before it commits.
   */
  const forgetDecisions = async (operationIds: string[]) => {
    if (operationIds.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "ProviderDecisionEvent" DISABLE TRIGGER USER');
      await tx.$executeRaw`DELETE FROM "ProviderDecisionEvent" WHERE "operationId" = ANY(${operationIds})`;
      await tx.$executeRawUnsafe('ALTER TABLE "ProviderDecisionEvent" ENABLE TRIGGER USER');
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, who: string, layer: string, parentId: string | null, isBranchOwner = false, roleId: string | null = null) => ({ id, loginName: name(who), nickname: who, passwordHash: 'x', layer, parentId, isBranchOwner, roleId });
    // Two staff roles: one holds the grant that lets an account decide on a provider operation, one does not.
    await prisma.role.create({ data: { id: ids.role, name: name('accounting'), accounting: true, tasks: true, grants: 'read,accounting,tasks' } as never });
    await prisma.role.create({ data: { id: ids.plain, name: name('plain'), tasks: true, grants: 'read,tasks' } as never });
    const rows = [
      user(ids.owner, 'owner', 'branch', null, true), user(ids.acc1, 'acc1', 'branch', ids.owner, false, ids.role), user(ids.acc2, 'acc2', 'branch', ids.owner, false, ids.role),
      user(ids.clerk, 'clerk', 'branch', ids.owner, false, ids.plain), user(ids.pos, 'pos', 'pos', ids.owner), user(ids.other, 'other', 'pos', ids.owner),
    ];
    for (const row of rows) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.id === ids.pos ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    for (const who of ['owner', 'acc1', 'acc2', 'clerk', 'pos', 'other'] as const) sid[who] = await auth.saveSession({ userId: ids[who], scope: 'full', userAgent: '', ip: '' });
    sid.entered = await auth.saveImpersonation({ userId: ids.acc2, operatorId: ids.owner, userAgent: '', ip: '' });
    await prisma.provider.create({ data: { id: ids.provider, code: name('pkg'), name: 's9' } });
    await prisma.company.create({ data: { id: ids.company, code: name('pkg'), name: 's9' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.package.create({ data: { id: ids.pkg, code: name('pkg'), name: 's9 package', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // The real notice writer, with its audience narrowed to this spec's own accounts: a real notice goes to every
    // branch user in the database, the accounts of other spec files included.
    const own = new Set<string>(people);
    const real = new NoticeService();
    const notice = {
      write: async (tx: Parameters<NoticeService['write']>[0], audience: string[], actor: Parameters<NoticeService['write']>[2], draft: Parameters<NoticeService['write']>[3], options?: Parameters<NoticeService['write']>[4]) => {
        if (breakNotices > 0) {
          breakNotices -= 1;
          throw new Error('notices are down');
        }
        const written = await real.write(tx, audience.filter((id) => own.has(id)), actor, draft, options);
        notices.push({ to: written.map((row) => row.userId).sort(), kind: draft.kind, payload: draft.payload as unknown as Record<string, unknown>, actorId: actor.id });
        return written;
      },
      publish: async () => undefined,
    } as unknown as NoticeService;
    ({ app, recorded } = await officeTestApp(auth, prisma as unknown as Record<string, unknown>, notice));
    dispatch = buildProviderDispatch(prisma, {} as IORedis, new ScriptedGateway(), `s9-${tag}`, notice);
  });

  afterEach(async () => {
    breakNotices = 0;
    notices = [];
    recorded.length = 0;
    const rows = (await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } })).map((row) => row.id);
    await forgetDecisions(rows);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: rows } } });
    await prisma.providerOperation.deleteMany({ where: { providerId: ids.provider } });
    await prisma.notice.deleteMany({ where: { userId: { in: people } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: people } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: { in: [ids.pos, ids.other] } } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: people.filter((id) => id !== ids.owner) } } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.role.deleteMany({ where: { id: { in: [ids.role, ids.plain] } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  // ── Item 19 ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('confirm success (item 19)', () => {
    it('is refused for the submitter, a lower layer, an entered session, an account without the grant, a short note, no reference and no evidence: nothing changes', async () => {
      // Submitted by a branch accountant for the point of sale: that accountant decides nothing about it.
      const { taskId, operationId } = await waiting('unknown', {}, {}, 'acc1');
      const before = await snapshot(taskId, operationId);
      expect(before.wallet).toMatchObject({ balance: START, held: PRICE });
      expect(said(await decide('acc1', taskId, 'confirm-success'))).toBe('403 DECISION_OWN_TASK');
      expect(said(await decide('other', taskId, 'confirm-success'))).toBe('403 FORBIDDEN');
      expect(said(await decide('pos', taskId, 'confirm-success'))).toBe('403 FORBIDDEN');
      expect(said(await decide('entered', taskId, 'confirm-success'))).toBe('403 FORBIDDEN');
      expect(said(await decide('clerk', taskId, 'confirm-success'))).toBe('403 FORBIDDEN');
      expect(said(await decide('owner', taskId, 'confirm-success', { note: 'too short a note' }))).toBe('400 DECISION_NOTE_SHORT');
      expect(said(await decide('owner', taskId, 'confirm-success', { note: `   ${'x'.repeat(19)}        ` }))).toBe('400 DECISION_NOTE_SHORT');
      expect(said(await decide('owner', taskId, 'confirm-success', { providerRef: '   ' }))).toBe('400 DECISION_REFERENCE_REQUIRED');
      expect(said(await decide('owner', taskId, 'confirm-success', { evidenceKind: '' }))).toBe('400 DECISION_EVIDENCE_REQUIRED');
      expect(said(await decide('owner', taskId, 'confirm-success', { evidenceKind: 'a-feeling' }))).toBe('400 DECISION_EVIDENCE_REQUIRED');
      expect(said(await decide('owner', taskId, 'make-it-so'))).toBe('400 INVALID');
      expect(said(await decide('owner', randomUUID(), 'confirm-success'))).toBe('404 NOT_FOUND');
      // The decisions about an exception do not apply to an unknown operation.
      expect(said(await decide('owner', taskId, 'apply-corrected'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'release-after-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
      // Each refusal is on the activity record under the route's own event.
      expect(recorded.filter(([, , draft]) => (draft as { action: string }).action === 'provider_decision').every(([, , , result]) => result === 'fail')).toBe(true);
    });

    it('is refused for a task with no provider operation: a manual task is not decided on', async () => {
      const taskId = await openTask();
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await answer('owner', taskId, true))).toBe('409 DECISION_NO_PROPOSAL');
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
    });

    it('is accepted once by one account: the event, the move, one line and one capture in one transaction', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const opened = await task(taskId);
      const got = await decide('acc1', taskId, 'confirm-success');
      expect(got.body).toEqual({ ok: true, outcome: 'applied' });
      const row = await operation(operationId);
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'PORTAL-REF-77', applyError: null, lastError: null });
      expect(row.appliedAt).toBeInstanceOf(Date);
      expect(await task(taskId)).toMatchObject({ status: 'done', assigneeId: null });
      const made = await lines();
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ msisdn: opened.msisdn, iccid: opened.iccid, status: 'active', packageId: ids.pkg });
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      const written = await events(operationId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        sequence: 1, type: 'applied', decision: 'confirm-success', evidenceKind: 'provider-portal', providerRef: 'PORTAL-REF-77', note: NOTE,
        suppliedEsimCode: false, accountId: ids.acc1, accountLoginName: name('acc1'),
      });
      expect(written[0].createdAt).toBeInstanceOf(Date);
      // No message: nothing is left for the settlement, and nothing is ever sent again.
      expect(await prisma.outboxMessage.count({ where: { aggregateId: operationId } })).toBe(0);
      // The point of sale, which submitted it, is told its activation is done: in its own name, from «النظام» (D12).
      expect(notices.filter((notice) => notice.kind === 'task.done')).toEqual([expect.objectContaining({ actorId: ids.pos, to: expect.arrayContaining([ids.pos]), payload: expect.objectContaining({ handlerName: SYSTEM_SENDER_NAME }) })]);
      expect((await prisma.walletEntry.findMany({ where: { userId: ids.pos } })).map((entry) => entry.actorId)).toEqual([ids.pos, ids.pos, ids.pos]);
      // A second time, by anyone: refused, and nothing more is made or charged.
      expect(said(await decide('acc1', taskId, 'confirm-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'declare-failure'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await steps(operationId)).toEqual(['1 applied confirm-success acc1']);
      await expectWalletAddsUp();
    });

    it('confirmed by three accounts nine times at once: one line, one capture, one event', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const all = await Promise.all(['owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2'].map((who) => decide(who as 'owner', taskId, 'confirm-success')));
      const outcomes = all.map(said);
      expect(outcomes.filter((text) => text === 'ok applied')).toHaveLength(1);
      expect(outcomes.filter((text) => text !== 'ok applied').every((text) => text === '409 DECISION_NOT_APPLICABLE')).toBe(true);
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await events(operationId)).toHaveLength(1);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      await expectWalletAddsUp();
    });

    it('a fault after the line and the money were written rolls back whole: no event, no move, no line, the hold as it was', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const before = await snapshot(taskId, operationId);
      breakNotices = 1;
      expect((await decide('owner', taskId, 'confirm-success')).status).toBe(500);
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
      // The same decision goes through afterwards.
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('ok applied');
      await expectWalletAddsUp();
    });

    it('takes the number and the serial the provider really activated, and refuses a serial the company\'s rules refuse', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const [msisdn, iccid] = [number(), serial()];
      expect(said(await decide('owner', taskId, 'confirm-success', { msisdn: '12345' }))).toBe('400 INVALID');
      expect(said(await decide('owner', taskId, 'confirm-success', { msisdn, iccid }))).toBe('ok applied');
      expect(await operation(operationId)).toMatchObject({ status: 'succeeded', resultMsisdn: msisdn, resultIccid: iccid });
      expect((await lines())[0]).toMatchObject({ msisdn, iccid });
      expect(await task(taskId)).toMatchObject({ status: 'done', msisdn, iccid });
    });

    it('with no number anywhere names none: refused, and nothing is made up', async () => {
      const { taskId, operationId } = await waiting('unknown');
      await prisma.officeTask.update({ where: { id: taskId }, data: { msisdn: null } });
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('400 DECISION_NUMBER_REQUIRED');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
    });

    it('whose line cannot be made is still on record: succeeded with the exception of D16, the hold kept, and a correction closes it', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const opened = await task(taskId);
      await takenLine(opened.msisdn as string);
      const got = await decide('acc1', taskId, 'confirm-success');
      expect(got.body).toEqual({ ok: true, outcome: 'exception', reason: 'number-taken' });
      const row = await operation(operationId);
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'PORTAL-REF-77', applyError: 'number-taken', appliedAt: null });
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await lines()).toHaveLength(0);
      expect(await steps(operationId)).toEqual(['1 applied confirm-success acc1']);
      // The accounts that may decide are told as the settlement tells them: from «النظام», in the submitter's name.
      expect(notices.filter((notice) => notice.kind === 'task.note')).toEqual([expect.objectContaining({ actorId: ids.pos, to: [ids.acc1, ids.acc2, ids.owner].sort(), payload: expect.objectContaining({ taskId, excerpt: PROVIDER_EXCEPTION_NOTES['number-taken'] }) })]);
      // The sweeper leaves it alone, and it is closed by a correction: one line, one capture.
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      const msisdn = number();
      expect(said(await decide('acc2', taskId, 'apply-corrected', { msisdn }))).toBe('ok applied');
      expect(await steps(operationId)).toEqual(['1 applied confirm-success acc1', '2 applied apply-corrected acc2']);
      expect((await lines()).map((line) => line.msisdn)).toEqual([msisdn]);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      await expectWalletAddsUp();
    });

    it('of an eSIM needs its code; the code is sealed on the operation and the line and written to no event, notice or activity row', async () => {
      const { taskId, operationId } = await waiting('unknown', {}, { esim: true });
      const before = await snapshot(taskId, operationId);
      expect(before.task).toMatchObject({ esim: true, esimQr: null });
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('400 ESIM_CODE_REQUIRED');
      expect(said(await decide('owner', taskId, 'confirm-success', { esimCode: 'not an activation code' }))).toBe('400 ESIM_CODE_REQUIRED');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
      const iccid = serial();
      expect(said(await decide('owner', taskId, 'confirm-success', { iccid, esimCode: CODE }))).toBe('ok applied');
      const row = await operation(operationId);
      expect(row.resultEsimCode?.startsWith('v1:')).toBe(true);
      expect(open(row.resultEsimCode as string)).toBe(CODE);
      const [line] = await lines();
      expect(line).toMatchObject({ iccid, esim: true });
      expect(line.esimQr?.startsWith('v1:')).toBe(true);
      expect(open(line.esimQr as string)).toMatch(/^data:image\/png;base64,/);
      const written = await events(operationId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ suppliedEsimCode: true, type: 'applied' });
      const everything = JSON.stringify([written, notices, recorded, await prisma.notice.findMany({ where: { userId: { in: people } } }), await prisma.walletEntry.findMany({ where: { userId: ids.pos } }), await task(taskId)]);
      expect(everything).not.toContain(CODE);
      expect(everything).not.toContain('S9-SECRET');
      expect(everything).not.toContain((row.resultEsimCode as string).slice(10, 40));
    });
  });

  // ── D12: whose sale it is ───────────────────────────────────────────────────────────────────────────────

  describe('the submitter, the point of sale and the account that decides are three accounts (D12)', () => {
    const cases: [string, State, Record<string, unknown>][] = [['confirm-success', 'unknown', {}], ['apply-corrected', 'exception', { msisdn: '' }]];

    it.each(cases)('%s: the entry and the notice are the submitter\'s with «النظام» as the handler; the decider is in the decision record and the activity record only', async (decision, state, over) => {
      // Submitted by the clerk for the point of sale; decided by the first accountant.
      const { taskId, operationId } = await waiting(state, {}, {}, 'clerk');
      expect(await task(taskId)).toMatchObject({ submitterId: ids.clerk, posId: ids.pos });
      recorded.length = 0;
      notices = [];
      expect(said(await decide('acc1', taskId, decision, decision === 'apply-corrected' ? { ...over, msisdn: number() } : over))).toBe('ok applied');

      // The money: the point of sale's wallet, every entry in the submitter's name. Nothing names the decider.
      const entries = await prisma.walletEntry.findMany({ where: { userId: ids.pos } });
      expect(entries.map((entry) => entry.kind).sort()).toEqual(['activate', 'hold', 'release']);
      expect(entries.map((entry) => entry.actorId)).toEqual([ids.clerk, ids.clerk, ids.clerk]);
      expect(await prisma.walletEntry.count({ where: { OR: [{ userId: ids.acc1 }, { actorId: ids.acc1 }] } })).toBe(0);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      // The task: done, still its submitter's, taken by nobody.
      expect(await task(taskId)).toMatchObject({ status: 'done', submitterId: ids.clerk, posId: ids.pos, assigneeId: null });
      expect(await lines()).toHaveLength(1);
      // The notice: in the submitter's name, from «النظام», to the submitter and the point of sale.
      const done = notices.filter((notice) => notice.kind === 'task.done');
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({ actorId: ids.clerk, payload: expect.objectContaining({ taskId, handlerName: SYSTEM_SENDER_NAME }) });
      expect(done[0].to).toEqual(expect.arrayContaining([ids.clerk, ids.pos]));
      expect(JSON.stringify(notices)).not.toContain('acc1');
      expect((await prisma.notice.findMany({ where: { userId: { in: people } } })).every((row) => row.actorId === ids.clerk)).toBe(true);
      // The decision: the account that decided, in the permanent record and on the activity record.
      const written = await events(operationId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ type: 'applied', decision, accountId: ids.acc1, accountLoginName: name('acc1') });
      expect(recorded.map(([gate, , draft, result]) => [(gate as { sessionId: string }).sessionId, (draft as { action: string }).action, result])).toEqual([[sid.acc1, 'provider_decision', 'ok']]);
      await expectWalletAddsUp();
    });

    it('a confirmation whose line cannot be made tells the deciders in the submitter\'s name too, and moves no money', async () => {
      const { taskId, operationId } = await waiting('unknown', {}, {}, 'clerk');
      await takenLine((await task(taskId)).msisdn as string);
      notices = [];
      expect((await decide('acc1', taskId, 'confirm-success')).body).toEqual({ ok: true, outcome: 'exception', reason: 'number-taken' });
      expect(notices).toEqual([expect.objectContaining({ kind: 'task.note', actorId: ids.clerk, to: [ids.acc1, ids.acc2, ids.owner].sort() })]);
      expect((await events(operationId))[0]).toMatchObject({ accountId: ids.acc1 });
      expect(await kinds()).toEqual(['hold']);
    });
  });

  // ── Item 20 ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('declare failure (item 20)', () => {
    it('a proposal changes nothing: the operation stays unknown and the hold held', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const before = await snapshot(taskId, operationId);
      const got = await decide('acc1', taskId, 'declare-failure', { providerRef: '' });
      expect(got.body).toEqual({ ok: true, outcome: 'proposed' });
      expect(await snapshot(taskId, operationId)).toEqual(before);
      const written = await events(operationId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ sequence: 1, type: 'proposed', decision: 'declare-failure', evidenceKind: 'provider-portal', providerRef: null, note: NOTE, accountId: ids.acc1, accountLoginName: name('acc1') });
      // While it is open, nothing else is decided by a person; the manual path stays shut.
      expect(said(await decide('acc2', taskId, 'confirm-success'))).toBe('409 DECISION_PROPOSAL_OPEN');
      expect(said(await decide('acc2', taskId, 'declare-failure'))).toBe('409 DECISION_PROPOSAL_OPEN');
      expect(said(await post('owner', `/office/tasks/${taskId}/reject`, { reason: 'no' }))).toBe('409 DUPLICATE_REQUEST');
      expect(said(await post('pos', `/office/tasks/${taskId}/cancel`))).toBe('409 DUPLICATE_REQUEST');
      expect(await snapshot(taskId, operationId)).toEqual(before);
    });

    it('is not approved or refused by the proposer, the submitter, an entered session, an account without the grant or a lower layer', async () => {
      // Submitted by the second accountant; proposed by the owner.
      const { taskId, operationId } = await waiting('unknown', {}, {}, 'acc2');
      expect(said(await decide('owner', taskId, 'declare-failure'))).toBe('ok proposed');
      const before = await snapshot(taskId, operationId);
      for (const approve of [true, false]) {
        expect(said(await answer('owner', taskId, approve))).toBe('403 DECISION_OWN_PROPOSAL');
        expect(said(await answer('acc2', taskId, approve))).toBe('403 DECISION_OWN_TASK');
        expect(said(await answer('entered', taskId, approve))).toBe('403 FORBIDDEN');
        expect(said(await answer('clerk', taskId, approve))).toBe('403 FORBIDDEN');
        expect(said(await answer('pos', taskId, approve))).toBe('403 FORBIDDEN');
        expect(said(await answer('other', taskId, approve))).toBe('403 FORBIDDEN');
      }
      expect(said(await post('acc1', `/office/tasks/${taskId}/provider-decision/approval`, { approve: 'yes' }))).toBe('400 INVALID');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await steps(operationId)).toEqual(['1 proposed declare-failure owner']);
    });

    it('approved by a second authorised account: failed, the hold still held, and the task is the branch\'s', async () => {
      const { taskId, operationId } = await waiting('unknown');
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      const got = await answer('acc2', taskId, true);
      expect(got.body).toEqual({ ok: true, outcome: 'approved' });
      expect(await operation(operationId)).toMatchObject({ status: 'failed', appliedAt: null, applyError: null, lastError: 'timeout' });
      expect(await steps(operationId)).toEqual(['1 proposed declare-failure acc1', '2 approved declare-failure acc2']);
      const [, approval] = await events(operationId);
      expect(approval).toMatchObject({ evidenceKind: null, note: '', accountId: ids.acc2, accountLoginName: name('acc2') });
      // Nothing was released, and nothing is sent again: one settled message, none to send.
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await prisma.outboxMessage.count({ where: { aggregateId: operationId, topic: OPERATION_SETTLED } })).toBe(1);
      expect(await prisma.outboxMessage.count({ where: { aggregateId: operationId, topic: OPERATION_REQUESTED } })).toBe(0);
      // A second approval, and a decision about an unknown operation: refused.
      expect(said(await answer('owner', taskId, true))).toBe('409 DECISION_NO_PROPOSAL');
      expect(said(await decide('owner', taskId, 'confirm-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      // The settlement hands it to the branch (T6), which rejects it: the hold goes back once.
      // Neither the proposal nor the approval told anybody anything or moved the hold.
      expect(notices.filter((notice) => notice.payload.taskId === taskId && notice.kind !== 'task.opened')).toEqual([]);
      expect(await dispatch.settlement.apply(operationId)).toBe('handed-to-branch');
      // Handed over once: a repeated message and the sweeper find nothing to do and tell nobody again.
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      const handover = notices.filter((notice) => notice.payload.taskId === taskId && notice.payload.handlerName === SYSTEM_SENDER_NAME);
      expect(handover).toHaveLength(1);
      expect(handover[0]).toMatchObject({ kind: 'task.opened', actorId: ids.pos });
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE, note: PROVIDER_FAILED_NOTE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await kinds()).toEqual(['hold']);
      expect(said(await post('owner', `/office/tasks/${taskId}/reject`, { reason: 'the provider did not run it' }))).toBe('ok undefined');
      expect(await task(taskId)).toMatchObject({ status: 'cancelled' });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await kinds()).toEqual(['hold', 'release']);
      await expectWalletAddsUp();
    });

    it('once failed, the branch may complete it by hand instead: one line, one capture', async () => {
      const { taskId } = await waiting('unknown');
      expect(said(await decide('owner', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(said(await answer('acc1', taskId, true))).toBe('ok approved');
      expect(said(await post('acc2', `/office/tasks/${taskId}/complete`, { note: 'activated by hand' }))).toBe('ok undefined');
      expect(await lines()).toHaveLength(1);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      await expectWalletAddsUp();
    });

    it('a refusal closes the proposal and leaves unknown; a new proposal may then be made and approved', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      const got = await answer('acc2', taskId, false);
      expect(got.body).toEqual({ ok: true, outcome: 'refused' });
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(said(await answer('owner', taskId, true))).toBe('409 DECISION_NO_PROPOSAL');
      // The refuser proposes it themselves; the first proposer may now approve.
      expect(said(await decide('acc2', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(said(await answer('acc2', taskId, true))).toBe('403 DECISION_OWN_PROPOSAL');
      expect(said(await answer('acc1', taskId, true))).toBe('ok approved');
      expect(await steps(operationId)).toEqual(['1 proposed declare-failure acc1', '2 refused declare-failure acc2', '3 proposed declare-failure acc2', '4 approved declare-failure acc1']);
      expect(await operation(operationId)).toMatchObject({ status: 'failed' });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    });
  });

  // ── Item 21 ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('release after success (item 21)', () => {
    it('a proposal changes nothing; approved by a second account, the task is rejected and the hold released once, and the provider\'s success stays on record', async () => {
      const { taskId, operationId } = await waiting('exception', { resultMsisdn: '0500000042' });
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('acc1', taskId, 'release-after-success'))).toBe('ok proposed');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(said(await answer('acc1', taskId, true))).toBe('403 DECISION_OWN_PROPOSAL');
      expect(said(await answer('pos', taskId, true))).toBe('403 FORBIDDEN');
      expect(said(await answer('entered', taskId, true))).toBe('403 FORBIDDEN');
      expect(said(await decide('acc2', taskId, 'apply-corrected', { msisdn: number() }))).toBe('409 DECISION_PROPOSAL_OPEN');
      expect(await snapshot(taskId, operationId)).toEqual(before);

      expect((await answer('acc2', taskId, true)).body).toEqual({ ok: true, outcome: 'approved' });
      expect(await task(taskId)).toMatchObject({ status: 'cancelled', resultNote: PROVIDER_RELEASED_NOTE, assigneeId: ids.acc2 });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await lines()).toHaveLength(0);
      // The operation is what it was: the provider ran it, and that is never rewritten. Nothing is sent again.
      expect(await operation(operationId)).toEqual(before.operation);
      expect(await prisma.outboxMessage.count({ where: { aggregateId: operationId } })).toBe(0);
      expect(await steps(operationId)).toEqual(['1 proposed release-after-success acc1', '2 approved release-after-success acc2']);
      expect(notices.filter((notice) => notice.kind === 'task.rejected')).toEqual([expect.objectContaining({ actorId: ids.acc2, to: expect.arrayContaining([ids.pos]), payload: expect.objectContaining({ reason: PROVIDER_RELEASED_NOTE }) })]);

      // Twice: every further decision is refused, and no money moves again.
      expect(said(await answer('owner', taskId, true))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'release-after-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'apply-corrected', { msisdn: number() }))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await events(operationId)).toHaveLength(2);
      await expectWalletAddsUp();
    });

    it('refused by the second account, the exception and the hold stay, and a correction may still be applied', async () => {
      const { taskId, operationId } = await waiting('exception');
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('owner', taskId, 'release-after-success'))).toBe('ok proposed');
      expect(said(await answer('acc1', taskId, false))).toBe('ok refused');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(said(await decide('acc1', taskId, 'apply-corrected', { msisdn: number() }))).toBe('ok applied');
      expect(await steps(operationId)).toEqual(['1 proposed release-after-success owner', '2 refused release-after-success acc1', '3 applied apply-corrected acc1']);
      expect(await lines()).toHaveLength(1);
      await expectWalletAddsUp();
    });
  });

  describe('apply corrected (item 21)', () => {
    it('one account, one line, one capture; twice is refused', async () => {
      const { taskId, operationId } = await waiting('exception');
      const opened = await task(taskId);
      await takenLine(opened.msisdn as string);
      const msisdn = number();
      // The same refusals as any decision.
      expect(said(await decide('pos', taskId, 'apply-corrected', { msisdn }))).toBe('403 FORBIDDEN');
      expect(said(await decide('entered', taskId, 'apply-corrected', { msisdn }))).toBe('403 FORBIDDEN');
      expect(said(await decide('clerk', taskId, 'apply-corrected', { msisdn }))).toBe('403 FORBIDDEN');
      expect(said(await decide('owner', taskId, 'apply-corrected', { msisdn, note: 'short' }))).toBe('400 DECISION_NOTE_SHORT');
      expect(said(await decide('owner', taskId, 'confirm-success', { msisdn }))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'declare-failure'))).toBe('409 DECISION_NOT_APPLICABLE');

      expect((await decide('acc1', taskId, 'apply-corrected', { msisdn, providerRef: '' })).body).toEqual({ ok: true, outcome: 'applied' });
      const row = await operation(operationId);
      // Applied, and still the record of what happened: the provider's reference and why it could not be applied.
      expect(row).toMatchObject({ status: 'succeeded', providerRef: 'REF-1', applyError: 'number-taken' });
      expect(row.appliedAt).toBeInstanceOf(Date);
      expect((await lines()).map((line) => line.msisdn)).toEqual([msisdn]);
      expect(await task(taskId)).toMatchObject({ status: 'done', msisdn, assigneeId: null });
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      expect(await steps(operationId)).toEqual(['1 applied apply-corrected acc1']);

      expect(said(await decide('acc1', taskId, 'apply-corrected', { msisdn: number() }))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', taskId, 'release-after-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await lines()).toHaveLength(1);
      expect(await events(operationId)).toHaveLength(1);
      await expectWalletAddsUp();
    });

    it('applied by three accounts nine times at once, each with another number: one line, one capture, one event', async () => {
      const { taskId, operationId } = await waiting('exception');
      const all = await Promise.all(['owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2'].map((who) => decide(who as 'owner', taskId, 'apply-corrected', { msisdn: number() })));
      const outcomes = all.map(said);
      expect(outcomes.filter((text) => text === 'ok applied')).toHaveLength(1);
      expect(outcomes.filter((text) => text !== 'ok applied').every((text) => text === '409 DECISION_NOT_APPLICABLE')).toBe(true);
      expect(await lines()).toHaveLength(1);
      expect(await events(operationId)).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      await expectWalletAddsUp();
    });

    it('with data that is taken too changes nothing: the exception, the hold and the record stay, and the refusal says what was taken', async () => {
      const { taskId, operationId } = await waiting('exception');
      const [takenNumber, takenSerial] = [number(), serial()];
      await takenLine(takenNumber, takenSerial);
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('owner', taskId, 'apply-corrected', { msisdn: takenNumber }))).toBe('409 NUMBER_TAKEN');
      expect(said(await decide('owner', taskId, 'apply-corrected', { msisdn: number(), iccid: takenSerial }))).toBe('409 SIM_TAKEN');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
      // The attempt is on the activity record, as a refusal with its code.
      expect(recorded.map(([, , draft, result, reason]) => [(draft as { action: string }).action, result, reason]).filter(([action]) => action === 'provider_decision')).toEqual([['provider_decision', 'fail', 'NUMBER_TAKEN'], ['provider_decision', 'fail', 'SIM_TAKEN']]);
      // What the activity record keeps of a refused attempt: the action, the task and the refusal's code. Not the
      // number, the serial, the note, the reference or anything else that was sent.
      const kept = JSON.stringify(recorded.map(([, , draft, result, reason]) => [draft, result, reason]));
      for (const sent of [takenNumber, takenSerial, NOTE, EVIDENCE.providerRef]) expect(kept).not.toContain(sent);
      expect(recorded.every(([, , draft]) => Object.keys(draft as object).sort().join() === 'action,subjectKind,subjectRef')).toBe(true);
      expect(said(await decide('owner', taskId, 'apply-corrected', { msisdn: number() }))).toBe('ok applied');
      await expectWalletAddsUp();
    });

    it('a fault after the line and the money were written rolls back whole', async () => {
      const { taskId, operationId } = await waiting('exception');
      const before = await snapshot(taskId, operationId);
      breakNotices = 1;
      expect((await decide('owner', taskId, 'apply-corrected', { msisdn: number() })).status).toBe(500);
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);
    });

    it('on an eSIM whose code never came (esim-code-missing): without a code nothing changes; with one the line is made and the code is sealed, and in no record', async () => {
      const [msisdn, iccid] = [number(), serial()];
      const { taskId, operationId } = await waiting('exception', { applyError: 'esim-code-missing', resultMsisdn: msisdn, resultIccid: iccid }, { esim: true });
      const before = await snapshot(taskId, operationId);
      expect(said(await decide('owner', taskId, 'apply-corrected'))).toBe('400 ESIM_CODE_REQUIRED');
      expect(said(await decide('owner', taskId, 'apply-corrected', { esimCode: '    ' }))).toBe('400 ESIM_CODE_REQUIRED');
      expect(said(await decide('owner', taskId, 'apply-corrected', { esimCode: 'x'.repeat(513) }))).toBe('400 INVALID');
      // Not an activation code: a number, a sentence, a code with a space or with no address.
      for (const esimCode of ['0521234567', 'the code is on the portal', 'LPA:1$smdp.example.com$AB CD', 'LPA:1$$ABCD', 'LPA:2$smdp.example.com$ABCD', `${CODE}\nmore`]) {
        expect(said(await decide('owner', taskId, 'apply-corrected', { esimCode }))).toBe('400 ESIM_CODE_REQUIRED');
      }
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await events(operationId)).toEqual([]);

      expect(said(await decide('acc1', taskId, 'apply-corrected', { esimCode: CODE }))).toBe('ok applied');
      const [line] = await lines();
      expect(line).toMatchObject({ msisdn, iccid, esim: true });
      expect(line.esimQr?.startsWith('v1:')).toBe(true);
      expect(open(line.esimQr as string)).toMatch(/^data:image\/png;base64,/);
      const written = await events(operationId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ type: 'applied', decision: 'apply-corrected', suppliedEsimCode: true, accountId: ids.acc1 });
      const row = await operation(operationId);
      expect(row).toMatchObject({ applyError: 'esim-code-missing', resultEsimCode: null });
      const everything = JSON.stringify([written, row, notices, recorded, await prisma.notice.findMany({ where: { userId: { in: people } } }), await prisma.walletEntry.findMany({ where: { userId: ids.pos } })]);
      expect(everything).not.toContain(CODE);
      expect(everything).not.toContain('S9-SECRET');
      // The price the task was opened at, the eSIM fee included: what it held is what it was charged.
      expect(before.task.held).toBeGreaterThanOrEqual(PRICE);
      expect(await wallet()).toMatchObject({ balance: START - (before.task.held as number), held: 0 });
      await expectWalletAddsUp();
    });
  });

  // ── Item 22 ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('the permanent record (item 22)', () => {
    it('an UPDATE, a DELETE and a TRUNCATE of what the routes wrote are refused by the database', async () => {
      const { taskId, operationId } = await waiting('unknown');
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(said(await answer('acc2', taskId, false))).toBe('ok refused');
      const before = await events(operationId);
      const appendOnly = /append-only/;
      await expect(prisma.providerDecisionEvent.updateMany({ where: { operationId }, data: { accountLoginName: 'someone-else' } })).rejects.toThrow(appendOnly);
      await expect(prisma.providerDecisionEvent.update({ where: { id: before[0].id }, data: { note: 'A different story, long enough to pass.' } })).rejects.toThrow(appendOnly);
      await expect(prisma.providerDecisionEvent.deleteMany({ where: { operationId } })).rejects.toThrow(appendOnly);
      await expect(prisma.$executeRawUnsafe(`UPDATE "ProviderDecisionEvent" SET "type" = 'approved' WHERE "operationId" = '${operationId}'`)).rejects.toThrow(appendOnly);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "ProviderDecisionEvent" WHERE "operationId" = '${operationId}'`)).rejects.toThrow(appendOnly);
      await expect(prisma.$executeRawUnsafe('TRUNCATE "ProviderDecisionEvent"')).rejects.toThrow(appendOnly);
      // The operation it belongs to cannot be removed from under it either.
      await expect(prisma.providerOperation.delete({ where: { id: operationId } })).rejects.toThrow();
      expect(await events(operationId)).toEqual(before);
    });

    it('three accounts proposing at once produce one open proposal', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const before = await snapshot(taskId, operationId);
      const all = await Promise.all(['owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2', 'owner', 'acc1', 'acc2'].map((who) => decide(who as 'owner', taskId, 'declare-failure')));
      const outcomes = all.map(said);
      expect(outcomes.filter((text) => text === 'ok proposed')).toHaveLength(1);
      expect(outcomes.filter((text) => text !== 'ok proposed').every((text) => text === '409 DECISION_PROPOSAL_OPEN')).toBe(true);
      expect(await events(operationId)).toHaveLength(1);
      expect(await snapshot(taskId, operationId)).toEqual(before);
    });

    it('two accounts approving one proposal at once: one approval, the hold released once', async () => {
      const { taskId, operationId } = await waiting('exception');
      expect(said(await decide('acc1', taskId, 'release-after-success'))).toBe('ok proposed');
      const all = await Promise.all(['owner', 'acc2', 'owner', 'acc2', 'owner', 'acc2', 'owner', 'acc2'].map((who) => answer(who as 'owner', taskId, true)));
      const outcomes = all.map(said);
      expect(outcomes.filter((text) => text === 'ok approved')).toHaveLength(1);
      expect(outcomes.filter((text) => text !== 'ok approved').every((text) => text === '409 DECISION_NOT_APPLICABLE')).toBe(true);
      expect(await events(operationId)).toHaveLength(2);
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      await expectWalletAddsUp();
    });

    it('an approval and a refusal of one proposal at once: one of them, never both', async () => {
      for (let round = 0; round < 6; round += 1) {
        const { taskId, operationId } = await waiting('unknown');
        expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
        const [approved, refused] = await Promise.all([answer('acc2', taskId, true), answer('owner', taskId, false)]);
        const outcomes = [said(approved), said(refused)];
        expect(outcomes.filter((text) => text.startsWith('ok '))).toHaveLength(1);
        expect(await events(operationId)).toHaveLength(2);
        const row = await operation(operationId);
        expect(row.status).toBe(outcomes[0] === 'ok approved' ? 'failed' : 'unknown');
        expect(await wallet()).toMatchObject({ balance: START });
      }
      await expectWalletAddsUp();
    });

    it('the sequence runs 1, 2, 3… per operation, and each row names its account and its time', async () => {
      const first = await waiting('unknown');
      const second = await waiting('unknown');
      for (const [proposer, refuser] of [['acc1', 'acc2'], ['acc2', 'owner'], ['owner', 'acc1']] as const) {
        expect(said(await decide(proposer, first.taskId, 'declare-failure'))).toBe('ok proposed');
        expect(said(await answer(refuser, first.taskId, false))).toBe('ok refused');
      }
      expect(said(await decide('owner', second.taskId, 'declare-failure'))).toBe('ok proposed');
      const written = await events(first.operationId);
      expect(written.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(written.map((row) => row.accountId)).toEqual([ids.acc1, ids.acc2, ids.acc2, ids.owner, ids.owner, ids.acc1]);
      expect(written.every((row) => row.createdAt instanceof Date && row.accountLoginName.startsWith(`s9-${tag}-`))).toBe(true);
      expect((await events(second.operationId)).map((row) => row.sequence)).toEqual([1]);
    });

    it('the worker\'s activity purge removes old activity events and leaves the decision events untouched', async () => {
      const { taskId, operationId } = await waiting('unknown');
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(said(await answer('acc2', taskId, true))).toBe('ok approved');
      const before = await events(operationId);
      const old = await prisma.activityEvent.create({ data: { at: new Date(purgeBefore().getTime() - 86_400_000), actorId: ids.acc1, actorLoginName: name('acc1'), actorLayer: 'branch', action: 'provider_decision', result: 'ok', subjectKind: 'task', subjectRef: taskId } });
      const fresh = await prisma.activityEvent.create({ data: { actorId: ids.acc2, actorLoginName: name('acc2'), actorLayer: 'branch', action: 'provider_decision_approval', result: 'ok', subjectKind: 'task', subjectRef: taskId } });
      const total = await prisma.providerDecisionEvent.count();
      expect(await purgeActivity(prisma)).toBeGreaterThanOrEqual(1);
      expect(await prisma.activityEvent.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await prisma.activityEvent.findUnique({ where: { id: fresh.id } })).not.toBeNull();
      expect(await events(operationId)).toEqual(before);
      expect(await prisma.providerDecisionEvent.count()).toBeGreaterThanOrEqual(total);
      await prisma.activityEvent.deleteMany({ where: { id: fresh.id } });
    });
  });

  // ── The locks ───────────────────────────────────────────────────────────────────────────────────────────

  describe('under the operation\'s row lock', () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** Holds the operation's row, as a settlement or another decision would, until `release` is called. */
    const holdOperation = async (operationId: string, last?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>) => {
      let release = () => undefined as void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let held = () => undefined as void;
      const taken = new Promise<void>((resolve) => { held = resolve; });
      const done = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ProviderOperation" WHERE "id" = ${operationId} FOR UPDATE`;
        held();
        await gate;
        // What the holder writes before it commits: the row as the waiting transactions will find it.
        if (last) await last(tx);
      }, { timeout: 60_000, maxWait: 20_000 });
      await taken;
      return { release: async () => { release(); await done; } };
    };

    it('proposals wait for it, write nothing meanwhile, and are judged again once they have it: one proposal', async () => {
      const { taskId, operationId } = await waiting('unknown');
      const lock = await holdOperation(operationId);
      let settled = 0;
      const runs = (['owner', 'acc1', 'acc2'] as const).map((who) => decide(who, taskId, 'declare-failure').finally(() => { settled += 1; }));
      await sleep(700);
      // All three passed the first, unlocked question and now wait on the row: nothing is written and none answered.
      expect(settled).toBe(0);
      expect(await events(operationId)).toEqual([]);
      await lock.release();
      const outcomes = (await Promise.all(runs)).map(said).sort();
      expect(outcomes).toEqual(['409 DECISION_PROPOSAL_OPEN', '409 DECISION_PROPOSAL_OPEN', 'ok proposed']);
      expect(await events(operationId)).toHaveLength(1);
    });

    it('approvals wait for it and are judged again once they have it: the hold is released once', async () => {
      const { taskId, operationId } = await waiting('exception');
      expect(said(await decide('acc1', taskId, 'release-after-success'))).toBe('ok proposed');
      const lock = await holdOperation(operationId);
      let settled = 0;
      const runs = (['owner', 'acc2'] as const).map((who) => answer(who, taskId, true).finally(() => { settled += 1; }));
      await sleep(700);
      expect(settled).toBe(0);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await events(operationId)).toHaveLength(1);
      await lock.release();
      const outcomes = (await Promise.all(runs)).map(said).sort();
      expect(outcomes).toEqual(['409 DECISION_NOT_APPLICABLE', 'ok approved']);
      expect(await kinds()).toEqual(['hold', 'release']);
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      await expectWalletAddsUp();
    });

    it('a confirmation waits for it; the provider\'s answer that held it is what counts, and the person\'s is refused', async () => {
      const { taskId, operationId } = await waiting('unknown');
      // The row's holder is the provider's late refusal: it commits before the person's transaction reads the row.
      const lock = await holdOperation(operationId, (tx) => tx.providerOperation.update({ where: { id: operationId }, data: { status: 'failed', lastError: 'refused' } }));
      let settled = 0;
      const run = decide('owner', taskId, 'confirm-success').finally(() => { settled += 1; });
      await sleep(700);
      expect(settled).toBe(0);
      expect(await lines()).toHaveLength(0);
      await lock.release();
      expect(said(await run)).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await lines()).toHaveLength(0);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await events(operationId)).toEqual([]);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    });
  });

  describe('a task that is no longer open', () => {
    it('is not applied to and not released again, whatever its operation says: no line, no money, no event', async () => {
      const confirm = await waiting('unknown');
      const correct = await waiting('exception');
      const release = await waiting('exception');
      expect(said(await decide('acc1', release.taskId, 'release-after-success'))).toBe('ok proposed');
      // Written past the product: the tasks are closed and their holds given back by hand.
      await prisma.officeTask.updateMany({ where: { id: { in: [confirm.taskId, correct.taskId, release.taskId] } }, data: { status: 'cancelled' } });
      await prisma.wallet.update({ where: { userId: ids.pos }, data: { held: 0 } });
      const before = [await snapshot(confirm.taskId, confirm.operationId), await snapshot(correct.taskId, correct.operationId), await snapshot(release.taskId, release.operationId)];
      expect(said(await decide('owner', confirm.taskId, 'confirm-success'))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await decide('owner', correct.taskId, 'apply-corrected', { msisdn: number() }))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(said(await answer('acc2', release.taskId, true))).toBe('409 DECISION_NOT_APPLICABLE');
      expect([await snapshot(confirm.taskId, confirm.operationId), await snapshot(correct.taskId, correct.operationId), await snapshot(release.taskId, release.operationId)]).toEqual(before);
      expect(await events(confirm.operationId)).toEqual([]);
      expect(await events(correct.operationId)).toEqual([]);
      expect(await events(release.operationId)).toHaveLength(1);
      expect(await lines()).toHaveLength(0);
      await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    });
  });

  // ── The provider's own answer and the settlement, against people ────────────────────────────────────────

  describe('the provider\'s late answer against a person\'s decision', () => {
    const confirmed = (result?: { msisdn?: string | null }) => ({ kind: 'confirmed' as const, providerRef: 'REF-LATE', result: result ?? null });

    it('arrives while a proposal is open: it is recorded and applied, and the stale proposal can only be refused', async () => {
      const { taskId, operationId } = await waiting('unknown');
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(await dispatch.operations.settle(operationId, 1, confirmed())).toBe('succeeded');
      expect(await dispatch.settlement.apply(operationId)).toBe('applied');
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      // The approval is about a state the operation has left: it moves nothing.
      const before = await snapshot(taskId, operationId);
      expect(said(await answer('acc2', taskId, true))).toBe('409 DECISION_NOT_APPLICABLE');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(said(await answer('acc2', taskId, false))).toBe('ok refused');
      expect(await snapshot(taskId, operationId)).toEqual(before);
      expect(await steps(operationId)).toEqual(['1 proposed declare-failure acc1', '2 refused declare-failure acc2']);
      expect(await lines()).toHaveLength(1);
      await expectWalletAddsUp();
    });

    it('arrives after the failure was approved: it changes nothing, and nothing is applied', async () => {
      const { taskId, operationId } = await waiting('unknown');
      expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
      expect(said(await answer('acc2', taskId, true))).toBe('ok approved');
      await expect(dispatch.operations.settle(operationId, 1, confirmed())).rejects.toMatchObject({ status: 409 });
      expect(await operation(operationId)).toMatchObject({ status: 'failed', providerRef: null });
      expect(await dispatch.settlement.apply(operationId)).toBe('handed-to-branch');
      expect(await lines()).toHaveLength(0);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    });

    it('races the approval of a declared failure, twenty times: the hold is captured once or kept, never both and never neither', async () => {
      for (let round = 0; round < 20; round += 1) {
        const { taskId, operationId } = await waiting('unknown');
        expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
        const [approval, verdict] = await Promise.all([
          answer('acc2', taskId, true),
          dispatch.operations.settle(operationId, 1, confirmed()).then(() => dispatch.settlement.apply(operationId), () => 'refused'),
        ]);
        const row = await operation(operationId);
        const current = await task(taskId);
        if (said(approval) === 'ok approved') {
          expect(verdict).toBe('refused');
          expect(row.status).toBe('failed');
          expect(current).toMatchObject({ status: 'working', held: PRICE });
        } else {
          expect(said(approval)).toBe('409 DECISION_NOT_APPLICABLE');
          expect(verdict).toBe('applied');
          expect(row.status).toBe('succeeded');
          expect(current.status).toBe('done');
        }
        // Whatever won, a late approval or settlement adds nothing.
        await answer('owner', taskId, true);
        await dispatch.settlement.apply(operationId);
        expect(await prisma.line.count({ where: { posId: ids.pos, msisdn: current.msisdn as string } })).toBe(row.status === 'succeeded' ? 1 : 0);
      }
      await expectWalletAddsUp();
    });

    it('races a confirmation by a person, twenty times: one line and one capture, whoever wins', async () => {
      for (let round = 0; round < 20; round += 1) {
        const { taskId, operationId } = await waiting('unknown');
        const [decision] = await Promise.all([
          decide('owner', taskId, 'confirm-success'),
          dispatch.operations.settle(operationId, 1, confirmed()).then(() => dispatch.settlement.apply(operationId), () => 'refused'),
          dispatch.settlement.apply(operationId),
        ]);
        expect(['ok applied', '409 DECISION_NOT_APPLICABLE']).toContain(said(decision));
        await dispatch.settlement.apply(operationId);
        const row = await operation(operationId);
        expect(row.status).toBe('succeeded');
        expect(row.appliedAt).toBeInstanceOf(Date);
        expect((await task(taskId)).status).toBe('done');
        expect(await events(operationId)).toHaveLength(said(decision) === 'ok applied' ? 1 : 0);
      }
      expect(await lines()).toHaveLength(20);
      expect(await wallet()).toMatchObject({ balance: START - 20 * PRICE, held: 0 });
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(20);
      await expectWalletAddsUp();
    });
  });

  // ── Everything against everything ───────────────────────────────────────────────────────────────────────

  it('decisions, approvals, the settlement and the manual path run against each other: nothing is aborted as a deadlock, no hold is captured or released twice', async () => {
    const unknown = await Promise.all(Array.from({ length: 8 }, () => waiting('unknown')));
    const exceptions = await Promise.all(Array.from({ length: 8 }, () => waiting('exception')));
    // Half of each already carries a proposal by the first accountant.
    for (const { taskId } of unknown.slice(0, 4)) expect(said(await decide('acc1', taskId, 'declare-failure'))).toBe('ok proposed');
    for (const { taskId } of exceptions.slice(0, 4)) expect(said(await decide('acc1', taskId, 'release-after-success'))).toBe('ok proposed');
    const late = { kind: 'confirmed' as const, providerRef: 'REF-MIX', result: null };
    // One unknown operation and one exception at a time, everything about each of them at once (seventeen
    // transactions that meet on two tasks, two operations and one wallet). Eight such waves: the client's pool is
    // ten connections, and a hundred and thirty transactions started at once are refused for want of one, which
    // is a limit of the pool and says nothing about the locks.
    const settled: PromiseSettledResult<Answer | string>[] = [];
    for (let wave = 0; wave < unknown.length; wave += 1) {
      const u = unknown[wave];
      const e = exceptions[wave];
      settled.push(...(await Promise.allSettled<Answer | string>([
        decide('owner', u.taskId, 'confirm-success'), decide('acc2', u.taskId, 'declare-failure'), answer('acc2', u.taskId, true), answer('owner', u.taskId, false),
        post('owner', `/office/tasks/${u.taskId}/reject`, { reason: 'mixed' }), post('pos', `/office/tasks/${u.taskId}/cancel`), post('acc2', `/office/tasks/${u.taskId}/complete`, { note: 'mixed' }),
        dispatch.operations.settle(u.operationId, 1, late).then(() => dispatch.settlement.apply(u.operationId), () => 'refused'), dispatch.settlement.apply(u.operationId),
        // The dispatcher and recovery come by too: neither may take an operation that is unknown or settled.
        dispatch.operations.claim(u.operationId).then((attempt) => `claim:${String(attempt)}`), dispatch.operations.recover(u.operationId).then((status) => `recover:${String(status)}`),
        dispatch.operations.claim(e.operationId).then((attempt) => `claim:${String(attempt)}`),
        decide('owner', e.taskId, 'apply-corrected', { msisdn: number() }), decide('acc2', e.taskId, 'release-after-success'), answer('acc2', e.taskId, true), answer('owner', e.taskId, true), answer('owner', e.taskId, false),
        post('owner', `/office/tasks/${e.taskId}/reject`, { reason: 'mixed' }), post('pos', `/office/tasks/${e.taskId}/cancel`), dispatch.settlement.apply(e.operationId),
      ])));
    }
    // A deadlock, or any other fault, would be a rejection or a 500.
    expect(settled.filter((run) => run.status === 'rejected')).toEqual([]);
    const statuses = settled.map((run) => (run.status === 'fulfilled' && typeof run.value === 'object' ? run.value.status : 200));
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
    // Nothing was taken for another send: every claim and every recovery found nothing to do.
    const dispatcher = settled.flatMap((run) => (run.status === 'fulfilled' && typeof run.value === 'string' && /^(claim|recover):/.test(run.value) ? [run.value] : []));
    expect(dispatcher).toHaveLength(24);
    expect(new Set(dispatcher)).toEqual(new Set(['claim:null', 'recover:null']));
    expect(await prisma.outboxMessage.count({ where: { topic: OPERATION_REQUESTED, aggregateId: { in: [...unknown, ...exceptions].map((row) => row.operationId) } } })).toBe(0);
    // Each task ended in exactly one way, and its money says the same.
    for (const { taskId, operationId } of [...unknown, ...exceptions]) {
      const [current, row, sale, releases] = await Promise.all([
        task(taskId), operation(operationId),
        prisma.line.count({ where: { posId: ids.pos, msisdn: (await task(taskId)).msisdn as string } }),
        steps(operationId),
      ]);
      const approvedRelease = releases.some((step) => step.includes('approved release-after-success'));
      if (current.status === 'done') expect([sale, Boolean(row.appliedAt), approvedRelease]).toEqual([1, true, false]);
      else if (current.status === 'cancelled') expect([sale, approvedRelease || row.status === 'failed']).toEqual([0, true]);
      else expect([current.status, sale, row.appliedAt]).toEqual(['working', 0, row.status === 'failed' ? row.appliedAt : null]);
      const sequences = (await events(operationId)).map((event) => event.sequence);
      expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    }
    const done = await prisma.officeTask.count({ where: { posId: ids.pos, status: 'done' } });
    expect(await lines()).toHaveLength(done);
    expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(done);
    await expectWalletAddsUp();
  });
});
