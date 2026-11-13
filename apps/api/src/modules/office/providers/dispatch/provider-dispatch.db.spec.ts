import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import request from 'supertest';
import { createPrismaClient } from '../../../../db';
import { buildProviderDispatch, readCredentials, startReadiness } from '../../../../provider-dispatch';
import { MemoryAuthStore } from '../../../auth/testing/memory-auth.store';
import { open } from '../../../shared/secret-box';
import { capturedOutput } from '../../../shared/testing/captured-output';
import type { NoticeService } from '../../notices/notice.service';
import { GRANT_CODES } from '../../rules/office-grants';
import { PROVIDER_DISPATCH_NOTE } from '../../stored-text';
import { officeTestApp } from '../../testing/office-test-app';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import { DeploymentSendGate, type SendGate } from './dispatch-gate';
import { READY_TTL_MS, dispatchSettings, type ProviderTarget } from './dispatch-policy';
import { buildAdapters, type AdapterFactory, type BuiltAdapters } from './provider-adapters';
import { RoutingProviderGateway } from './routing-gateway';

// PostgreSQL only (TEST_DATABASE_URL), over HTTP, in a process set up as production is (`NODE_ENV=production`, no
// simulation). ADR 0019, D18; spec items 25 and 26; plan slice S.12a. The owner's switch (approve, pause, resume,
// the credential), what the API then decides about a sale, and what a worker then does with a recorded
// operation: all against real rows, with the provider's row lock deciding the races.
//
// This build has no adapter, so a real worker builds none and sends nothing. To exercise the rules that will hold
// once one exists, the specs here hand `buildAdapters` an adapter of their own, which reaches nothing and counts
// its calls. That is the only place an adapter can come from in this file.
//
// Other spec files run at the same time on the same database. So this file never runs a pass over "every
// operation" (`recoverExpired`, `dispatchWaiting`, the sweeper): it does what those passes do for its own
// provider's operations only (`recoverMine`, `sendWaiting`), and judges a settlement by what is in the database.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;
const SANDBOX_CREDENTIAL = 'S12A-SANDBOX-CREDENTIAL-7Q2W9E4R6T1Y8U3I';
const LIVE_CREDENTIAL = 'S12A-LIVE-CREDENTIAL-5P0O2I8U4Y6T1R3E';
const KEY = Buffer.alloc(32, 12).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 13).toString('base64');
const ENV = ['NODE_ENV', 'PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'DEPLOYMENT_ID', 'PROVIDER_SIMULATION', 'SECRETS_KEY', 'DATABASE_URL'] as const;

type Answer = { status: number; body: Record<string, unknown> };
type Who = 'owner' | 'staff' | 'pos' | 'entered';

suite('switching a provider\'s dispatch on, pausing it, and what follows (PostgreSQL, HTTP, production-grade)', () => {
  jest.setTimeout(300_000);
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 8);
  const code = `s12-${tag}`;
  const name = (who: string) => `s12-${tag}-${who}`;
  const ids = { owner: randomUUID(), staff: randomUUID(), pos: randomUUID(), provider: randomUUID(), other: randomUUID(), company: randomUUID(), pkg: randomUUID(), role: randomUUID() };
  const people = [ids.owner, ids.staff, ids.pos];
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let recorded: unknown[][];
  const sid: Record<Who, string> = { owner: '', staff: '', pos: '', entered: '' };
  const quiet = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;

  /** This deployment's name, and another's that is set up for the same target. */
  const HERE = `s12-${tag}-a`;
  const ELSEWHERE = `s12-${tag}-b`;
  /** The deployment's settings, as both processes are given them unless a test says otherwise. */
  const deployment = (over: { dispatch?: string | null; adapters?: string | null; target?: string | null; id?: string | null } = {}) => {
    const set = (key: string, value: string | null | undefined, fallback: string) => {
      if (value === null) delete process.env[key];
      else process.env[key] = value ?? fallback;
    };
    set('PROVIDER_DISPATCH', over.dispatch, '1');
    set('PROVIDER_ADAPTERS', over.adapters, code);
    set('PROVIDER_TARGET', over.target, 'sandbox');
    set('DEPLOYMENT_ID', over.id, HERE);
  };
  const call = async (who: Who, method: 'get' | 'post' | 'put', path: string, body?: Record<string, unknown>, key?: string): Promise<Answer> => {
    let pending = request(app.getHttpServer())[method](path).set('Cookie', `sid=${sid[who]}`);
    if (key) pending = pending.set('Idempotency-Key', key);
    const response = await (body ? pending.send(body) : pending);
    return { status: response.status, body: response.body as Record<string, unknown> };
  };
  const said = (got: Answer) => (got.status < 300 ? 'ok' : `${got.status} ${String(got.body.code)}`);
  const at = (action: string) => `/office/providers/${code}/dispatch${action}`;
  const status = async () => (await call('owner', 'get', at(''))).body;
  const credential = (value: string, who: Who = 'owner') => call(who, 'put', at('/credential'), { value });
  const provider = () => prisma.provider.findUniqueOrThrow({ where: { id: ids.provider } });
  const credentials = () => prisma.providerCredential.findMany({ where: { providerId: ids.provider }, orderBy: { target: 'asc' } });
  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  /** An automatic activation at the provider: which route it took, by what it left in the database. */
  const sell = async () => {
    const got = await call('pos', 'post', '/office/lines', { packageCode: code, posLoginName: name('pos'), iccid: serial() }, `s12-key-${randomUUID()}`);
    if (typeof got.body.taskId !== 'string') return { route: `${got.status} ${String(got.body.code)}`, taskId: '', operationId: '' };
    const operation = await prisma.providerOperation.findUnique({ where: { taskId: got.body.taskId } });
    return { route: operation ? 'dispatch' : 'manual', taskId: got.body.taskId, operationId: operation?.id ?? '' };
  };
  const operation = (id: string) => prisma.providerOperation.findUniqueOrThrow({ where: { id } });
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });

  /** A spec's own adapter: it reaches nothing, counts what it is asked and with which credential, and answers what the spec says. */
  const calls: OutgoingOperation[] = [];
  const usedCredentials: string[] = [];
  let answer: (sent: OutgoingOperation) => Promise<SendEvidence> = async () => ({ left: true, answer: 'confirmed', providerRef: 'REF-S12' });
  const factories: Record<string, AdapterFactory> = {
    [code]: (target: ProviderTarget, secret: string) => ({ providerCode: code, target, send: async (sent) => { calls.push(sent); usedCredentials.push(secret); return answer(sent); } }),
  };
  const ownEnv = () => ({ PROVIDER_DISPATCH: process.env.PROVIDER_DISPATCH, PROVIDER_ADAPTERS: process.env.PROVIDER_ADAPTERS, PROVIDER_TARGET: process.env.PROVIDER_TARGET, DEPLOYMENT_ID: process.env.DEPLOYMENT_ID });
  /**
   * A worker as `worker.ts` builds one: its own settings, the adapters those allow (with the spec's adapter as the
   * build's only one), the routing gateway over them, and the deployment's gate. `env` is the worker's own
   * environment: it need not be the API's.
   */
  const workerWith = async (env: Record<string, string | undefined> = ownEnv(), wrap?: (gate: SendGate) => SendGate) => {
    const settings = dispatchSettings(env);
    const rebuild = async (): Promise<BuiltAdapters> => buildAdapters(settings, await readCredentials(prisma, settings), factories);
    const built = await rebuild();
    const gateway = new RoutingProviderGateway(built);
    const gate = new DeploymentSendGate(settings, (provided) => gateway.generation(provided));
    const dispatch = buildProviderDispatch(prisma, {} as IORedis, gateway, wrap ? wrap(gate) : gate, `s12-${tag}`, quiet);
    return { settings, built, gateway, dispatch, rebuild };
  };
  type TestWorker = Awaited<ReturnType<typeof workerWith>>;
  /** Every readiness a test started: stopped after it, so none keeps attesting into the next test. */
  const started: (() => Promise<void>)[] = [];
  /**
   * The worker's readiness as `worker.ts` starts it, with its first round done. Answers what stops it; `round` is
   * one more round, as its timer would run it.
   */
  const attest = async (worker: TestWorker) => {
    const readiness = startReadiness(prisma, worker.settings, worker.gateway, worker.rebuild);
    await readiness.round();
    started.push(readiness.stop);
    return Object.assign(readiness.stop, { round: readiness.round });
  };
  /** Everything in place for the provider on a sandbox deployment: the credential, the approval, a worker attesting. */
  const switchedOn = async () => {
    deployment();
    expect(said(await credential(SANDBOX_CREDENTIAL))).toBe('ok');
    expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
    const worker = await workerWith();
    const stop = await attest(worker);
    return { worker, stop };
  };
  /** This provider's operations in a status, oldest first. */
  const mine = async (status: string) => (await prisma.providerOperation.findMany({ where: { providerId: ids.provider, status }, orderBy: { updatedAt: 'asc' }, select: { id: true } })).map((row) => row.id);
  /** What recovery's pass does (`recoverExpired`, with the worker's gate), for this provider's operations alone. */
  const recoverMine = async (worker: TestWorker, now: Date = new Date()) => {
    let changed = 0;
    for (const id of await mine('pending')) if (await worker.dispatch.operations.recover(id, now, worker.dispatch.gate)) changed += 1;
    return changed;
  };
  /** What the pass over waiting operations does (`dispatchWaiting`), for this provider's operations alone. */
  const sendWaiting = async (worker: TestWorker) => {
    let sent = 0;
    for (const id of await mine('requested')) {
      const outcome = await worker.dispatch.dispatcher.handle(id);
      if (outcome !== 'skipped' && outcome !== 'missing') sent += 1;
    }
    return sent;
  };
  /**
   * Acts on an operation's verdict and answers where it then stands. Another file's sweeper, on the same database,
   * may have acted on it first; the outcome is the same, so it is read from the row, not from who did it.
   */
  const settled = async (worker: TestWorker, id: string) => {
    await worker.dispatch.settlement.apply(id);
    const row = await operation(id);
    return row.appliedAt ? 'applied' : row.applyError ? 'exception' : 'not-applied';
  };
  const NOT_SWITCHED = {
    dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null, dispatchApprovedDeployment: null, dispatchPausedAt: null,
    dispatchReadyAt: null, dispatchReadyTarget: null, dispatchReadyDeployment: null, dispatchReadyGeneration: null,
  };
  const NOT_APPROVED = { dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null, dispatchApprovedDeployment: null };

  beforeAll(async () => {
    for (const key of ENV) saved[key] = process.env[key];
    process.env.DATABASE_URL = url;
    // As a production process is set up: no simulation, and the key that seals.
    process.env.NODE_ENV = 'production';
    delete process.env.PROVIDER_SIMULATION;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, who: string, layer: string, parentId: string | null, isBranchOwner = false, roleId: string | null = null) => ({ id, loginName: name(who), nickname: who, passwordHash: 'x', layer, parentId, isBranchOwner, roleId });
    // A branch employee holding every grant there is: still not the owner.
    await prisma.role.create({ data: { id: ids.role, name: name('everything'), read: true, edit: true, accounting: true, tasks: true, reports: true, staff: true, enter: true, grants: GRANT_CODES.join(',') } as never });
    const rows = [user(ids.owner, 'owner', 'branch', null, true), user(ids.staff, 'staff', 'branch', ids.owner, false, ids.role), user(ids.pos, 'pos', 'pos', ids.owner)];
    for (const row of rows) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.id === ids.pos ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    for (const who of ['owner', 'staff', 'pos'] as const) sid[who] = await auth.saveSession({ userId: ids[who], scope: 'full', userAgent: '', ip: '' });
    // The owner, working as the employee.
    sid.entered = await auth.saveImpersonation({ userId: ids.staff, operatorId: ids.owner, userAgent: '', ip: '' });
    await prisma.provider.create({ data: { id: ids.provider, code, name: 's12' } });
    await prisma.provider.create({ data: { id: ids.other, code: `${code}-other`, name: 's12 other' } });
    await prisma.company.create({ data: { id: ids.company, code, name: 's12' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    await prisma.package.create({ data: { id: ids.pkg, code, name: 's12 package', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    ({ app, recorded } = await officeTestApp(auth, prisma as unknown as Record<string, unknown>, quiet));
  });

  afterEach(async () => {
    for (const stop of started.splice(0)) await stop();
    for (const key of ['PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'DEPLOYMENT_ID'] as const) delete process.env[key];
    process.env.SECRETS_KEY = KEY;
    recorded.length = 0;
    calls.length = 0;
    usedCredentials.length = 0;
    answer = async () => ({ left: true, answer: 'confirmed', providerRef: 'REF-S12' });
    const operations = (await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } })).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: operations } } });
    await prisma.providerOperation.deleteMany({ where: { id: { in: operations } } });
    await prisma.providerCredential.deleteMany({ where: { providerId: { in: [ids.provider, ids.other] } } });
    await prisma.provider.updateMany({ where: { id: { in: [ids.provider, ids.other] } }, data: NOT_SWITCHED });
    await prisma.notice.deleteMany({ where: { userId: { in: people } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: people } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.provider, ids.other] } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.staff, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.role.deleteMany({ where: { id: ids.role } });
    await prisma.$disconnect();
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // ── Who ─────────────────────────────────────────────────────────────────────────────────────────────────

  describe('the switch is the branch owner\'s, in a session of its own', () => {
    it('an employee with every grant, a point of sale and an entered session are refused on all five routes, and nothing changes', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      const before = [await provider(), await credentials()];
      for (const who of ['staff', 'pos', 'entered'] as const) {
        expect(said(await call(who, 'get', at('')))).toBe('403 FORBIDDEN');
        for (const action of ['/approve', '/pause', '/resume']) expect(said(await call(who, 'post', at(action)))).toBe('403 FORBIDDEN');
        expect(said(await credential(`${LIVE_CREDENTIAL}-${who}`, who))).toBe('403 FORBIDDEN');
      }
      expect([await provider(), await credentials()]).toEqual(before);
      // A provider that is not there, and a credential that is not one.
      expect(said(await call('owner', 'post', `/office/providers/no-such-provider/dispatch/approve`))).toBe('404 NOT_FOUND');
      expect(said(await call('owner', 'put', `/office/providers/no-such-provider/dispatch/credential`, { value: SANDBOX_CREDENTIAL }))).toBe('404 NOT_FOUND');
      for (const value of ['', 'short', 'x'.repeat(4001), 42, null]) expect(said(await call('owner', 'put', at('/credential'), { value } as never))).toBe('400 INVALID');
      expect(said(await call('owner', 'put', at('/credential'), {}))).toBe('400 INVALID');
      // A value that already has the sealed form is not a credential.
      expect(said(await credential(`v1:${'A'.repeat(40)}`))).toBe('400 INVALID');
      expect([await provider(), await credentials()]).toEqual(before);
    });

    it('each change is on the activity record under its own action and the provider\'s code, with nothing of what was sent', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      await call('owner', 'post', at('/pause'));
      await call('owner', 'post', at('/resume'));
      await call('staff', 'post', at('/pause'));
      const kept = recorded.map(([, , draft, result, reason]) => [(draft as { action: string }).action, (draft as { subjectKind: string }).subjectKind, (draft as { subjectRef: string }).subjectRef, result, reason]);
      expect(kept).toEqual([
        ['provider_credential', 'provider', code, 'ok', ''], ['provider_dispatch_approve', 'provider', code, 'ok', ''], ['provider_dispatch_pause', 'provider', code, 'ok', ''],
        ['provider_dispatch_resume', 'provider', code, 'ok', ''], ['provider_dispatch_pause', 'provider', code, 'fail', 'FORBIDDEN'],
      ]);
      expect(JSON.stringify(recorded.map(([, , draft, result, reason]) => [draft, result, reason]))).not.toContain('S12A-');
    });
  });

  // ── The credential ──────────────────────────────────────────────────────────────────────────────────────

  describe('the credential is written, sealed, and read by no route', () => {
    it('is stored sealed for the deployment\'s target, answered by nothing, and logged nowhere', async () => {
      deployment();
      let put: Answer = { status: 0, body: {} };
      const output = await capturedOutput(async () => { put = await credential(SANDBOX_CREDENTIAL); });
      expect([put.status, put.body]).toEqual([200, { ok: true }]);
      const stored = await credentials();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ target: 'sandbox', updatedByLoginName: name('owner') });
      expect(stored[0].sealedValue.startsWith('v1:')).toBe(true);
      expect(stored[0].sealedValue).not.toContain(SANDBOX_CREDENTIAL);
      // Only a holder of the key reads it back; the API never does.
      expect(open(stored[0].sealedValue)).toBe(SANDBOX_CREDENTIAL);
      const read = await status();
      expect(read).toMatchObject({ hasCredential: true, target: 'sandbox' });
      expect(Object.keys(read).sort()).toEqual(['approvedAt', 'approvedByLoginName', 'approvedDeployment', 'approvedTarget', 'deployment', 'dispatchOn', 'eligible', 'hasCredential', 'listed', 'opens', 'pausedAt', 'refusal', 'target', 'workerReady']);
      // No answer of any provider route carries it, clear or sealed.
      const answers = JSON.stringify([put.body, read, (await call('owner', 'get', '/office/providers')).body, (await call('owner', 'get', `/office/providers/${code}/settings`)).body, (await call('owner', 'post', at('/approve'))).body]);
      for (const secret of [SANDBOX_CREDENTIAL, 'S12A-', stored[0].sealedValue.slice(6, 40)]) expect(answers).not.toContain(secret);
      expect(output).not.toContain('S12A-');
      expect(await prisma.outboxMessage.count({ where: { payload: { path: ['value'], not: 'x' }, createdAt: { gt: new Date(Date.now() - 5_000) }, aggregateId: ids.provider } })).toBe(0);
    });

    it('is replaced in one write: one row a target, the new value, never both and never neither', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      const first = (await credentials())[0];
      // Twenty replacements at once, read all the while: a reader always finds exactly one row that opens.
      let reading = true;
      const seen: number[] = [];
      const reader = (async () => {
        while (reading) {
          const rows = await credentials();
          seen.push(rows.length);
          expect(() => open(rows[0].sealedValue)).not.toThrow();
        }
      })();
      const values = Array.from({ length: 20 }, (_, index) => `${SANDBOX_CREDENTIAL}-${index}`);
      expect((await Promise.all(values.map((value) => credential(value)))).map(said).every((text) => text === 'ok')).toBe(true);
      reading = false;
      await reader;
      expect(new Set(seen)).toEqual(new Set([1]));
      const rows = await credentials();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(first.id);
      expect(values).toContain(open(rows[0].sealedValue));
      // Every write raised the generation, once each: no two writes were given the same one.
      expect([first.generation, rows[0].generation]).toEqual([1, 21]);
    });

    it('sandbox and live are separate rows, and a deployment stores a credential for its own target only', async () => {
      // No target stated: nothing can be stored at all.
      deployment({ target: null, dispatch: null, adapters: null });
      expect(said(await credential(SANDBOX_CREDENTIAL))).toBe('409 DISPATCH_NOT_CONFIGURED');
      expect(await credentials()).toEqual([]);
      deployment({ target: 'sandbox' });
      await credential(SANDBOX_CREDENTIAL);
      deployment({ target: 'live' });
      // The live deployment does not see the sandbox one as its own.
      expect(await status()).toMatchObject({ target: 'live', hasCredential: false });
      await credential(LIVE_CREDENTIAL);
      const rows = await credentials();
      expect(rows.map((row) => [row.target, open(row.sealedValue)])).toEqual([['live', LIVE_CREDENTIAL], ['sandbox', SANDBOX_CREDENTIAL]]);
    });

    it('with no key to seal with, nothing is stored and nothing is answered but a code', async () => {
      deployment();
      for (const key of [undefined, 'not-a-key', Buffer.alloc(16, 1).toString('base64')]) {
        if (key === undefined) delete process.env.SECRETS_KEY;
        else process.env.SECRETS_KEY = key;
        const got = await credential(SANDBOX_CREDENTIAL);
        expect([got.status, got.body.code]).toEqual([500, 'CREDENTIAL_UNSEALABLE']);
        expect(JSON.stringify(got.body)).not.toContain('S12A-');
      }
      expect(await credentials()).toEqual([]);
    });
  });

  // ── Approve, pause, resume ──────────────────────────────────────────────────────────────────────────────

  describe('the approval is the last condition, never the first, and is given for one target', () => {
    it('is refused until the deployment itself is set up for the provider and holds its credential', async () => {
      const unset: [string, Parameters<typeof deployment>[0]][] = [
        ['nothing is set', { dispatch: null, adapters: null, target: null }], ['dispatch is off', { dispatch: null }], ['dispatch is "true", not "1"', { dispatch: 'true' }],
        ['the provider is not named', { adapters: `${code}-other` }], ['no target', { target: null }], ['a target that is not one', { target: 'production' }], ['the list is malformed', { adapters: `${code},${code}` }],
        ['the deployment is not named', { id: null }], ['a name that is not one', { id: 'Not A Name' }],
      ];
      for (const [, settings] of unset) {
        deployment(settings);
        expect(said(await call('owner', 'post', at('/approve')))).toBe('409 DISPATCH_NOT_CONFIGURED');
        expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_CONFIGURED');
      }
      // Set up, and no credential for this target yet.
      deployment();
      expect(said(await call('owner', 'post', at('/approve')))).toBe('409 DISPATCH_CREDENTIAL_MISSING');
      expect(await provider()).toMatchObject(NOT_APPROVED);
      await credential(SANDBOX_CREDENTIAL);
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      const row = await provider();
      expect(row).toMatchObject({ dispatchApprovedByLoginName: name('owner'), dispatchApprovedTarget: 'sandbox', dispatchApprovedDeployment: HERE, dispatchPausedAt: null });
      expect(row.dispatchApprovedAt).toBeInstanceOf(Date);
      expect(await status()).toMatchObject({ dispatchOn: true, listed: true, target: 'sandbox', deployment: HERE, approvedTarget: 'sandbox', approvedDeployment: HERE, eligible: true, refusal: null });
      // Another provider's approval is its own.
      expect(await prisma.provider.findUniqueOrThrow({ where: { id: ids.other } })).toMatchObject({ dispatchApprovedAt: null });
    });

    it('an approval given on a sandbox deployment does not open live: it must be given again, with a live credential', async () => {
      deployment({ target: 'sandbox' });
      await credential(SANDBOX_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      // The same database, the setting changed to live.
      deployment({ target: 'live' });
      expect(await status()).toMatchObject({ target: 'live', approvedTarget: 'sandbox', eligible: false, refusal: 'approved-for-other-target', hasCredential: false, opens: false });
      expect((await sell()).route).toBe('manual');
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_CREDENTIAL_MISSING');
      expect(said(await call('owner', 'post', at('/approve')))).toBe('409 DISPATCH_CREDENTIAL_MISSING');
      // A resume is not an approval: the one on record is for sandbox.
      await prisma.providerCredential.create({ data: { providerId: ids.provider, target: 'live', sealedValue: (await credentials())[0].sealedValue, updatedByLoginName: name('owner') } });
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
      await credential(LIVE_CREDENTIAL);
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect(await status()).toMatchObject({ approvedTarget: 'live', eligible: true });
      // And back on sandbox, the live approval does not stand either.
      deployment({ target: 'sandbox' });
      expect(await status()).toMatchObject({ eligible: false, refusal: 'approved-for-other-target' });
      expect((await sell()).route).toBe('manual');
    });

    it('a pause is immediate and kept; a resume judges the conditions again; an approval does not lift a pause', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
      const paused = (await provider()).dispatchPausedAt;
      expect(paused).toBeInstanceOf(Date);
      expect(await status()).toMatchObject({ eligible: false, refusal: 'paused', opens: false });
      // Paused again: the same pause.
      await call('owner', 'post', at('/pause'));
      expect((await provider()).dispatchPausedAt).toEqual(paused);
      await call('owner', 'post', at('/approve'));
      expect((await provider()).dispatchPausedAt).toEqual(paused);
      // A resume while the deployment no longer names the provider, or with its credential gone: refused, still paused.
      deployment({ adapters: `${code}-other` });
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_CONFIGURED');
      deployment();
      await prisma.providerCredential.deleteMany({ where: { providerId: ids.provider } });
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_CREDENTIAL_MISSING');
      expect((await provider()).dispatchPausedAt).toEqual(paused);
      // The credential written again: the pause is kept, the approval is not, and a resume is not an approval.
      await credential(SANDBOX_CREDENTIAL);
      expect(await provider()).toMatchObject({ ...NOT_APPROVED, dispatchPausedAt: paused });
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect((await provider()).dispatchPausedAt).toEqual(paused);
      expect(said(await call('owner', 'post', at('/resume')))).toBe('ok');
      expect(await provider()).toMatchObject({ dispatchPausedAt: null, dispatchApprovedTarget: 'sandbox', dispatchApprovedDeployment: HERE });
      // A provider that was never approved can be paused, and cannot be resumed into dispatching.
      await prisma.provider.update({ where: { id: ids.provider }, data: NOT_APPROVED });
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
    });
  });

  // ── What the API decides ────────────────────────────────────────────────────────────────────────────────

  describe('the API opens the dispatch route only on the four conditions and the worker\'s own word (items 25, 26)', () => {
    it('all four conditions and no worker that holds an adapter: every sale takes the manual route, and no operation is recorded', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      expect(await status()).toMatchObject({ eligible: true, workerReady: false, opens: false });
      // A worker of this build: no adapter in it, so it builds none and attests nothing.
      const settings = dispatchSettings(ownEnv());
      const rebuild = async () => buildAdapters(settings, await readCredentials(prisma, settings));
      const real = await rebuild();
      expect([[...real.adapters.keys()], [...real.skipped]]).toEqual([[], [[code, 'no-adapter']]]);
      const readiness = startReadiness(prisma, settings, new RoutingProviderGateway(real), rebuild);
      for (let round = 0; round < 3; round += 1) await readiness.round();
      expect(await provider()).toMatchObject({ dispatchReadyAt: null, dispatchReadyTarget: null, dispatchReadyDeployment: null, dispatchReadyGeneration: null });
      await readiness.stop();
      for (let sale = 0; sale < 3; sale += 1) expect((await sell()).route).toBe('manual');
      expect(await prisma.providerOperation.count({ where: { providerId: ids.provider } })).toBe(0);
      expect((await prisma.officeTask.findMany({ where: { posId: ids.pos } })).map((task) => task.note)).not.toContain(PROVIDER_DISPATCH_NOTE);
      expect(calls).toEqual([]);
    });

    it('with a worker that attests, the route opens; take any one thing away and the next sale is manual again', async () => {
      const { worker, stop } = await switchedOn();
      expect([...worker.built.adapters.keys()]).toEqual([code]);
      expect(await status()).toMatchObject({ eligible: true, workerReady: true, opens: true });
      expect((await sell()).route).toBe('dispatch');
      // The request cannot ask for it or against it: the hint is not read on this route, in production there is none.
      const hinted = await call('pos', 'post', '/office/lines', { packageCode: code, posLoginName: name('pos'), iccid: serial(), outcome: 'success' }, `s12-key-${randomUUID()}`);
      expect(hinted.body).toEqual({ applied: false, taskId: expect.any(String) });
      // Each condition in turn, as the API's own settings.
      for (const settings of [{ dispatch: null }, { dispatch: '0' }, { adapters: `${code}-other` }, { target: null }, { target: 'live' as const }, { adapters: '*' }]) {
        deployment(settings);
        expect([settings, (await sell()).route]).toEqual([settings, 'manual']);
      }
      deployment();
      expect((await sell()).route).toBe('dispatch');
      // The attestation: withdrawn, stale, or for the other target.
      await stop();
      expect(await provider()).toMatchObject({ dispatchReadyAt: null, dispatchReadyDeployment: null, dispatchReadyGeneration: null });
      expect((await sell()).route).toBe('manual');
      // What a worker would have to have written for the route to open: each part of it, wrong in turn.
      const ready = { dispatchReadyAt: new Date(), dispatchReadyTarget: 'sandbox', dispatchReadyDeployment: HERE, dispatchReadyGeneration: 1 };
      const wrong: [string, Partial<typeof ready>][] = [
        ['stale', { dispatchReadyAt: new Date(Date.now() - READY_TTL_MS - 1_000) }], ['from the future', { dispatchReadyAt: new Date(Date.now() + 120_000) }], ['for the other target', { dispatchReadyTarget: 'live' }],
        ['another deployment\'s', { dispatchReadyDeployment: ELSEWHERE }], ['for a credential that is not the stored one', { dispatchReadyGeneration: 2 }],
      ];
      for (const [what, part] of wrong) {
        await prisma.provider.update({ where: { id: ids.provider }, data: { ...ready, ...part } });
        expect([what, (await sell()).route]).toEqual([what, 'manual']);
      }
      await prisma.provider.update({ where: { id: ids.provider }, data: ready });
      expect((await sell()).route).toBe('dispatch');
      // The approval withdrawn, and a pause.
      await call('owner', 'post', at('/pause'));
      expect((await sell()).route).toBe('manual');
      await call('owner', 'post', at('/resume'));
      expect((await sell()).route).toBe('dispatch');
      // No provider was called by any of it: the API holds nothing to call with.
      expect(calls).toEqual([]);
    });

    it('the two processes set up differently: a sale is dispatched only when both agree, and a worker sends only by its own settings', async () => {
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      const full = { PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: code, PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: HERE };
      // The API is fully set; each of these workers is not, so none attests and every sale is manual.
      for (const env of [{}, { ...full, PROVIDER_DISPATCH: undefined }, { ...full, PROVIDER_ADAPTERS: `${code}-other` }, { ...full, PROVIDER_TARGET: undefined }, { ...full, PROVIDER_TARGET: 'live' }, { ...full, PROVIDER_ADAPTERS: `${code},${code}` }, { ...full, DEPLOYMENT_ID: undefined }]) {
        const worker = await workerWith(env);
        expect([...worker.built.adapters.keys()]).toEqual([]);
        const stop = await attest(worker);
        expect(await provider()).toMatchObject({ dispatchReadyAt: null });
        expect((await sell()).route).toBe('manual');
        await stop();
      }
      // The worker is fully set and attests; the API is not: manual, and nothing recorded for the worker to find.
      const worker = await workerWith(full);
      const stop = await attest(worker);
      for (const settings of [{ dispatch: null }, { adapters: `${code}-other` }, { target: 'live' as const }]) {
        deployment(settings);
        expect((await sell()).route).toBe('manual');
      }
      // An operation that does exist (recorded while both agreed) meets a worker that is set differently: not sent.
      deployment();
      const { operationId } = await sell();
      expect(operationId).not.toBe('');
      for (const env of [{}, { ...full, PROVIDER_ADAPTERS: `${code}-other` }, { ...full, PROVIDER_TARGET: 'live' }, { ...full, DEPLOYMENT_ID: ELSEWHERE }, { ...full, DEPLOYMENT_ID: undefined }]) {
        const other = await workerWith(env);
        expect(await other.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      }
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0, sentAt: null });
      expect(calls).toEqual([]);
      // The worker that agrees sends it, once.
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(calls).toHaveLength(1);
      await stop();
    });
  });

  // ── What a worker does ──────────────────────────────────────────────────────────────────────────────────

  describe('a worker sends only with an adapter it built, under the gate', () => {
    it('a credential that is missing, or does not open, builds no adapter: nothing is sent and the hold stays', async () => {
      const { stop } = await switchedOn();
      const { taskId, operationId } = await sell();
      await stop();
      // The key changed since the credential was sealed.
      process.env.SECRETS_KEY = OTHER_KEY;
      const output = await capturedOutput(async () => {
        const worker = await workerWith();
        expect([[...worker.built.adapters.keys()], worker.built.skipped.get(code)]).toEqual([[], 'credential-unreadable']);
        expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
        expect(await sendWaiting(worker)).toBe(0);
      });
      expect(output).not.toContain('S12A-');
      process.env.SECRETS_KEY = KEY;
      // And with the credential gone.
      await prisma.providerCredential.deleteMany({ where: { providerId: ids.provider } });
      const bare = await workerWith();
      expect(bare.built.skipped.get(code)).toBe('no-credential');
      expect(await bare.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(calls).toEqual([]);
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(await prisma.officeTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
    });

    it('not approved, approved for the other target, or not named: the operation stays requested, uncounted', async () => {
      const { worker, stop } = await switchedOn();
      const { operationId } = await sell();
      const untouched = async () => expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0, sentAt: null, lastAttemptAt: null });
      await prisma.provider.update({ where: { id: ids.provider }, data: NOT_APPROVED });
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      await untouched();
      const approval = { dispatchApprovedAt: new Date(), dispatchApprovedByLoginName: name('owner'), dispatchApprovedTarget: 'sandbox', dispatchApprovedDeployment: HERE };
      for (const other of [{ dispatchApprovedTarget: 'live' }, { dispatchApprovedDeployment: ELSEWHERE }]) {
        await prisma.provider.update({ where: { id: ids.provider }, data: { ...approval, ...other } });
        expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
        await untouched();
      }
      // The approval as it should be, and the provider no longer named to this worker.
      await prisma.provider.update({ where: { id: ids.provider }, data: approval });
      const unnamed = await workerWith({ ...ownEnv(), PROVIDER_ADAPTERS: `${code}-other` });
      expect(await unnamed.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      await untouched();
      expect(calls).toEqual([]);
      await stop();
    });
  });

  // ── The pause ───────────────────────────────────────────────────────────────────────────────────────────

  describe('pausing a provider', () => {
    it('new sales are manual; what is requested is not taken; its submitter may cancel it; a resume sends what waited', async () => {
      const { worker, stop } = await switchedOn();
      const first = await sell();
      const second = await sell();
      expect([first.route, second.route]).toEqual(['dispatch', 'dispatch']);
      expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
      expect((await sell()).route).toBe('manual');
      // Neither a delivered message nor the timer takes them, and no attempt is counted.
      for (const id of [first.operationId, second.operationId]) expect(await worker.dispatch.dispatcher.handle(id)).toBe('skipped');
      expect(await sendWaiting(worker)).toBe(0);
      expect(await recoverMine(worker)).toBe(0);
      expect(await operation(first.operationId)).toMatchObject({ status: 'requested', attempts: 0, waivedAttempts: 0, sentAt: null });
      expect(calls).toEqual([]);
      // Nothing was released by the pause.
      expect(await wallet()).toMatchObject({ balance: START, held: 3 * PRICE });
      // The submitter withdraws one (D7).
      expect(said(await call('pos', 'post', `/office/tasks/${first.taskId}/cancel`))).toBe('ok');
      expect(await operation(first.operationId)).toMatchObject({ status: 'failed', lastError: 'abandoned' });
      expect(await wallet()).toMatchObject({ held: 2 * PRICE });
      // Resumed: the one that waited is sent by the timer's pass, once; the cancelled one never.
      expect(said(await call('owner', 'post', at('/resume')))).toBe('ok');
      expect(await sendWaiting(worker)).toBe(1);
      expect(calls.map((sent) => sent.idempotencyKey)).toEqual([`activate:${second.taskId}`]);
      expect(await operation(second.operationId)).toMatchObject({ status: 'succeeded' });
      await stop();
    });

    it('what was sent before the pause is settled as usual while it lasts: a verdict, an unknown answer and its late verdict, an exception', async () => {
      const { worker, stop } = await switchedOn();
      const confirmed = await sell();
      const silent = await sell();
      const taken = await sell();
      // Three attempts leave; the pause comes while the provider has them.
      const pending = async (id: string) => {
        const attempt = await worker.dispatch.operations.claim(id, new Date(), worker.dispatch.gate);
        expect(await worker.dispatch.operations.beginSend(id, attempt as number, new Date(), worker.dispatch.gate)).not.toBeNull();
        return attempt as number;
      };
      const attempts = { confirmed: await pending(confirmed.operationId), silent: await pending(silent.operationId), taken: await pending(taken.operationId) };
      expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
      // 1. The verdict of an attempt that had left is written and applied: one line, one capture.
      expect(await worker.dispatch.operations.settle(confirmed.operationId, attempts.confirmed, { kind: 'confirmed', providerRef: 'R-1', result: null })).toBe('succeeded');
      expect(await settled(worker, confirmed.operationId)).toBe('applied');
      // 2. No answer: unknown, the hold kept, never sent again; its late verdict is then taken and applied.
      await prisma.providerOperation.update({ where: { id: silent.operationId }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
      expect(await recoverMine(worker)).toBe(1);
      expect(await operation(silent.operationId)).toMatchObject({ status: 'unknown' });
      expect(await worker.dispatch.dispatcher.handle(silent.operationId)).toBe('skipped');
      expect(await worker.dispatch.operations.settle(silent.operationId, attempts.silent, { kind: 'confirmed', providerRef: 'R-2', result: null })).toBe('succeeded');
      expect(await settled(worker, silent.operationId)).toBe('applied');
      // 3. Confirmed, and its serial went to a line meanwhile: the exception is recorded, the hold kept.
      const row = await prisma.officeTask.findUniqueOrThrow({ where: { id: taken.taskId } });
      await prisma.line.create({ data: { msisdn: '0599999999', iccid: row.iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      expect(await worker.dispatch.operations.settle(taken.operationId, attempts.taken, { kind: 'confirmed', providerRef: 'R-3', result: null })).toBe('succeeded');
      expect(await settled(worker, taken.operationId)).toBe('exception');
      // Nothing of this provider is left undone, and the money is exactly: two captured, one held.
      expect(await prisma.providerOperation.count({ where: { providerId: ids.provider, appliedAt: null, OR: [{ status: 'succeeded', applyError: null }, { status: 'failed' }] } })).toBe(0);
      expect(await wallet()).toMatchObject({ balance: START - 2 * PRICE, held: PRICE });
      expect(await prisma.line.count({ where: { posId: ids.pos } })).toBe(3);
      // All the while paused: the adapter was not called by any of it.
      expect((await provider()).dispatchPausedAt).toBeInstanceOf(Date);
      expect(calls).toEqual([]);
      await stop();
    });
  });

  // ── The races ───────────────────────────────────────────────────────────────────────────────────────────

  describe('a pause against the taking and the marking of an attempt: the provider\'s row lock decides', () => {
    /** Holds the provider's row as the owner's pause does, uncommitted, until `commit` is called. */
    const pausing = async () => {
      let commit = () => undefined as void;
      const gate = new Promise<void>((resolve) => { commit = resolve; });
      let held = () => undefined as void;
      const taken = new Promise<void>((resolve) => { held = resolve; });
      const done = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "Provider" SET "dispatchPausedAt" = now() WHERE "id" = ${ids.provider}`;
        held();
        await gate;
      }, { timeout: 60_000, maxWait: 20_000 });
      await taken;
      return { commit: async () => { commit(); await done; } };
    };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('a pause that holds the row before the claim: the claim waits, then finds the provider paused: no attempt, no send', async () => {
      const { worker, stop } = await switchedOn();
      const { operationId } = await sell();
      const pause = await pausing();
      let handled: string | null = null;
      const handling = worker.dispatch.dispatcher.handle(operationId).then((outcome) => { handled = outcome; return outcome; });
      await sleep(600);
      // The dispatcher is waiting on the row: it has neither taken the attempt nor sent anything.
      expect(handled).toBeNull();
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(calls).toEqual([]);
      await pause.commit();
      expect(await handling).toBe('skipped');
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0, sentAt: null });
      expect(calls).toEqual([]);
      await stop();
    });

    it('a pause that commits between the claim and the mark: the attempt is not marked, so the provider is not called, and it is handed back at once, uncounted', async () => {
      // The gate lets the claim through, and the owner pauses before the mark is asked for.
      let asked = 0;
      await switchedOn();
      const worker = await workerWith(undefined, (gate) => ({
        permits: async (tx, providerId) => {
          asked += 1;
          if (asked === 2) expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
          return gate.permits(tx, providerId);
        },
      }));
      const { operationId, taskId } = await sell();
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(asked).toBe(2);
      expect(calls).toEqual([]);
      // Taken, never marked, and back to waiting in the transaction that refused the mark: no lease to wait out.
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1, sentAt: null, lastError: null });
      // Recovery has nothing to do with it, and nothing takes it while the provider is paused.
      expect(await recoverMine(worker, new Date(Date.now() + 3_600_000))).toBe(0);
      expect(await sendWaiting(worker)).toBe(0);
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1 });
      // Its submitter may withdraw it now (D7), which a pending operation would not have let them.
      expect(said(await call('pos', 'post', `/office/tasks/${taskId}/cancel`))).toBe('ok');
      expect(await operation(operationId)).toMatchObject({ status: 'failed', lastError: 'abandoned' });
      expect(await wallet()).toMatchObject({ balance: START, held: 0 });
      expect(calls).toEqual([]);
    });

    it('a pause that holds the row before the mark: the mark waits, then is refused: nothing is sent', async () => {
      const { worker, stop } = await switchedOn();
      const { operationId } = await sell();
      const open_ = worker.dispatch.gate;
      const attempt = await worker.dispatch.operations.claim(operationId, new Date(), open_);
      expect(attempt).toBe(1);
      const pause = await pausing();
      let marked: unknown = 'waiting';
      const marking = worker.dispatch.operations.beginSend(operationId, 1, new Date(), open_).then((outgoing) => { marked = outgoing; return outgoing; });
      await sleep(600);
      expect(marked).toBe('waiting');
      await pause.commit();
      expect(await marking).toBeNull();
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1, sentAt: null });
      expect(calls).toEqual([]);
      await stop();
    });

    it('a pause that comes after the mark does not recall the attempt: it waits for the mark, the request goes, and nothing after it is taken', async () => {
      const { worker, stop } = await switchedOn();
      const first = await sell();
      const second = await sell();
      // The owner pauses while the provider is being called: the mark is committed, so the pause goes straight through.
      let pausedDuringCall = '';
      answer = async () => {
        pausedDuringCall = said(await call('owner', 'post', at('/pause')));
        return { left: true, answer: 'confirmed', providerRef: 'R-AFTER' };
      };
      expect(await worker.dispatch.dispatcher.handle(first.operationId)).toBe('succeeded');
      expect(pausedDuringCall).toBe('ok');
      const sent = await operation(first.operationId);
      const paused = (await provider()).dispatchPausedAt as Date;
      // The line a pause is judged against: this attempt was marked before the pause was committed.
      expect((sent.sentAt as Date).getTime()).toBeLessThanOrEqual(paused.getTime());
      expect(calls).toHaveLength(1);
      // Its result is settled as usual, paused or not; the next operation is not taken.
      expect(await settled(worker, first.operationId)).toBe('applied');
      expect(await worker.dispatch.dispatcher.handle(second.operationId)).toBe('skipped');
      expect(await operation(second.operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(calls).toHaveLength(1);
      await stop();
    });

    it('forty rounds of a pause against a dispatch, at once: the request went before the pause was committed, or it never went', async () => {
      const { worker, stop } = await switchedOn();
      const outcomes = { sent: 0, held: 0 };
      for (let round = 0; round < 40; round += 1) {
        await call('owner', 'post', at('/resume'));
        const { operationId } = await sell();
        expect(operationId).not.toBe('');
        const before = calls.length;
        const [paused, handled] = await Promise.all([call('owner', 'post', at('/pause')), worker.dispatch.dispatcher.handle(operationId)]);
        expect(said(paused)).toBe('ok');
        const row = await operation(operationId);
        const pausedAt = (await provider()).dispatchPausedAt as Date;
        if (calls.length > before) {
          // It left: once, and its mark is not after the pause.
          expect([calls.length - before, handled, row.status]).toEqual([1, 'succeeded', 'succeeded']);
          expect((row.sentAt as Date).getTime()).toBeLessThanOrEqual(pausedAt.getTime() + 5);
          outcomes.sent += 1;
        } else {
          // It did not leave, and no mark says it did.
          expect([handled, row.sentAt]).toEqual(['skipped', null]);
          outcomes.held += 1;
        }
        // Whatever happened, once the pause is answered nothing more leaves.
        const after = calls.length;
        await worker.dispatch.dispatcher.handle(operationId);
        await sendWaiting(worker);
        expect(calls.length).toBe(after);
        // An attempt the pause met before its mark was handed back uncounted; one that left is counted.
        const then = await operation(operationId);
        expect(then.attempts - then.waivedAttempts).toBe(calls.length > before ? 1 : 0);
      }
      expect(outcomes.sent + outcomes.held).toBe(40);
      // No request was ever sent twice for one operation.
      expect(new Set(calls.map((sent) => sent.idempotencyKey)).size).toBe(calls.length);
      await stop();
    });

    it('pauses, resumes, approvals, sales, the dispatcher and the settlement at once: nothing is aborted as a deadlock, and no money moves twice', async () => {
      const { worker, stop } = await switchedOn();
      const settled: PromiseSettledResult<unknown>[] = [];
      let earlier: string[] = [];
      for (let wave = 0; wave < 6; wave += 1) {
        const results = await Promise.allSettled([
          sell(), sell(), sell(),
          call('owner', 'post', at(wave % 2 === 0 ? '/pause' : '/resume')), call('owner', 'post', at('/approve')), call('owner', 'post', at(wave % 2 === 0 ? '/resume' : '/pause')),
          credential(`${SANDBOX_CREDENTIAL}-${wave}`),
          ...earlier.flatMap((id) => [worker.dispatch.dispatcher.handle(id).then(() => worker.dispatch.settlement.apply(id)), worker.dispatch.dispatcher.handle(id)]),
          sendWaiting(worker), recoverMine(worker), stop.round(),
        ]);
        settled.push(...results);
        earlier = results.slice(0, 3).flatMap((result) => (result.status === 'fulfilled' && (result.value as { operationId: string }).operationId ? [(result.value as { operationId: string }).operationId] : []));
      }
      expect(settled.filter((result) => result.status === 'rejected')).toEqual([]);
      expect(settled.flatMap((result) => (result.status === 'fulfilled' && result.value && typeof result.value === 'object' && 'status' in result.value ? [(result.value as Answer).status] : [])).filter((code_) => code_ >= 500)).toEqual([]);
      expect(new Set(calls.map((sent) => sent.idempotencyKey)).size).toBe(calls.length);
      // The money: held is the open tasks' holds, the balance moved by the entries alone, one debit a line.
      const [state, open_, moved, lines, debits] = await Promise.all([
        wallet(), prisma.officeTask.aggregate({ where: { posId: ids.pos, status: 'working' }, _sum: { held: true } }),
        prisma.walletEntry.aggregate({ where: { userId: ids.pos }, _sum: { amount: true, held: true } }), prisma.line.count({ where: { posId: ids.pos } }), prisma.walletEntry.count({ where: { userId: ids.pos, kind: 'activate' } }),
      ]);
      expect(state.held).toBe(open_._sum.held ?? 0);
      expect(state.balance).toBe(START + (moved._sum.amount ?? 0));
      expect(debits).toBe(lines);
      await stop();
    });
  });

  // ── The budget of attempts (final corrections of S.12a) ─────────────────────────────────────────────────

  describe('an attempt the gate hands back uses nothing of the budget, and keeps its number (ADR 0018, amended)', () => {
    const requestedMessages = async (id: string) => (await prisma.outboxMessage.findMany({ where: { aggregateId: id, topic: 'provider-operation.requested' }, orderBy: { sequence: 'asc' } })).map((message) => message.sequence);

    it('five pauses, each between the claim and the mark, then a resume: the sixth attempt leaves once and succeeds', async () => {
      const { worker } = await switchedOn();
      const { operationId, taskId } = await sell();
      const { operations, gate } = worker.dispatch;
      for (let round = 1; round <= 5; round += 1) {
        expect(await operations.claim(operationId, new Date(), gate)).toBe(round);
        expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
        expect(await operations.beginSend(operationId, round, new Date(), gate)).toBeNull();
        // Back to waiting at once, with its number kept and nothing counted.
        expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: round, waivedAttempts: round, sentAt: null, lastError: null });
        expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
        expect(await recoverMine(worker, new Date(Date.now() + 3_600_000))).toBe(0);
        expect(said(await call('owner', 'post', at('/resume')))).toBe('ok');
      }
      // Five administrative pauses and not one connection: the operation is not failed, and nothing left.
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 5, waivedAttempts: 5 });
      expect(calls).toEqual([]);
      // One message a send, each with a sequence no earlier one used.
      expect(await requestedMessages(operationId)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(calls.map((sent) => [sent.idempotencyKey, sent.attempt])).toEqual([[`activate:${taskId}`, 6]]);
      expect(await operation(operationId)).toMatchObject({ status: 'succeeded', attempts: 6, waivedAttempts: 5 });
      expect(await settled(worker, operationId)).toBe('applied');
      expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
      // Nothing more is sent for it, by a repeat of its message or by the pass over waiting operations.
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await sendWaiting(worker)).toBe(0);
      expect(calls).toHaveLength(1);
    });

    it('the budget is still five connections that did not leave: waived attempts between them are not among the five', async () => {
      const { worker } = await switchedOn();
      const { operationId } = await sell();
      const { operations, gate } = worker.dispatch;
      // The adapter says, each time, that it opened no connection.
      answer = async () => ({ left: false, error: 'unreachable' });
      const handBack = async (attempt: number) => {
        expect(await operations.claim(operationId, new Date(), gate)).toBe(attempt);
        await call('owner', 'post', at('/pause'));
        expect(await operations.beginSend(operationId, attempt, new Date(), gate)).toBeNull();
        await call('owner', 'post', at('/resume'));
      };
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('requested');
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('requested');
      await handBack(3);
      await handBack(4);
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('requested');
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('requested');
      // Six attempts taken, four counted: one more may be tried, and it is the fifth.
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 6, waivedAttempts: 2, lastError: 'unreachable' });
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('failed');
      expect(await operation(operationId)).toMatchObject({ status: 'failed', attempts: 7, waivedAttempts: 2, lastError: 'unreachable' });
      expect(calls.map((sent) => sent.attempt)).toEqual([1, 2, 5, 6, 7]);
      expect(await requestedMessages(operationId)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('an attempt whose worker died before the mark: counted while the provider is open, waived while it is closed, and never failed while closed', async () => {
      const { worker } = await switchedOn();
      const { operationId } = await sell();
      const { operations, gate } = worker.dispatch;
      const abandon = async (attempt: number) => {
        expect(await operations.claim(operationId, new Date(), gate)).toBe(attempt);
        // The worker is gone: the lease runs out with no mark.
        await prisma.providerOperation.update({ where: { id: operationId }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
      };
      // Open: an abandoned attempt is one of the five, as before.
      await abandon(1);
      expect(await recoverMine(worker)).toBe(1);
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 0, lastError: 'abandoned' });
      // Closed (paused after the claim): six more, none counted, and the operation is still waiting.
      for (let attempt = 2; attempt <= 7; attempt += 1) {
        await call('owner', 'post', at('/resume'));
        await abandon(attempt);
        await call('owner', 'post', at('/pause'));
        expect(await recoverMine(worker)).toBe(1);
        expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: attempt, waivedAttempts: attempt - 1 });
      }
      // Recovery without a gate (as before this change) counts every one of them: the gate is what waives.
      await call('owner', 'post', at('/resume'));
      await abandon(8);
      await call('owner', 'post', at('/pause'));
      expect(await operations.recover(operationId, new Date())).toBe('requested');
      expect(await operation(operationId)).toMatchObject({ attempts: 8, waivedAttempts: 6 });
      expect(calls).toEqual([]);
      expect(await requestedMessages(operationId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('the attempt\'s number still fences: an answer for an attempt that was handed back cannot settle the one after it, and no number comes back', async () => {
      const { worker } = await switchedOn();
      const { operationId } = await sell();
      const { operations, gate } = worker.dispatch;
      expect(await operations.claim(operationId, new Date(), gate)).toBe(1);
      await call('owner', 'post', at('/pause'));
      expect(await operations.beginSend(operationId, 1, new Date(), gate)).toBeNull();
      // The old attempt is gone for good: it cannot be marked or settled, paused or not.
      await call('owner', 'post', at('/resume'));
      expect(await operations.beginSend(operationId, 1, new Date(), gate)).toBeNull();
      await expect(operations.settle(operationId, 1, { kind: 'confirmed', providerRef: 'LATE', result: null })).rejects.toMatchObject({ status: 409 });
      expect(await operations.claim(operationId, new Date(), gate)).toBe(2);
      await expect(operations.settle(operationId, 1, { kind: 'confirmed', providerRef: 'LATE', result: null })).rejects.toMatchObject({ status: 409 });
      await expect(operations.settle(operationId, 1, { kind: 'not-sent', error: 'unreachable' })).rejects.toMatchObject({ status: 409 });
      expect(await operation(operationId)).toMatchObject({ status: 'pending', attempts: 2, waivedAttempts: 1, providerRef: null });
      // Handing back twice is one hand-back: the second finds the attempt gone and writes nothing.
      expect(await requestedMessages(operationId)).toEqual([0, 1]);
      expect(await operations.beginSend(operationId, 2, new Date(), gate)).not.toBeNull();
      expect(await operations.settle(operationId, 2, { kind: 'confirmed', providerRef: 'R-2', result: null })).toBe('succeeded');
      expect(await operation(operationId)).toMatchObject({ status: 'succeeded', attempts: 2, waivedAttempts: 1, providerRef: 'R-2' });
    });
  });

  // ── Replacing the credential ────────────────────────────────────────────────────────────────────────────

  describe('writing the credential closes the provider until the owner approves again, and no adapter outlives its credential', () => {
    const NEW_CREDENTIAL = 'S12A-SANDBOX-CREDENTIAL-REPLACED-9K3J7H5G1F';
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** A worker process that started before the replacement and has not built its adapters again. */
    const neverRebuilds = (worker: TestWorker) => {
      const readiness = startReadiness(prisma, worker.settings, worker.gateway, async () => worker.built);
      started.push(readiness.stop);
      return readiness;
    };
    /** Holds the provider's row as a replacement of the credential does, uncommitted, until `commit` is called. */
    const replacing = async () => {
      let commit = () => undefined as void;
      const waiting = new Promise<void>((resolve) => { commit = resolve; });
      let held = () => undefined as void;
      const taken = new Promise<void>((resolve) => { held = resolve; });
      const done = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Provider" WHERE "id" = ${ids.provider} FOR UPDATE`;
        await tx.$executeRaw`UPDATE "ProviderCredential" SET "generation" = "generation" + 1 WHERE "providerId" = ${ids.provider} AND "target" = 'sandbox'`;
        await tx.provider.update({ where: { id: ids.provider }, data: { ...NOT_SWITCHED, dispatchPausedAt: undefined } });
        held();
        await waiting;
      }, { timeout: 60_000, maxWait: 20_000 });
      await taken;
      return { commit: async () => { commit(); await done; } };
    };

    it('one write: the new value, the next generation, the approval withdrawn, the attestation withdrawn; a pause is kept', async () => {
      const { worker, stop } = await switchedOn();
      expect(await provider()).toMatchObject({ dispatchApprovedDeployment: HERE, dispatchReadyDeployment: HERE, dispatchReadyTarget: 'sandbox', dispatchReadyGeneration: 1 });
      expect((await sell()).route).toBe('dispatch');
      expect(said(await credential(NEW_CREDENTIAL))).toBe('ok');
      const stored = await credentials();
      expect(stored.map((row) => [row.target, row.generation, open(row.sealedValue)])).toEqual([['sandbox', 2, NEW_CREDENTIAL]]);
      expect(await provider()).toMatchObject({ ...NOT_APPROVED, dispatchReadyAt: null, dispatchReadyTarget: null, dispatchReadyDeployment: null, dispatchReadyGeneration: null, dispatchPausedAt: null });
      expect(await status()).toMatchObject({ hasCredential: true, eligible: false, refusal: 'not-approved', workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // A resume is not the owner's word on the new credential.
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
      // The worker's next round builds its adapter again from what is stored, and says so; the route stays closed.
      await stop.round();
      expect([worker.gateway.generation(code), (await provider()).dispatchReadyGeneration]).toEqual([2, 2]);
      expect(await status()).toMatchObject({ workerReady: true, eligible: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // Only the owner's new approval opens it.
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect(await status()).toMatchObject({ workerReady: true, eligible: true, opens: true });
      expect((await sell()).route).toBe('dispatch');
      // Written while paused: the pause is kept, and the approval goes all the same.
      await call('owner', 'post', at('/pause'));
      const paused = (await provider()).dispatchPausedAt;
      await credential(`${NEW_CREDENTIAL}-AGAIN`);
      expect(await provider()).toMatchObject({ ...NOT_APPROVED, dispatchPausedAt: paused, dispatchReadyAt: null });
      expect((await credentials())[0].generation).toBe(3);
      // Another provider's credential and approval are its own.
      expect(await prisma.provider.findUniqueOrThrow({ where: { id: ids.other } })).toMatchObject(NOT_SWITCHED);
      expect(calls).toEqual([]);
    });

    it('a worker that still holds the replaced credential cannot bring its attestation back, and cannot write over a newer worker\'s', async () => {
      const { worker: old, stop } = await switchedOn();
      await stop();
      const stale = neverRebuilds(old);
      await stale.round();
      expect((await provider()).dispatchReadyGeneration).toBe(1);
      await credential(NEW_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      // Round after round, the old worker has nothing it may say.
      for (let round = 0; round < 3; round += 1) await stale.round();
      expect([old.gateway.generation(code), await provider()]).toEqual([1, expect.objectContaining({ dispatchReadyAt: null, dispatchReadyGeneration: null })]);
      expect(await status()).toMatchObject({ eligible: true, workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // A newer worker attests the stored generation; the old one, on its next rounds, leaves that as it is.
      const fresh = await workerWith();
      const freshStop = await attest(fresh);
      const said1 = await provider();
      expect(said1).toMatchObject({ dispatchReadyDeployment: HERE, dispatchReadyGeneration: 2 });
      for (let round = 0; round < 3; round += 1) await stale.round();
      expect(await provider()).toMatchObject({ dispatchReadyAt: said1.dispatchReadyAt, dispatchReadyGeneration: 2 });
      expect((await sell()).route).toBe('dispatch');
      // An attestation that names the old generation is not believed either, whoever wrote it.
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyAt: new Date(), dispatchReadyGeneration: 1 } });
      expect((await sell()).route).toBe('manual');
      await freshStop.round();
      expect((await sell()).route).toBe('dispatch');
    });

    it('while an operation is requested: no worker takes it until the new approval, and then only one that holds the new credential, once', async () => {
      const { worker: old, stop } = await switchedOn();
      const { operationId, taskId } = await sell();
      await stop();
      await credential(NEW_CREDENTIAL);
      const untaken = async () => expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0, waivedAttempts: 0, sentAt: null });
      // Not approved: nobody sends, with the old adapter or with a new one.
      const rebuilt = await workerWith();
      expect([old.gateway.generation(code), rebuilt.gateway.generation(code)]).toEqual([1, 2]);
      for (const worker of [old, rebuilt]) expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      await untaken();
      // Approved again: the worker that still holds the replaced credential is refused all the same.
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect(await old.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await sendWaiting(old)).toBe(0);
      await untaken();
      expect(calls).toEqual([]);
      // Nothing was released by any of it.
      expect(await prisma.officeTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: 'working', held: PRICE });
      // The worker that built its adapter from what is stored sends it, with the new credential, once.
      expect(await rebuilt.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect([calls.map((sent) => sent.attempt), usedCredentials]).toEqual([[1], [NEW_CREDENTIAL]]);
      // And the old worker, once it has built again (its timer's round), holds the new one too.
      const refreshed = startReadiness(prisma, old.settings, old.gateway, old.rebuild);
      started.push(refreshed.stop);
      await refreshed.round();
      expect(old.gateway.generation(code)).toBe(2);
    });

    it('while an attempt is pending before its mark: it is handed back uncounted, the hold stays, and it is sent later with the new credential only', async () => {
      const { worker } = await switchedOn();
      const { operationId, taskId } = await sell();
      const { operations, gate } = worker.dispatch;
      expect(await operations.claim(operationId, new Date(), gate)).toBe(1);
      await credential(NEW_CREDENTIAL);
      expect(await operations.beginSend(operationId, 1, new Date(), gate)).toBeNull();
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1, sentAt: null });
      expect(calls).toEqual([]);
      expect(await prisma.officeTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: 'working', held: PRICE });
      expect(await wallet()).toMatchObject({ balance: START, held: PRICE });
      // Approved again, this worker still on the old credential: refused at the claim, nothing counted.
      await call('owner', 'post', at('/approve'));
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1 });
      // Its adapters built again: sent, as attempt 2, with the new credential.
      worker.gateway.use(await worker.rebuild());
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect([calls.map((sent) => sent.attempt), usedCredentials]).toEqual([[2], [NEW_CREDENTIAL]]);
    });

    it('while an attempt is pending after its mark: that attempt finishes and is settled; nothing is recalled, released or sent again', async () => {
      const { worker } = await switchedOn();
      const sent = await sell();
      const silent = await sell();
      const exception = await sell();
      const waiting = await sell();
      const { operations, gate } = worker.dispatch;
      const marked = async (id: string) => {
        const attempt = (await operations.claim(id, new Date(), gate)) as number;
        expect(await operations.beginSend(id, attempt, new Date(), gate)).not.toBeNull();
        return attempt;
      };
      const attempts = { sent: await marked(sent.operationId), silent: await marked(silent.operationId), exception: await marked(exception.operationId) };
      // The owner replaces the credential while the provider has the three requests.
      expect(said(await credential(NEW_CREDENTIAL))).toBe('ok');
      for (const id of [sent.operationId, silent.operationId, exception.operationId]) expect(await operation(id)).toMatchObject({ status: 'pending', attempts: 1, waivedAttempts: 0 });
      expect(await wallet()).toMatchObject({ balance: START, held: 4 * PRICE });
      // 1. The verdict of what left is written and applied.
      expect(await operations.settle(sent.operationId, attempts.sent, { kind: 'confirmed', providerRef: 'R-OLD-1', result: null })).toBe('succeeded');
      expect(await settled(worker, sent.operationId)).toBe('applied');
      // 2. No answer: unknown, never sent again, with the old adapter or a new one; its late verdict is taken.
      await prisma.providerOperation.update({ where: { id: silent.operationId }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
      expect(await recoverMine(worker)).toBe(1);
      expect(await operation(silent.operationId)).toMatchObject({ status: 'unknown', waivedAttempts: 0 });
      await call('owner', 'post', at('/approve'));
      const rebuilt = await workerWith();
      for (const each of [worker, rebuilt]) expect(await each.dispatch.dispatcher.handle(silent.operationId)).toBe('skipped');
      expect(await operations.settle(silent.operationId, attempts.silent, { kind: 'confirmed', providerRef: 'R-OLD-2', result: null })).toBe('succeeded');
      expect(await settled(worker, silent.operationId)).toBe('applied');
      // 3. Confirmed, and its serial went to a line meanwhile: the exception is recorded and the hold kept.
      const row = await prisma.officeTask.findUniqueOrThrow({ where: { id: exception.taskId } });
      await prisma.line.create({ data: { msisdn: '0599999998', iccid: row.iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      expect(await operations.settle(exception.operationId, attempts.exception, { kind: 'confirmed', providerRef: 'R-OLD-3', result: null })).toBe('succeeded');
      expect(await settled(worker, exception.operationId)).toBe('exception');
      // Two captured, the exception's and the waiting one's holds kept; the adapter was not called by any of it.
      expect(await wallet()).toMatchObject({ balance: START - 2 * PRICE, held: 2 * PRICE });
      expect(calls).toEqual([]);
      // The one that had not been taken goes with the new credential.
      expect(await rebuilt.dispatch.dispatcher.handle(waiting.operationId)).toBe('succeeded');
      expect(usedCredentials).toEqual([NEW_CREDENTIAL]);
    });

    it('a replacement during the provider\'s call: the request that was marked goes, with the credential it was marked under, and nothing after it', async () => {
      const { worker } = await switchedOn();
      const first = await sell();
      const second = await sell();
      let replaced = '';
      answer = async () => {
        replaced = said(await credential(NEW_CREDENTIAL));
        return { left: true, answer: 'confirmed', providerRef: 'R-DURING' };
      };
      expect(await worker.dispatch.dispatcher.handle(first.operationId)).toBe('succeeded');
      expect(replaced).toBe('ok');
      expect(usedCredentials).toEqual([SANDBOX_CREDENTIAL]);
      expect(await settled(worker, first.operationId)).toBe('applied');
      answer = async () => ({ left: true, answer: 'confirmed', providerRef: 'R-NEXT' });
      expect(await worker.dispatch.dispatcher.handle(second.operationId)).toBe('skipped');
      await call('owner', 'post', at('/approve'));
      expect(await worker.dispatch.dispatcher.handle(second.operationId)).toBe('skipped');
      expect(await operation(second.operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(calls).toHaveLength(1);
    });

    it('two workers at once, one on the old credential and one on the new: one send, with the new one', async () => {
      const { worker: old, stop } = await switchedOn();
      const sold = [await sell(), await sell(), await sell()];
      expect(sold.map((sale) => sale.route)).toEqual(['dispatch', 'dispatch', 'dispatch']);
      await stop();
      await credential(NEW_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      const fresh = await workerWith();
      const stale = neverRebuilds(old);
      const freshStop = await attest(fresh);
      // Both attest, both are delivered every message, several times over, at once.
      const handled = await Promise.all([
        ...sold.flatMap(({ operationId }) => Array.from({ length: 6 }, (_, turn) => (turn % 2 === 0 ? old : fresh).dispatch.dispatcher.handle(operationId))),
        stale.round(), freshStop.round(), sendWaiting(old), recoverMine(old),
      ]);
      expect(handled.filter((outcome) => outcome === 'succeeded')).toHaveLength(3);
      // One request an operation, every one of them with the new credential; the old adapter was never used.
      expect(calls.map((sent) => sent.idempotencyKey).sort()).toEqual(sold.map(({ taskId }) => `activate:${taskId}`).sort());
      expect(new Set(usedCredentials)).toEqual(new Set([NEW_CREDENTIAL]));
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: HERE, dispatchReadyGeneration: 2 });
      for (const { operationId } of sold) expect(await operation(operationId)).toMatchObject({ status: 'succeeded', attempts: 1, waivedAttempts: 0 });
    });

    it('a worker that stops and starts again: stopped, it says nothing; started, it builds from what is stored then', async () => {
      const { worker: before, stop } = await switchedOn();
      const { operationId } = await sell();
      await stop();
      expect(await provider()).toMatchObject({ dispatchReadyAt: null, dispatchReadyGeneration: null });
      expect((await sell()).route).toBe('manual');
      // Replaced while no worker runs.
      await credential(NEW_CREDENTIAL);
      await call('owner', 'post', at('/approve'));
      expect(await status()).toMatchObject({ eligible: true, workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // The new process reads what is stored now, and nothing of the old process is in it.
      const after = await workerWith();
      expect([before.gateway.generation(code), after.gateway.generation(code)]).toEqual([1, 2]);
      await attest(after);
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: HERE, dispatchReadyGeneration: 2 });
      expect((await sell()).route).toBe('dispatch');
      expect(await after.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(usedCredentials).toEqual([NEW_CREDENTIAL]);
      // A worker that starts while the key no longer opens the credential builds nothing and says nothing.
      process.env.SECRETS_KEY = OTHER_KEY;
      const locked = await workerWith();
      process.env.SECRETS_KEY = KEY;
      expect([locked.gateway.holds(code), locked.built.skipped.get(code)]).toEqual([false, 'credential-unreadable']);
    });

    it('a replacement that holds the row before the claim, and before the mark: each waits for it, then is refused; the marked-then-refused attempt is handed back', async () => {
      const { worker } = await switchedOn();
      const early = await sell();
      const late = await sell();
      const { operations, gate } = worker.dispatch;
      expect(await operations.claim(late.operationId, new Date(), gate)).toBe(1);
      const replacement = await replacing();
      let claimed: unknown = 'waiting';
      let marked: unknown = 'waiting';
      const claiming = worker.dispatch.dispatcher.handle(early.operationId).then((outcome) => { claimed = outcome; return outcome; });
      const marking = operations.beginSend(late.operationId, 1, new Date(), gate).then((outgoing) => { marked = outgoing; return outgoing; });
      await sleep(600);
      // Both wait on the row: neither has taken, marked or sent anything.
      expect([claimed, marked]).toEqual(['waiting', 'waiting']);
      expect(await operation(early.operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(await operation(late.operationId)).toMatchObject({ status: 'pending', attempts: 1, sentAt: null });
      await replacement.commit();
      expect([await claiming, await marking]).toEqual(['skipped', null]);
      expect(await operation(early.operationId)).toMatchObject({ status: 'requested', attempts: 0, waivedAttempts: 0 });
      expect(await operation(late.operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1, sentAt: null });
      expect(calls).toEqual([]);
    });

    it('the owner\'s writes wait for an attempt that is being taken or marked: a credential, a pause, an approval and a resume each hold the provider\'s row', async () => {
      await switchedOn();
      // What the gate holds while `claim` or `beginSend` runs: the provider's row, shared.
      const marking = async () => {
        let release = () => undefined as void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        let held = () => undefined as void;
        const taken = new Promise<void>((resolve) => { held = resolve; });
        const done = prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM "Provider" WHERE "id" = ${ids.provider} FOR SHARE`;
          held();
          await waiting;
        }, { timeout: 60_000, maxWait: 20_000 });
        await taken;
        return { release: async () => { release(); await done; } };
      };
      const writes: [string, () => Promise<Answer>][] = [
        ['a new credential', () => credential(NEW_CREDENTIAL)], ['a pause', () => call('owner', 'post', at('/pause'))],
        ['an approval', () => call('owner', 'post', at('/approve'))], ['a resume', () => call('owner', 'post', at('/resume'))],
      ];
      for (const [what, write] of writes) {
        const before = [await provider(), await credentials()];
        const gate = await marking();
        let answered: Answer | null = null;
        const writing = write().then((got) => { answered = got; return got; });
        await sleep(400);
        // The write has neither been answered nor changed anything while the attempt holds the row.
        expect([what, answered]).toEqual([what, null]);
        expect([await provider(), await credentials()]).toEqual(before);
        await gate.release();
        expect([what, said(await writing)]).toEqual([what, 'ok']);
      }
    });

    it('thirty rounds of a replacement against a dispatch, at once: the request went under the old credential before the replacement was committed, or it never went', async () => {
      const { worker, stop } = await switchedOn();
      const outcomes = { sent: 0, held: 0 };
      for (let round = 0; round < 30; round += 1) {
        // Each round starts switched on, with a worker that holds what is stored and has said so.
        await call('owner', 'post', at('/approve'));
        await stop.round();
        const holding = worker.gateway.generation(code);
        expect(holding).toBe(round + 1);
        const storedBefore = open((await credentials())[0].sealedValue);
        const { operationId, route } = await sell();
        expect(route).toBe('dispatch');
        const before = calls.length;
        const [written, handled] = await Promise.all([credential(`${NEW_CREDENTIAL}-${round}`), worker.dispatch.dispatcher.handle(operationId)]);
        expect(said(written)).toBe('ok');
        const row = await operation(operationId);
        if (calls.length > before) {
          expect([calls.length - before, handled, row.status, usedCredentials[usedCredentials.length - 1]]).toEqual([1, 'succeeded', 'succeeded', storedBefore]);
          outcomes.sent += 1;
        } else {
          expect([handled, row.status, row.sentAt, row.attempts - row.waivedAttempts]).toEqual(['skipped', 'requested', null, 0]);
          outcomes.held += 1;
        }
        // Once the replacement is answered, this worker (still on the old generation) sends nothing more.
        expect(worker.gateway.generation(code)).toBe(holding);
        const after = calls.length;
        await worker.dispatch.dispatcher.handle(operationId);
        await sendWaiting(worker);
        expect(calls.length).toBe(after);
        expect(await provider()).toMatchObject(NOT_APPROVED);
        await prisma.providerOperation.updateMany({ where: { providerId: ids.provider, status: 'requested' }, data: { status: 'failed', lastError: 'abandoned', appliedAt: new Date() } });
      }
      expect(outcomes.sent + outcomes.held).toBe(30);
      expect(new Set(calls.map((sent) => sent.idempotencyKey)).size).toBe(calls.length);
    });
  });

  // ── Which deployment ────────────────────────────────────────────────────────────────────────────────────

  describe('an approval is one deployment\'s: another that shares the database, or was restored from it, is not opened by it', () => {
    it('two deployments of the same target on one database: the approval given on one opens nothing on the other, for its API or its worker', async () => {
      const { worker: here } = await switchedOn();
      const { operationId } = await sell();
      const hereSaid = await provider();
      expect(hereSaid).toMatchObject({ dispatchApprovedDeployment: HERE, dispatchReadyDeployment: HERE });
      // The other deployment: same database, same target, same list, same key, its own name.
      deployment({ id: ELSEWHERE });
      expect(await status()).toMatchObject({ deployment: ELSEWHERE, approvedDeployment: HERE, hasCredential: true, eligible: false, refusal: 'approved-for-other-deployment', workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
      // Its worker can open the credential and build an adapter, and still neither sends nor attests.
      const there = await workerWith();
      expect(there.gateway.generation(code)).toBe(1);
      const thereStop = await attest(there);
      for (let round = 0; round < 3; round += 1) await thereStop.round();
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: HERE, dispatchReadyAt: hereSaid.dispatchReadyAt });
      expect(await there.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await sendWaiting(there)).toBe(0);
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      // Its stopping withdraws nothing of the first deployment's.
      await thereStop();
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: HERE, dispatchReadyAt: hereSaid.dispatchReadyAt });
      expect(calls).toEqual([]);
      // The first deployment is untouched by all of it.
      deployment();
      expect((await sell()).route).toBe('dispatch');
      expect(await here.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
    });

    it('a provider has one approval: given on the other deployment, it leaves the first, whose API and worker then stop', async () => {
      const { worker: here } = await switchedOn();
      const { operationId } = await sell();
      deployment({ id: ELSEWHERE });
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect(await provider()).toMatchObject({ dispatchApprovedDeployment: ELSEWHERE, dispatchApprovedTarget: 'sandbox' });
      // Still the first deployment's attestation on the row: the second's API does not take it for its own.
      expect(await status()).toMatchObject({ eligible: true, workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // The first deployment: closed, for its API and for its worker, under the lock.
      deployment();
      expect(await status()).toMatchObject({ eligible: false, refusal: 'approved-for-other-deployment', opens: false });
      expect((await sell()).route).toBe('manual');
      expect(await here.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      // The second deployment's worker attests and sends; the first's can no longer write its attestation.
      deployment({ id: ELSEWHERE });
      const there = await workerWith();
      await attest(there);
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: ELSEWHERE, dispatchReadyGeneration: 1 });
      const readyThere = (await provider()).dispatchReadyAt;
      const hereAgain = startReadiness(prisma, here.settings, here.gateway, here.rebuild);
      started.push(hereAgain.stop);
      for (let round = 0; round < 3; round += 1) await hereAgain.round();
      expect(await provider()).toMatchObject({ dispatchReadyDeployment: ELSEWHERE, dispatchReadyAt: readyThere });
      expect((await sell()).route).toBe('dispatch');
      expect(await there.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(calls).toHaveLength(1);
    });

    it('a database restored from another deployment\'s backup: its approval and its attestation, however fresh, open nothing here', async () => {
      // The rows as the backup carried them: approved, not paused, attested a second ago, for the same target.
      deployment();
      await credential(SANDBOX_CREDENTIAL);
      await prisma.provider.update({
        where: { id: ids.provider },
        data: { dispatchApprovedAt: new Date(), dispatchApprovedByLoginName: name('owner'), dispatchApprovedTarget: 'sandbox', dispatchApprovedDeployment: ELSEWHERE, dispatchReadyAt: new Date(), dispatchReadyTarget: 'sandbox', dispatchReadyDeployment: ELSEWHERE, dispatchReadyGeneration: 1 },
      });
      expect(await status()).toMatchObject({ eligible: false, refusal: 'approved-for-other-deployment', workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      const worker = await workerWith();
      const operationId = (await prisma.providerOperation.create({ data: { idempotencyKey: `s12-restored-${randomUUID()}`, requestHash: 'restored', action: 'activate', providerId: ids.provider, packageCode: code, status: 'requested' } })).id;
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(await operation(operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(calls).toEqual([]);
      // The database itself refuses an approval or an attestation that names no deployment.
      await expect(prisma.provider.update({ where: { id: ids.provider }, data: { dispatchApprovedDeployment: null } })).rejects.toThrow();
      await expect(prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyDeployment: null } })).rejects.toThrow();
      await expect(prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyGeneration: null } })).rejects.toThrow();
      await expect(prisma.provider.update({ where: { id: ids.provider }, data: { dispatchApprovedDeployment: 'Not A Name' } })).rejects.toThrow();
    });
  });

  // ── The attestation's life ──────────────────────────────────────────────────────────────────────────────

  describe('the worker\'s attestation: believed for a minute, and for nothing it does not say', () => {
    it('a worker that is killed leaves its last word behind: the route opens until it is a minute old; what is opened then waits, and is sent when a worker is back', async () => {
      const { worker } = await switchedOn();
      // Killed: no round, no withdrawal. Its last attestation ages.
      const aged = (ms: number) => prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyAt: new Date(Date.now() - ms) } });
      await aged(READY_TTL_MS - 5_000);
      const inWindow = await sell();
      expect(inWindow.route).toBe('dispatch');
      await aged(READY_TTL_MS + 1_000);
      expect(await status()).toMatchObject({ eligible: true, workerReady: false, opens: false });
      expect((await sell()).route).toBe('manual');
      // The sale opened in the window: recorded, held, sent by nobody, and its submitter's to cancel (D7).
      expect(await operation(inWindow.operationId)).toMatchObject({ status: 'requested', attempts: 0 });
      expect(await prisma.officeTask.findUniqueOrThrow({ where: { id: inWindow.taskId } })).toMatchObject({ status: 'working', held: PRICE });
      const other = await (async () => { await aged(1_000); const sold = await sell(); await aged(READY_TTL_MS + 1_000); return sold; })();
      expect(said(await call('pos', 'post', `/office/tasks/${other.taskId}/cancel`))).toBe('ok');
      expect(calls).toEqual([]);
      // A worker is back: it says so again, and sends what waited, once.
      await attest(worker);
      expect((await sell()).route).toBe('dispatch');
      expect(await worker.dispatch.dispatcher.handle(inWindow.operationId)).toBe('succeeded');
      expect(calls.map((sent) => sent.idempotencyKey)).toEqual([`activate:${inWindow.taskId}`]);
    });

    it('a fresh attestation opens nothing after a pause or a new credential, and a send is proved at the mark, not at the attestation', async () => {
      const { worker } = await switchedOn();
      const { operationId } = await sell();
      await call('owner', 'post', at('/pause'));
      expect(await status()).toMatchObject({ workerReady: true, eligible: false, refusal: 'paused', opens: false });
      expect((await sell()).route).toBe('manual');
      await call('owner', 'post', at('/resume'));
      // The attestation is true and fresh; the gate is still asked at the claim and at the mark, and each can refuse.
      let asked = 0;
      const counting = await workerWith(undefined, (gate) => ({ permits: async (tx, providerId) => { asked += 1; return gate.permits(tx, providerId); } }));
      expect(await counting.dispatch.dispatcher.handle(operationId)).toBe('succeeded');
      expect(asked).toBe(2);
      // A gate that says yes at the claim and no at the mark: nothing leaves, whatever was attested.
      const second = await sell();
      let turn = 0;
      const refusingAtMark = await workerWith(undefined, (gate) => ({ permits: async (tx, providerId) => { turn += 1; return turn === 2 ? false : gate.permits(tx, providerId); } }));
      expect(await refusingAtMark.dispatch.dispatcher.handle(second.operationId)).toBe('skipped');
      expect(await operation(second.operationId)).toMatchObject({ status: 'requested', attempts: 1, waivedAttempts: 1, sentAt: null });
      expect(calls).toHaveLength(1);
      // Written anew: the attestation is gone with the approval, and the worker's next one opens nothing by itself.
      await credential(`${SANDBOX_CREDENTIAL}-2`);
      expect(await status()).toMatchObject({ workerReady: false, opens: false });
      await worker.gateway.use(await worker.rebuild());
      expect((await sell()).route).toBe('manual');
    });
  });
});
