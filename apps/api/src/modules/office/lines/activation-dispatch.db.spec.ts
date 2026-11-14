import { openGate } from '../providers/testing/open-gate';
import { useSealingKey } from '../../shared/testing/sealing-key';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import request from 'supertest';
import { createPrismaClient } from '../../../db';
import { buildProviderDispatch } from '../../../provider-dispatch';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { DuplicateGuardInterceptor } from '../../shared/duplicate-guard.interceptor';
import { open } from '../../shared/secret-box';
import { NoticeService } from '../../notifications/notice.service';
import { OPERATION_REQUESTED, OPERATION_SETTLED } from '../providers/operations/provider-operations.repository';
import { ProviderOperationsService } from '../providers/operations/provider-operations.service';
import { ScriptedGateway } from '../providers/testing/scripted-gateway';
import { PROVIDER_DISPATCH_NOTE, PROVIDER_EXCEPTION_NOTES, PROVIDER_FAILED_NOTE, PROVIDER_UNKNOWN_NOTE, SYSTEM_SENDER_NAME } from '../stored-text';
import { officeTestApp } from '../testing/office-test-app';
import { operationKey } from './activation-settlement.rules';

// PostgreSQL only (TEST_DATABASE_URL), over HTTP. ADR 0019, D3, D5, D13, D14; transaction T1; spec items 1, 4
// and 28; plan slice S.11. An automatic activation at a provider the gateway takes on the dispatch route opens its
// task, its reservation, its hold, its provider operation and the operation's outbox message in one transaction,
// and calls no provider. No gateway the application builds takes any provider on that route
// (`provider-dispatch-off.spec.ts`): here the scripted gateway of the specs stands in, for this spec's own
// provider, and the same requests are sent to an application with the real gateway to show they take no such route.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;
const CODE = 'LPA:1$smdp.s11-opening.example$S11-SECRET-ACTIVATION-CODE-3T8V1N6Q';

type Answer = { status: number; body: Record<string, unknown>; replay: string | undefined };
/** One statement of the next request that fails: before it runs, or (`after`) once it has been written. */
type Fault = { model: string; operation: string; after?: boolean } | null;

suite('opening an activation on the dispatch route (PostgreSQL, HTTP)', () => {
  useSealingKey();
  jest.setTimeout(300_000);
  const before = { url: process.env.DATABASE_URL, dispatch: process.env.PROVIDER_DISPATCH };
  const tag = randomUUID().slice(0, 8);
  const name = (who: string) => `s11-${tag}-${who}`;
  const ids = {
    owner: randomUUID(), pos: randomUUID(), other: randomUUID(), poor: randomUUID(),
    provider: randomUUID(), plain: randomUUID(), company: randomUUID(), pkg: randomUUID(), manual: randomUUID(), elsewhere: randomUUID(),
  };
  const people = [ids.owner, ids.pos, ids.other, ids.poor];
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  /** The same application as it is deployed: the simulated gateway, which takes nothing on the dispatch route. */
  let real: INestApplication;
  let recorded: unknown[][];
  let gateway: ScriptedGateway;
  let dispatch: ReturnType<typeof buildProviderDispatch>;
  const sid: Record<'owner' | 'pos' | 'other' | 'poor', string> = { owner: '', pos: '', other: '', poor: '' };
  let notices: { to: string[]; kind: string; payload: Record<string, unknown>; actorId: string }[] = [];
  /** What the next request meets: one statement that fails. */
  let fault: Fault = null;
  /** How often the application recorded a provider operation: the step of T1 that a repeat must not take again. */
  let recordIn: jest.SpyInstance;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const key = () => `s11-key-${randomUUID()}`;
  const send = async (to: INestApplication, who: keyof typeof sid, path: string, body: Record<string, unknown> = {}, idempotencyKey?: string): Promise<Answer> => {
    const call = request(to.getHttpServer()).post(path).set('Cookie', `sid=${sid[who]}`);
    const response = await (idempotencyKey ? call.set('Idempotency-Key', idempotencyKey) : call).send(body);
    return { status: response.status, body: response.body as Record<string, unknown>, replay: response.headers['idempotent-replay'] as string | undefined };
  };
  const sale = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ packageCode: name('pkg'), posLoginName: name('pos'), iccid: serial(), ...over });
  const activate = (who: keyof typeof sid, body: Record<string, unknown>, idempotencyKey?: string) => send(app, who, '/office/lines', body, idempotencyKey);
  const said = (got: Answer) => (got.status < 300 ? `ok ${got.body.applied === false ? 'task' : 'line'}` : `${got.status} ${String(got.body.code)}`);
  /** A dispatched activation, opened: its task and its operation. */
  const opened = async (over: Record<string, unknown> = {}) => {
    const got = await activate('pos', sale(over), key());
    if (typeof got.body.taskId !== 'string') throw new Error(`nothing was opened: ${got.status} ${JSON.stringify(got.body)}`);
    const row = await prisma.providerOperation.findUniqueOrThrow({ where: { taskId: got.body.taskId } });
    return { taskId: got.body.taskId, operationId: row.id };
  };

  const wallet = (userId: string = ids.pos) => prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const tasks = () => prisma.officeTask.findMany({ where: { posId: { in: people } }, orderBy: { createdAt: 'asc' } });
  const task = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  const operations = () => prisma.providerOperation.findMany({ where: { providerId: { in: [ids.provider, ids.plain] } } });
  const operation = (id: string) => prisma.providerOperation.findUniqueOrThrow({ where: { id } });
  const outbox = async (topic?: string) => prisma.outboxMessage.findMany({ where: { aggregateId: { in: (await operations()).map((row) => row.id) }, ...(topic ? { topic } : {}) } });
  const entries = (userId: string = ids.pos) => prisma.walletEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const kinds = async () => (await entries()).map((row) => row.kind).sort();
  const lines = () => prisma.line.findMany({ where: { posId: { in: people } } });
  /** Everything a request that must change nothing leaves as it was. */
  const everything = async () => ({ tasks: await tasks(), operations: await operations(), outbox: (await outbox()).length, wallet: await wallet(), entries: (await entries()).length, lines: (await lines()).length, notices: await prisma.notice.count({ where: { userId: { in: people } } }) });
  /**
   * What must hold after anything: every open dispatched task has exactly one operation and every operation its
   * task; held is the open tasks' holds; the balance moved by exactly the entries.
   */
  const expectInvariants = async () => {
    const [state, all, ops, moved] = await Promise.all([wallet(), tasks(), operations(), prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } })]);
    const mine = all.filter((row) => row.posId === ids.pos);
    expect(state.held).toBe(mine.filter((row) => row.status === 'working').reduce((sum, row) => sum + row.held, 0));
    expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
    expect(moved._sum.held ?? 0).toBe(state.held);
    // No operation without its task, none shared, and each under the task's own key.
    expect(ops.every((row) => row.taskId !== null && all.some((item) => item.id === row.taskId) && row.idempotencyKey === operationKey(row.taskId))).toBe(true);
    expect(new Set(ops.map((row) => row.taskId)).size).toBe(ops.length);
    // No dispatched task without its operation.
    const dispatched = all.filter((row) => row.note === PROVIDER_DISPATCH_NOTE);
    expect(dispatched.filter((row) => !ops.some((item) => item.taskId === row.id))).toEqual([]);
    // One `requested` message for the first send of each operation, never two.
    const firstSends = (await outbox(OPERATION_REQUESTED)).filter((message) => message.sequence === 0);
    expect(firstSends.map((message) => message.aggregateId).sort()).toEqual(ops.map((row) => row.id).sort());
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const plain = createPrismaClient();
    // The application's client, with one way to make a single statement fail once: fault injection inside T1.
    const faulty = plain.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!fault || fault.model !== model || fault.operation !== operation) return query(args);
            const { after } = fault;
            fault = null;
            if (!after) throw new Error(`injected fault at ${model}.${operation}`);
            // The statement is written, and the transaction then fails before it can commit.
            await query(args);
            throw new Error(`injected fault after ${model}.${operation}`);
          },
        },
      },
    });
    prisma = plain;
    const auth = new MemoryAuthStore();
    const user = (id: string, who: string, layer: string, parentId: string | null, isBranchOwner = false) => ({ id, loginName: name(who), nickname: who, passwordHash: 'x', layer, parentId, isBranchOwner });
    const rows = [user(ids.owner, 'owner', 'branch', null, true), user(ids.pos, 'pos', 'pos', ids.owner), user(ids.other, 'other', 'pos', ids.owner), user(ids.poor, 'poor', 'pos', ids.owner)];
    for (const row of rows) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.id === ids.poor ? 100 : row.id === ids.owner ? 0 : START, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    for (const who of ['owner', 'pos', 'other', 'poor'] as const) sid[who] = await auth.saveSession({ userId: ids[who], scope: 'full', userAgent: '', ip: '' });
    // Two providers: the spec's gateway takes the first on the dispatch route and not the second.
    await prisma.provider.create({ data: { id: ids.provider, code: name('pkg'), name: 's11' } });
    await prisma.provider.create({ data: { id: ids.plain, code: name('plain'), name: 's11 plain' } });
    await prisma.company.create({ data: { id: ids.company, code: name('pkg'), name: 's11', esim: true } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.package.create({ data: { id: ids.pkg, code: name('pkg'), name: 's11 package', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // The same provider, a package the office runs by hand; and an automatic package at the other provider.
    await prisma.package.create({ data: { id: ids.manual, code: name('manual'), name: 's11 manual', providerId: ids.provider, companyId: ids.company, ...prices, ...auto, autoActivate: false } });
    await prisma.package.create({ data: { id: ids.elsewhere, code: name('elsewhere'), name: 's11 elsewhere', providerId: ids.plain, companyId: ids.company, ...prices, ...auto } });
    const own = new Set<string>(people);
    const writer = new NoticeService();
    const notice = {
      write: async (tx: Parameters<NoticeService['write']>[0], audience: string[], actor: Parameters<NoticeService['write']>[2], draft: Parameters<NoticeService['write']>[3], options?: Parameters<NoticeService['write']>[4]) => {
        const written = await writer.write(tx, audience.filter((id) => own.has(id)), actor, draft, options);
        notices.push({ to: written.map((row) => row.userId).sort(), kind: draft.kind, payload: draft.payload as unknown as Record<string, unknown>, actorId: actor.id });
        return written;
      },
      publish: async () => undefined,
    } as unknown as NoticeService;
    gateway = new ScriptedGateway();
    gateway.dispatching.add(name('pkg'));
    ({ app, recorded } = await officeTestApp(auth, faulty as unknown as Record<string, unknown>, notice, [], gateway));
    recordIn = jest.spyOn(app.get(ProviderOperationsService), 'recordIn');
    ({ app: real } = await officeTestApp(auth, plain as unknown as Record<string, unknown>, notice));
    dispatch = buildProviderDispatch(plain, {} as IORedis, openGate(gateway), `s11-${tag}`, notice);
  });

  afterEach(async () => {
    fault = null;
    recordIn.mockClear();
    notices = [];
    recorded.length = 0;
    gateway.calls.length = 0;
    const rows = (await operations()).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: rows } } });
    await prisma.providerOperation.deleteMany({ where: { id: { in: rows } } });
    await prisma.notice.deleteMany({ where: { userId: { in: people } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: people } } });
    await prisma.officeTask.deleteMany({ where: { posId: { in: people } } });
    await prisma.line.deleteMany({ where: { posId: { in: people } } });
    for (const id of [ids.pos, ids.other]) await prisma.wallet.update({ where: { userId: id }, data: { balance: START, held: 0, ceiling: 0 } });
    await prisma.wallet.update({ where: { userId: ids.poor }, data: { balance: 100, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await app.close();
    await real.close();
    await prisma.package.deleteMany({ where: { id: { in: [ids.pkg, ids.manual, ids.elsewhere] } } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.provider, ids.plain] } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: people.filter((id) => id !== ids.owner) } } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.dispatch === undefined) delete process.env.PROVIDER_DISPATCH;
    else process.env.PROVIDER_DISPATCH = before.dispatch;
  });

  // ── T1 ──────────────────────────────────────────────────────────────────────────────────────────────────

  describe('T1: the task, its hold, the operation and its message are one transaction (item 1)', () => {
    it('HTTP → task → hold → operation → outbox, and no provider is called', async () => {
      const body = sale({ msisdn: number() });
      const got = await activate('pos', body, key());
      expect(got.status).toBe(201);
      expect(Object.keys(got.body).sort()).toEqual(['applied', 'taskId']);
      expect(got.body.applied).toBe(false);
      const taskId = got.body.taskId as string;
      // The task: an open activation that holds its price and reserves its serial and its number.
      expect(await task(taskId)).toMatchObject({ action: 'activate', status: 'working', posId: ids.pos, submitterId: ids.pos, packageId: ids.pkg, posDelta: -PRICE, held: PRICE, unitPrice: PRICE, msisdn: body.msisdn, iccid: body.iccid, note: PROVIDER_DISPATCH_NOTE, assigneeId: null });
      expect((await task(taskId)).requestKey).toMatch(/^[0-9a-f]{64}$/);
      // The hold: taken once, nothing charged.
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(await kinds()).toEqual(['hold']);
      // The operation: requested, the task's own (unique), under the task's key, with what the provider is to be asked.
      const ops = await operations();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ taskId, idempotencyKey: `activate:${taskId}`, status: 'requested', attempts: 0, action: 'activate', providerId: ids.provider, packageCode: name('pkg'), msisdn: body.msisdn, iccid: body.iccid, lineId: null, sentAt: null, appliedAt: null, applyError: null, providerRef: null, resultEsimCode: null });
      // The message that has it sent: one, the first of its operation, carrying the operation's id and nothing else.
      const messages = await outbox();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ topic: OPERATION_REQUESTED, aggregateId: ops[0].id, sequence: 0, payload: { operationId: ops[0].id }, publishedAt: null });
      // No line yet, and the provider was not called: by the request, or by anything it started.
      expect(await lines()).toHaveLength(0);
      expect(gateway.calls).toEqual([]);
      // Nobody is told a task opened: there is nothing for the branch to take while the provider has it, and a
      // notice saying so would be untrue. No notice row exists for it at all.
      expect(notices).toEqual([]);
      expect(await prisma.notice.count({ where: { userId: { in: people } } })).toBe(0);
      expect(recordIn).toHaveBeenCalledTimes(1);
      // The request is on the activity record once, as an activation.
      expect(recorded.map(([, , draft, result]) => [(draft as { action: string }).action, result])).toEqual([['activate', 'ok']]);
      await expectInvariants();
    });

    it('the simulation\'s hint does not choose the route, and is not needed on it', async () => {
      for (const outcome of ['success', 'fail', undefined, 'anything']) {
        const got = await activate('pos', sale(outcome === undefined ? {} : { outcome }), key());
        expect(said(got)).toBe('ok task');
      }
      expect(await operations()).toHaveLength(4);
      expect(await lines()).toHaveLength(0);
      expect(gateway.calls).toEqual([]);
      await expectInvariants();
    });

    it('a package the office runs by hand, and a provider the gateway does not take, stay on the manual route: a plain task, no operation', async () => {
      // No key is needed on the manual route, and one sent is honoured.
      const byHand = await activate('pos', sale({ packageCode: name('manual') }));
      const elsewhere = await activate('pos', sale({ packageCode: name('elsewhere') }), key());
      expect([said(byHand), said(elsewhere)]).toEqual(['ok task', 'ok task']);
      expect(await operations()).toEqual([]);
      expect(await outbox()).toEqual([]);
      expect(recordIn).not.toHaveBeenCalled();
      expect((await tasks()).map((row) => row.note)).not.toContain(PROVIDER_DISPATCH_NOTE);
      // A manual task is announced to the branch's handlers as it always was: one `task.opened` each.
      expect(notices.map((notice) => [notice.kind, notice.actorId, notice.to])).toEqual([['task.opened', ids.pos, [ids.owner]], ['task.opened', ids.pos, [ids.owner]]]);
      expect(await wallet()).toMatchObject({ balance: START, held: 2 * PRICE });
      // They are the branch's at once, as before.
      const taskId = byHand.body.taskId as string;
      expect((await send(app, 'owner', `/office/tasks/${taskId}/complete`, { note: 'by hand' })).status).toBeLessThan(300);
      expect(await lines()).toHaveLength(1);
      await expectInvariants();
    });

    it('an eSIM whose serial the provider issues is opened with no serial and no code, and carries neither', async () => {
      const got = await activate('pos', { packageCode: name('pkg'), posLoginName: name('pos'), esim: true }, key());
      expect(said(got)).toBe('ok task');
      const row = await task(got.body.taskId as string);
      expect(row).toMatchObject({ esim: true, iccid: null, esimQr: null });
      expect(row.held).toBeGreaterThanOrEqual(PRICE);
      expect((await operations())[0]).toMatchObject({ iccid: null, resultEsimCode: null });
      await expectInvariants();
    });
  });

  // ── Item 4 ──────────────────────────────────────────────────────────────────────────────────────────────

  describe('the request key (item 4)', () => {
    it('is required on the dispatch route: without one, or with a malformed one, nothing is opened', async () => {
      const start = await everything();
      expect(said(await activate('pos', sale()))).toBe('400 REQUEST_KEY_REQUIRED');
      expect(said(await activate('pos', sale(), ''))).toBe('400 REQUEST_KEY_REQUIRED');
      expect(said(await activate('pos', sale(), 'short'))).toBe('400 INVALID');
      expect(said(await activate('pos', sale(), 'has spaces in the key'))).toBe('400 INVALID');
      expect(await everything()).toEqual(start);
      expect(gateway.calls).toEqual([]);
    });

    it('the same key and the same request answer the first task: nothing is held, recorded, queued or told again', async () => {
      const body = sale({ msisdn: number() });
      const idempotencyKey = key();
      const first = await activate('pos', body, idempotencyKey);
      const after = await everything();
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const again = await activate('pos', body, idempotencyKey);
        expect([again.status, again.body, again.replay]).toEqual([201, { applied: false, taskId: first.body.taskId }, 'true']);
      }
      expect(await everything()).toEqual(after);
      expect(after.tasks).toHaveLength(1);
      expect(after.operations).toHaveLength(1);
      expect(after.outbox).toBe(1);
      // The step that records the operation ran for the first request and for none of the repeats, and no notice
      // was written by any of them.
      expect(recordIn).toHaveBeenCalledTimes(1);
      expect(notices).toEqual([]);
      // The first is on the activity record; the repeats are not.
      expect(recorded.filter(([, , draft]) => (draft as { action: string }).action === 'activate')).toHaveLength(1);
      await expectInvariants();
    });

    it('the same key with another request is 400 INVALID, and changes nothing', async () => {
      const idempotencyKey = key();
      const body = sale({ msisdn: number() });
      expect(said(await activate('pos', body, idempotencyKey))).toBe('ok task');
      const after = await everything();
      expect(said(await activate('pos', { ...body, msisdn: number() }, idempotencyKey))).toBe('400 INVALID');
      expect(said(await activate('pos', { ...body, iccid: serial() }, idempotencyKey))).toBe('400 INVALID');
      expect(said(await activate('pos', { ...body, packageCode: name('manual') }, idempotencyKey))).toBe('400 INVALID');
      expect(await everything()).toEqual(after);
    });

    it('a key is its account\'s: the same text from another account opens that account\'s own task and operation', async () => {
      const idempotencyKey = key();
      const mine = await activate('pos', sale(), idempotencyKey);
      const theirs = await activate('other', sale({ posLoginName: name('other') }), idempotencyKey);
      expect([said(mine), said(theirs)]).toEqual(['ok task', 'ok task']);
      expect(theirs.body.taskId).not.toBe(mine.body.taskId);
      expect(theirs.replay).toBeUndefined();
      const ops = await operations();
      expect(ops.map((row) => row.taskId).sort()).toEqual([mine.body.taskId, theirs.body.taskId].sort());
      expect((await wallet(ids.other)).held).toBe(PRICE);
      // And the other account is not answered with this one's task by sending its key and its body.
      const body = sale({ msisdn: number() });
      const own = key();
      const first = await activate('pos', body, own);
      const probe = await activate('other', body, own);
      expect(probe.body.taskId).not.toBe(first.body.taskId);
    });

    it.each([10, 30, 50])('%i identical requests at once open one task, one hold, one operation and one message', async (count) => {
      const body = sale({ msisdn: number() });
      const idempotencyKey = key();
      const all = await Promise.all(Array.from({ length: count }, () => activate('pos', body, idempotencyKey)));
      expect(all.map((got) => got.status).filter((status) => status !== 201)).toEqual([]);
      expect(new Set(all.map((got) => got.body.taskId)).size).toBe(1);
      expect(all.filter((got) => got.replay === 'true')).toHaveLength(count - 1);
      expect(await tasks()).toHaveLength(1);
      expect(await operations()).toHaveLength(1);
      expect(await outbox()).toHaveLength(1);
      expect(await kinds()).toEqual(['hold']);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      // Of all of them, one reached the step that records the operation; the others were answered before it.
      expect(recordIn).toHaveBeenCalledTimes(1);
      expect(notices).toEqual([]);
      expect(gateway.calls).toEqual([]);
      await expectInvariants();
    });

    it('thirty requests at once, each with its own key, for one serial: one is opened, the rest are refused and hold nothing', async () => {
      const iccid = serial();
      const all = await Promise.all(Array.from({ length: 30 }, () => activate('pos', sale({ iccid }), key())));
      const outcomes = all.map(said);
      expect(outcomes.filter((text) => text === 'ok task')).toHaveLength(1);
      expect(outcomes.filter((text) => text !== 'ok task').every((text) => text === '409 SIM_TAKEN')).toBe(true);
      expect(await operations()).toHaveLength(1);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      await expectInvariants();
    });

    it('with the duplicate guard\'s store down, the database still answers a repeat and still opens one task', async () => {
      // The guard in front of the route, with a store that fails every call: it lets the request through.
      const guard = new DuplicateGuardInterceptor();
      const down = async () => { throw new Error('redis is away'); };
      guard.store = { claim: down, save: down, drop: down };
      const auth = new MemoryAuthStore();
      const row = { id: ids.pos, loginName: name('pos'), nickname: 'pos', passwordHash: 'x', layer: 'pos', parentId: ids.owner, isBranchOwner: false };
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
      const session = await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' });
      const guarded = await officeTestApp(auth, prisma as unknown as Record<string, unknown>, { write: async () => [], publish: async () => undefined } as unknown as NoticeService, [guard], gateway);
      try {
        const body = sale({ msisdn: number() });
        const idempotencyKey = key();
        const call = () => request(guarded.app.getHttpServer()).post('/office/lines').set('Cookie', `sid=${session}`).set('Idempotency-Key', idempotencyKey).send(body);
        const all = await Promise.all(Array.from({ length: 12 }, call));
        expect(all.map((response) => response.status).filter((status) => status !== 201)).toEqual([]);
        expect(new Set(all.map((response) => (response.body as { taskId: string }).taskId)).size).toBe(1);
        const later = await call();
        expect((later.body as { taskId: string }).taskId).toBe((all[0].body as { taskId: string }).taskId);
        expect(await tasks()).toHaveLength(1);
        expect(await operations()).toHaveLength(1);
        expect(await outbox()).toHaveLength(1);
        expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      } finally {
        await guarded.app.close();
        await guard.onModuleDestroy();
      }
    });
  });

  // ── Rollback ────────────────────────────────────────────────────────────────────────────────────────────

  describe('a failure anywhere in T1 leaves nothing', () => {
    const faults: [string, () => void][] = [
      ['the task\'s insert', () => { fault = { model: 'OfficeTask', operation: 'createMany' }; }],
      ['the operation\'s insert', () => { fault = { model: 'ProviderOperation', operation: 'createMany' }; }],
      ['the outbox message', () => { fault = { model: 'OutboxMessage', operation: 'create' }; }],
      ['the hold on the wallet', () => { fault = { model: 'Wallet', operation: 'update' }; }],
      ['the hold\'s ledger entry', () => { fault = { model: 'WalletEntry', operation: 'create' }; }],
      ['the end: every write made, and a failure before the commit', () => { fault = { model: 'WalletEntry', operation: 'create', after: true }; }],
      ['the message, once it is written', () => { fault = { model: 'OutboxMessage', operation: 'create', after: true }; }],
    ];
    it.each(faults)('a fault at %s: no task, no hold, no operation, no message, no notice; the same request then goes through', async (_where, arm) => {
      const start = await everything();
      const body = sale({ msisdn: number() });
      const idempotencyKey = key();
      arm();
      const failed = await activate('pos', body, idempotencyKey);
      expect(failed.status).toBe(500);
      // The fault was met: the request did reach that statement.
      expect(fault).toBeNull();
      expect(await everything()).toEqual(start);
      expect(gateway.calls).toEqual([]);
      await expectInvariants();
      // Nothing was left behind to block it: the serial and the number are free, and the key was not used.
      const again = await activate('pos', body, idempotencyKey);
      expect([said(again), again.replay]).toEqual(['ok task', undefined]);
      expect(await operations()).toHaveLength(1);
      expect(await outbox()).toHaveLength(1);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      await expectInvariants();
    });

    it('a serial or a number that is taken, by a line or by an open task, refuses before anything is held or recorded', async () => {
      const [takenNumber, takenSerial] = [number(), serial()];
      await prisma.line.create({ data: { msisdn: takenNumber, iccid: takenSerial, esim: false, status: 'active', packageId: ids.pkg, posId: ids.other, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      const reserved = sale({ msisdn: number() });
      expect(said(await activate('pos', reserved, key()))).toBe('ok task');
      const start = await everything();
      expect(said(await activate('pos', sale({ msisdn: takenNumber }), key()))).toBe('409 NUMBER_TAKEN');
      expect(said(await activate('pos', sale({ iccid: takenSerial }), key()))).toBe('409 SIM_TAKEN');
      // Reserved by the open dispatched task, for another account too.
      expect(said(await activate('other', sale({ posLoginName: name('other'), iccid: reserved.iccid }), key()))).toBe('409 SIM_TAKEN');
      expect(said(await activate('other', sale({ posLoginName: name('other'), msisdn: reserved.msisdn }), key()))).toBe('409 NUMBER_TAKEN');
      expect(await everything()).toEqual(start);
      expect((await wallet(ids.other)).held).toBe(0);
      await expectInvariants();
    });

    it('a wallet that cannot cover the price refuses, and the task and the operation go with the hold', async () => {
      const got = await activate('poor', sale({ posLoginName: name('poor') }), key());
      expect(said(got)).toBe('400 BALANCE_CEILING');
      expect(await prisma.officeTask.count({ where: { posId: ids.poor } })).toBe(0);
      expect(await operations()).toEqual([]);
      expect(await outbox()).toEqual([]);
      expect(await wallet(ids.poor)).toMatchObject({ balance: 100, held: 0 });
      expect(await prisma.walletEntry.count({ where: { userId: ids.poor } })).toBe(0);
    });

    it('who may sell, what is sold and how are judged before anything is written', async () => {
      const start = await everything();
      // Another point of sale's wallet, an unknown package, a serial the rules refuse, no serial at all.
      expect(said(await activate('pos', sale({ posLoginName: name('other') }), key()))).toBe('403 FORBIDDEN');
      expect(said(await activate('pos', sale({ packageCode: 'no-such-package' }), key()))).toBe('404 NOT_FOUND');
      expect(said(await activate('pos', { packageCode: name('pkg'), posLoginName: name('pos') }, key()))).toBe('400 INVALID');
      expect(await everything()).toEqual(start);
    });
  });

  // ── No early send ───────────────────────────────────────────────────────────────────────────────────────

  describe('the application as it is deployed takes no sale on this route and sends nothing', () => {
    it.each(['1', undefined])('with PROVIDER_DISPATCH=%s: an automatic activation is answered by the simulation or opens a plain task, and no operation is ever recorded', async (flag) => {
      if (flag) process.env.PROVIDER_DISPATCH = flag;
      else delete process.env.PROVIDER_DISPATCH;
      // The same package and provider the spec's gateway dispatches, through the real gateway.
      const done = await send(real, 'pos', '/office/lines', sale({ outcome: 'success' }), key());
      const refused = await send(real, 'pos', '/office/lines', sale({ outcome: 'fail' }), key());
      const keyless = await send(real, 'pos', '/office/lines', sale({ outcome: 'fail' }));
      expect([said(done), said(refused), said(keyless)]).toEqual(['ok line', 'ok task', 'ok task']);
      expect(await operations()).toEqual([]);
      expect(await prisma.outboxMessage.count({ where: { createdAt: { gt: new Date(Date.now() - 10_000) }, topic: OPERATION_REQUESTED, aggregateId: { in: (await tasks()).map((row) => row.id) } } })).toBe(0);
      expect((await tasks()).map((row) => row.note)).toEqual([PROVIDER_FAILED_NOTE, PROVIDER_FAILED_NOTE]);
      expect(gateway.calls).toEqual([]);
    });

    it('an operation that does get recorded is sent nowhere by the worker\'s own gateway: it is put back, and fails after its attempts, with the hold kept', async () => {
      const { taskId, operationId } = await opened();
      // The dispatcher as the worker builds it today: over the simulated gateway.
      const { SimulatedProviderGateway } = await import('../providers/gateway/simulated-gateway');
      const worker = buildProviderDispatch(prisma, {} as IORedis, openGate(new SimulatedProviderGateway()), `s11w-${tag}`, { write: async () => [], publish: async () => undefined } as unknown as NoticeService);
      for (let attempt = 0; attempt < 8; attempt += 1) await worker.handle({ operationId });
      const row = await operation(operationId);
      // `not-connected` is the gateway saying no connection was opened: each attempt was put back, never sent.
      expect(row).toMatchObject({ status: 'failed', lastError: 'not-connected', providerRef: null, resultMsisdn: null });
      expect(row.attempts).toBe(5);
      // Nothing was sent, so nothing was applied: the money is held until the branch decides.
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await lines()).toHaveLength(0);
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect(gateway.calls).toEqual([]);
    });
  });

  // ── Through the parts built before ──────────────────────────────────────────────────────────────────────

  describe('what was opened runs through the dispatcher and the settlement, over the scripted gateway', () => {
    it('the provider confirms: one call under the task\'s key, one line, one capture, in the submitter\'s name', async () => {
      const { taskId, operationId } = await opened({ msisdn: number() });
      const row = await task(taskId);
      expect(await dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(gateway.calls).toEqual([{ idempotencyKey: `activate:${taskId}`, attempt: 1, action: 'activate', providerCode: name('pkg'), packageCode: name('pkg'), msisdn: row.msisdn, iccid: row.iccid }]);
      expect(await dispatch.settlement.apply(operationId)).toBe('applied');
      expect(await task(taskId)).toMatchObject({ status: 'done' });
      expect((await lines()).map((line) => [line.msisdn, line.iccid, line.status])).toEqual([[row.msisdn, row.iccid, 'active']]);
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      expect((await entries()).map((entry) => [entry.kind, entry.actorId])).toEqual([['hold', ids.pos], ['release', ids.pos], ['activate', ids.pos]]);
      expect(notices.filter((notice) => notice.kind === 'task.done')).toEqual([expect.objectContaining({ actorId: ids.pos, payload: expect.objectContaining({ handlerName: SYSTEM_SENDER_NAME }) })]);
      // A message delivered again, and the sweeper: nothing more is sent, made or charged.
      expect(await dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(gateway.calls).toHaveLength(1);
      expect(await lines()).toHaveLength(1);
      expect(await kinds()).toEqual(['activate', 'hold', 'release']);
      await expectInvariants();
    });

    it('the provider refuses: the task is handed to the branch with its hold, and the branch completes or rejects it', async () => {
      const { taskId, operationId } = await opened();
      gateway.next({ left: true, answer: 'refused', error: 'refused' });
      expect(await dispatch.dispatcher.handle(operationId)).toBe('failed');
      // Until now nobody at the branch was told of it.
      expect(notices).toEqual([]);
      expect(await dispatch.settlement.apply(operationId)).toBe('handed-to-branch');
      // Now it is the branch's (T6): its handlers are told once, from «النظام», and a repeat tells nobody again.
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(notices.map((notice) => [notice.kind, notice.to, notice.payload.handlerName])).toEqual([['task.opened', [ids.owner], SYSTEM_SENDER_NAME]]);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE, note: PROVIDER_FAILED_NOTE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect((await send(app, 'owner', `/office/tasks/${taskId}/reject`, { reason: 'the provider refused it' })).status).toBeLessThan(300);
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await lines()).toHaveLength(0);
      // Never sent again for this task (D3).
      expect(await dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(gateway.calls).toHaveLength(1);
      await expectInvariants();
    });

    it('no answer: the operation is unknown, the hold is kept, and nothing by hand is allowed', async () => {
      const { taskId, operationId } = await opened();
      gateway.next({ left: true, answer: 'none', error: 'timeout' });
      expect(await dispatch.dispatcher.handle(operationId)).toBe('unknown');
      expect(notices).toEqual([]);
      // T7: the accounts that may decide are told once, in fixed words, and the handlers are not told to take it.
      expect(await dispatch.settlement.apply(operationId)).toBe('awaiting-decision');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(notices.map((notice) => [notice.kind, notice.to, notice.payload.excerpt])).toEqual([['task.note', [ids.owner], PROVIDER_UNKNOWN_NOTE]]);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      expect((await send(app, 'owner', `/office/tasks/${taskId}/complete`, { note: 'x' })).status).toBe(409);
      expect((await send(app, 'owner', `/office/tasks/${taskId}/reject`, { reason: 'x' })).status).toBe(409);
      expect((await send(app, 'pos', `/office/tasks/${taskId}/cancel`)).status).toBe(409);
      // Never sent a second time.
      expect(await dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(gateway.calls).toHaveLength(1);
      await expectInvariants();
    });

    it('the provider confirms and the line cannot be made: the exception is told to the accounts that decide, once, and nobody is told to take the task', async () => {
      const { taskId, operationId } = await opened({ msisdn: number() });
      const row = await task(taskId);
      expect(await dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      // The number went to a line meanwhile, past the reservation.
      await prisma.line.create({ data: { msisdn: `${(row.msisdn as string).slice(0, 9)}${(Number((row.msisdn as string).slice(9)) + 1) % 10}`, iccid: row.iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.other, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      expect(await dispatch.settlement.apply(operationId)).toBe('exception');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(notices.map((notice) => [notice.kind, notice.to, notice.payload.excerpt])).toEqual([['task.note', [ids.owner], PROVIDER_EXCEPTION_NOTES['sim-taken']]]);
      expect(JSON.stringify(notices)).not.toContain(row.iccid as string);
      expect(await task(taskId)).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      await prisma.line.deleteMany({ where: { posId: ids.other } });
    });

    it('the submitter cancels while nothing has left: the operation is abandoned, the hold released, and a late message sends nothing', async () => {
      const { taskId, operationId } = await opened();
      expect((await send(app, 'pos', `/office/tasks/${taskId}/cancel`)).status).toBeLessThan(300);
      expect(await operation(operationId)).toMatchObject({ status: 'failed', lastError: 'abandoned' });
      expect(await task(taskId)).toMatchObject({ status: 'cancelled' });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(await dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await dispatch.settlement.apply(operationId)).toBe('skipped');
      expect(gateway.calls).toEqual([]);
      // The serial is free again: the same sale can be made anew, as a new task with a new operation.
      await expectInvariants();
    });

    it('a cancel races the dispatcher\'s claim, thirty times: cancelled and never sent, or sent and not cancelled', async () => {
      const outcomes = { cancelled: 0, sent: 0 };
      for (let round = 0; round < 30; round += 1) {
        const { taskId, operationId } = await opened();
        const calls = gateway.calls.length;
        const [cancel, handled] = await Promise.all([send(app, 'pos', `/office/tasks/${taskId}/cancel`), dispatch.dispatcher.handle(operationId)]);
        const row = await operation(operationId);
        if (cancel.status < 300) {
          expect([handled, row.status, row.lastError, gateway.calls.length - calls]).toEqual(['skipped', 'failed', 'abandoned', 0]);
          expect((await task(taskId)).status).toBe('cancelled');
          outcomes.cancelled += 1;
        } else {
          expect([cancel.status, handled, gateway.calls.length - calls]).toEqual([409, 'succeeded', 1]);
          expect((await task(taskId)).status).toBe('working');
          expect(await dispatch.settlement.apply(operationId)).toBe('applied');
          outcomes.sent += 1;
        }
      }
      expect(outcomes.cancelled + outcomes.sent).toBe(30);
      expect(await lines()).toHaveLength(outcomes.sent);
      expect(await wallet()).toMatchObject({ balance: START - outcomes.sent * PRICE, held: 0 });
      await expectInvariants();
    });

    it('an eSIM the provider confirms with its code: the line carries it sealed, and it is in no task, notice, message, entry or activity row', async () => {
      const got = await activate('pos', { packageCode: name('pkg'), posLoginName: name('pos'), esim: true }, key());
      const taskId = got.body.taskId as string;
      const operationId = (await prisma.providerOperation.findUniqueOrThrow({ where: { taskId } })).id;
      const [msisdn, iccid] = [number(), serial()];
      gateway.next({ left: true, answer: 'confirmed', providerRef: 'REF-ESIM', result: { msisdn, iccid, esimCode: CODE } });
      expect(await dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(await dispatch.settlement.apply(operationId)).toBe('applied');
      const [line] = await lines();
      expect(line).toMatchObject({ msisdn, iccid, esim: true });
      expect(open(line.esimQr as string)).toMatch(/^data:image\/png;base64,/);
      const sealed = (await operation(operationId)).resultEsimCode as string;
      expect(open(sealed)).toBe(CODE);
      const kept = JSON.stringify([await task(taskId), notices, recorded, await outbox(), await entries(), await prisma.notice.findMany({ where: { userId: { in: people } } })]);
      for (const secret of [CODE, 'S11-SECRET', sealed.slice(10, 40)]) expect(kept).not.toContain(secret);
      await expectInvariants();
    });

    it('openings, repeats, cancels, the dispatcher, the settlement and the branch run against each other: nothing is aborted as a deadlock, no hold is taken, captured or released twice (item 28)', async () => {
      const settled: PromiseSettledResult<unknown>[] = [];
      // Eight waves; in each, four sales are opened (two of them sent twice at once), and everything that can
      // happen to a sale opened in the wave before is thrown at it together.
      let earlier: { taskId: string; operationId: string }[] = [];
      for (let wave = 0; wave < 8; wave += 1) {
        const bodies = Array.from({ length: 4 }, () => ({ body: sale({ msisdn: number() }), idempotencyKey: key() }));
        const openings = bodies.flatMap((item, index) => (index < 2 ? [item, item] : [item])).map((item) => activate('pos', item.body, item.idempotencyKey));
        const onEarlier = earlier.flatMap(({ taskId, operationId }, index) => [
          dispatch.dispatcher.handle(operationId).then(() => dispatch.settlement.apply(operationId)),
          dispatch.dispatcher.handle(operationId),
          dispatch.settlement.apply(operationId),
          ...(index % 2 === 0 ? [send(app, 'pos', `/office/tasks/${taskId}/cancel`)] : []),
          send(app, 'owner', `/office/tasks/${taskId}/reject`, { reason: 'mixed' }),
          send(app, 'owner', `/office/tasks/${taskId}/complete`, { note: 'mixed' }),
        ]);
        const results = await Promise.allSettled([...openings, ...onEarlier]);
        settled.push(...results);
        const answers = results.slice(0, openings.length).flatMap((result) => (result.status === 'fulfilled' ? [result.value as Answer] : []));
        const taskIds = [...new Set(answers.map((answer) => answer.body.taskId as string))];
        expect(taskIds).toHaveLength(4);
        earlier = await Promise.all(taskIds.map(async (taskId) => ({ taskId, operationId: (await prisma.providerOperation.findUniqueOrThrow({ where: { taskId } })).id })));
      }
      // A deadlock, or any other fault, would be a rejection or a 500.
      expect(settled.filter((result) => result.status === 'rejected')).toEqual([]);
      expect(settled.flatMap((result) => (result.status === 'fulfilled' && typeof result.value === 'object' && result.value !== null && 'status' in result.value ? [(result.value as Answer).status] : [])).filter((status) => status >= 500)).toEqual([]);
      // Each sale ended in at most one way, and the money says the same.
      const all = await tasks();
      expect(all).toHaveLength(32);
      const done = all.filter((row) => row.status === 'done');
      expect(await lines()).toHaveLength(done.length);
      expect((await kinds()).filter((kind) => kind === 'activate')).toHaveLength(done.length);
      expect((await kinds()).filter((kind) => kind === 'hold')).toHaveLength(32);
      // No provider call was made twice for one task.
      expect(new Set(gateway.calls.map((call) => call.idempotencyKey)).size).toBe(gateway.calls.length);
      expect(await prisma.outboxMessage.count({ where: { topic: OPERATION_SETTLED, aggregateId: { in: (await operations()).map((row) => row.id) } } })).toBeLessThanOrEqual(32);
      await expectInvariants();
    });
  });
});
