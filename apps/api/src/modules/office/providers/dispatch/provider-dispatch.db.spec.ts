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
import { dispatchWaiting, recoverExpired } from '../operations/operation-dispatcher';
import { DeploymentSendGate, type SendGate } from './dispatch-gate';
import { READY_TTL_MS, dispatchSettings, type ProviderTarget } from './dispatch-policy';
import { buildAdapters, type AdapterFactory } from './provider-adapters';
import { RoutingProviderGateway } from './routing-gateway';

// PostgreSQL only (TEST_DATABASE_URL), over HTTP, in a process set up as production is (`NODE_ENV=production`, no
// simulation). ADR 0019, D18; spec items 25 and 26; plan slice S.12a. The owner's switch (approve, pause, resume,
// the credential), what the API then decides about a sale, and what a worker then does with a recorded
// operation: all against real rows, with the provider's row lock deciding the races.
//
// This build has no adapter, so a real worker builds none and sends nothing. To exercise the rules that will hold
// once one exists, the specs here hand `buildAdapters` an adapter of their own, which reaches nothing and counts
// its calls. That is the only place an adapter can come from in this file.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const START = 1_000_000;
const SANDBOX_CREDENTIAL = 'S12A-SANDBOX-CREDENTIAL-7Q2W9E4R6T1Y8U3I';
const LIVE_CREDENTIAL = 'S12A-LIVE-CREDENTIAL-5P0O2I8U4Y6T1R3E';
const KEY = Buffer.alloc(32, 12).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 13).toString('base64');
const ENV = ['NODE_ENV', 'PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'PROVIDER_SIMULATION', 'SECRETS_KEY', 'DATABASE_URL'] as const;

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

  /** The deployment's three settings, as both processes are given them unless a test says otherwise. */
  const deployment = (over: { dispatch?: string | null; adapters?: string | null; target?: string | null } = {}) => {
    const set = (key: string, value: string | null | undefined, fallback: string) => {
      if (value === null) delete process.env[key];
      else process.env[key] = value ?? fallback;
    };
    set('PROVIDER_DISPATCH', over.dispatch, '1');
    set('PROVIDER_ADAPTERS', over.adapters, code);
    set('PROVIDER_TARGET', over.target, 'sandbox');
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

  /** A spec's own adapter: it reaches nothing, counts what it is asked, and answers what the spec says. */
  const calls: OutgoingOperation[] = [];
  let answer: (sent: OutgoingOperation) => Promise<SendEvidence> = async () => ({ left: true, answer: 'confirmed', providerRef: 'REF-S12' });
  const factories: Record<string, AdapterFactory> = {
    [code]: (target: ProviderTarget) => ({ providerCode: code, target, send: async (sent) => { calls.push(sent); return answer(sent); } }),
  };
  /**
   * A worker as `worker.ts` builds one: its own settings, the adapters those allow (with the spec's adapter as the
   * build's only one), the routing gateway over them, and the deployment's gate. `env` is the worker's own
   * environment: it need not be the API's.
   */
  const workerWith = async (env: Record<string, string | undefined> = { PROVIDER_DISPATCH: process.env.PROVIDER_DISPATCH, PROVIDER_ADAPTERS: process.env.PROVIDER_ADAPTERS, PROVIDER_TARGET: process.env.PROVIDER_TARGET }, wrap?: (gate: SendGate) => SendGate) => {
    const settings = dispatchSettings(env);
    const built = buildAdapters(settings, await readCredentials(prisma, settings), factories);
    const gateway = new RoutingProviderGateway(built.adapters);
    const gate = new DeploymentSendGate(settings, (provided) => gateway.holds(provided));
    const dispatch = buildProviderDispatch(prisma, {} as IORedis, gateway, wrap ? wrap(gate) : gate, `s12-${tag}`, quiet);
    return { settings, built, gateway, dispatch };
  };
  /** The worker says it holds an adapter, as it does on its timer; answers what withdraws it. */
  const attest = async (worker: Awaited<ReturnType<typeof workerWith>>) => {
    const stop = startReadiness(prisma, worker.built, worker.settings);
    for (let tries = 0; tries < 100 && worker.built.adapters.size > 0 && !(await provider()).dispatchReadyAt; tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    return stop;
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
    for (const key of ['PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET'] as const) delete process.env[key];
    process.env.SECRETS_KEY = KEY;
    recorded.length = 0;
    calls.length = 0;
    answer = async () => ({ left: true, answer: 'confirmed', providerRef: 'REF-S12' });
    const operations = (await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } })).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: operations } } });
    await prisma.providerOperation.deleteMany({ where: { id: { in: operations } } });
    await prisma.providerCredential.deleteMany({ where: { providerId: { in: [ids.provider, ids.other] } } });
    await prisma.provider.updateMany({ where: { id: { in: [ids.provider, ids.other] } }, data: { dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null, dispatchPausedAt: null, dispatchReadyAt: null, dispatchReadyTarget: null } });
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
      expect(Object.keys(read).sort()).toEqual(['approvedAt', 'approvedByLoginName', 'approvedTarget', 'dispatchOn', 'eligible', 'hasCredential', 'listed', 'opens', 'pausedAt', 'refusal', 'target', 'workerReady']);
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
      ];
      for (const [, settings] of unset) {
        deployment(settings);
        expect(said(await call('owner', 'post', at('/approve')))).toBe('409 DISPATCH_NOT_CONFIGURED');
        expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_CONFIGURED');
      }
      // Set up, and no credential for this target yet.
      deployment();
      expect(said(await call('owner', 'post', at('/approve')))).toBe('409 DISPATCH_CREDENTIAL_MISSING');
      expect(await provider()).toMatchObject({ dispatchApprovedAt: null, dispatchApprovedTarget: null, dispatchApprovedByLoginName: null });
      await credential(SANDBOX_CREDENTIAL);
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      const row = await provider();
      expect(row).toMatchObject({ dispatchApprovedByLoginName: name('owner'), dispatchApprovedTarget: 'sandbox', dispatchPausedAt: null });
      expect(row.dispatchApprovedAt).toBeInstanceOf(Date);
      expect(await status()).toMatchObject({ dispatchOn: true, listed: true, target: 'sandbox', approvedTarget: 'sandbox', eligible: true, refusal: null });
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
      await credential(LIVE_CREDENTIAL);
      // A resume is not an approval: the one on record is for sandbox.
      expect(said(await call('owner', 'post', at('/resume')))).toBe('409 DISPATCH_NOT_APPROVED');
      expect(said(await call('owner', 'post', at('/approve')))).toBe('ok');
      expect(await status()).toMatchObject({ approvedTarget: 'live', eligible: true });
      // And back on sandbox, the live approval does not stand either.
      deployment({ target: 'sandbox' });
      expect(await status()).toMatchObject({ eligible: false, refusal: 'approved-for-other-target' });
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
      await credential(SANDBOX_CREDENTIAL);
      expect(said(await call('owner', 'post', at('/resume')))).toBe('ok');
      expect(await provider()).toMatchObject({ dispatchPausedAt: null, dispatchApprovedTarget: 'sandbox' });
      // A provider that was never approved can be paused, and cannot be resumed into dispatching.
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null } });
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
      const settings = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: code, PROVIDER_TARGET: 'sandbox' });
      const real = buildAdapters(settings, await readCredentials(prisma, settings));
      expect([[...real.adapters.keys()], [...real.skipped]]).toEqual([[], [[code, 'no-adapter']]]);
      const stop = startReadiness(prisma, real, settings);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await provider()).toMatchObject({ dispatchReadyAt: null, dispatchReadyTarget: null });
      await stop();
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
      expect(await provider()).toMatchObject({ dispatchReadyAt: null });
      expect((await sell()).route).toBe('manual');
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyAt: new Date(Date.now() - READY_TTL_MS - 1_000), dispatchReadyTarget: 'sandbox' } });
      expect((await sell()).route).toBe('manual');
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyAt: new Date(), dispatchReadyTarget: 'live' } });
      expect((await sell()).route).toBe('manual');
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchReadyAt: new Date(), dispatchReadyTarget: 'sandbox' } });
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
      const full = { PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: code, PROVIDER_TARGET: 'sandbox' };
      // The API is fully set; each of these workers is not, so none attests and every sale is manual.
      for (const env of [{}, { ...full, PROVIDER_DISPATCH: undefined }, { ...full, PROVIDER_ADAPTERS: `${code}-other` }, { ...full, PROVIDER_TARGET: undefined }, { ...full, PROVIDER_TARGET: 'live' }, { ...full, PROVIDER_ADAPTERS: `${code},${code}` }]) {
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
      for (const env of [{}, { ...full, PROVIDER_ADAPTERS: `${code}-other` }, { ...full, PROVIDER_TARGET: 'live' }]) {
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
        expect(await dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations)).toBe(0);
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
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null } });
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      await untouched();
      await prisma.provider.update({ where: { id: ids.provider }, data: { dispatchApprovedAt: new Date(), dispatchApprovedByLoginName: name('owner'), dispatchApprovedTarget: 'live' } });
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
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
      expect(await dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations)).toBe(0);
      expect(await recoverExpired(worker.dispatch.operations)).toBe(0);
      expect(await operation(first.operationId)).toMatchObject({ status: 'requested', attempts: 0, sentAt: null });
      expect(calls).toEqual([]);
      // Nothing was released by the pause.
      expect(await wallet()).toMatchObject({ balance: START, held: 3 * PRICE });
      // The submitter withdraws one (D7).
      expect(said(await call('pos', 'post', `/office/tasks/${first.taskId}/cancel`))).toBe('ok');
      expect(await operation(first.operationId)).toMatchObject({ status: 'failed', lastError: 'abandoned' });
      expect(await wallet()).toMatchObject({ held: 2 * PRICE });
      // Resumed: the one that waited is sent by the timer's pass, once; the cancelled one never.
      expect(said(await call('owner', 'post', at('/resume')))).toBe('ok');
      expect(await dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations)).toBeGreaterThanOrEqual(1);
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
        const attempt = await worker.dispatch.operations.claim(id, new Date(), new DeploymentSendGate(worker.settings, () => true));
        expect(await worker.dispatch.operations.beginSend(id, attempt as number, new Date(), new DeploymentSendGate(worker.settings, () => true))).not.toBeNull();
        return attempt as number;
      };
      const attempts = { confirmed: await pending(confirmed.operationId), silent: await pending(silent.operationId), taken: await pending(taken.operationId) };
      expect(said(await call('owner', 'post', at('/pause')))).toBe('ok');
      // 1. The verdict of an attempt that had left is written and applied: one line, one capture.
      expect(await worker.dispatch.operations.settle(confirmed.operationId, attempts.confirmed, { kind: 'confirmed', providerRef: 'R-1', result: null })).toBe('succeeded');
      expect(await worker.dispatch.settlement.apply(confirmed.operationId)).toBe('applied');
      // 2. No answer: unknown, the hold kept, never sent again; its late verdict is then taken and applied.
      await prisma.providerOperation.update({ where: { id: silent.operationId }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
      expect(await recoverExpired(worker.dispatch.operations)).toBe(1);
      expect(await operation(silent.operationId)).toMatchObject({ status: 'unknown' });
      expect(await worker.dispatch.dispatcher.handle(silent.operationId)).toBe('skipped');
      expect(await worker.dispatch.operations.settle(silent.operationId, attempts.silent, { kind: 'confirmed', providerRef: 'R-2', result: null })).toBe('succeeded');
      expect(await worker.dispatch.settlement.apply(silent.operationId)).toBe('applied');
      // 3. Confirmed, and its serial went to a line meanwhile: the exception is recorded, the hold kept.
      const row = await prisma.officeTask.findUniqueOrThrow({ where: { id: taken.taskId } });
      await prisma.line.create({ data: { msisdn: '0599999999', iccid: row.iccid, esim: false, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 86_400_000), terms: {} } });
      expect(await worker.dispatch.operations.settle(taken.operationId, attempts.taken, { kind: 'confirmed', providerRef: 'R-3', result: null })).toBe('succeeded');
      expect(await worker.dispatch.settlement.apply(taken.operationId)).toBe('exception');
      // The sweeper finds nothing left undone, and the money is exactly: two captured, one held.
      expect(await worker.dispatch.settlement.applyPending()).toBe(0);
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

    it('a pause that commits between the claim and the mark: the attempt is not marked, so the provider is not called; recovery puts it back', async () => {
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
      const { operationId } = await sell();
      expect(await worker.dispatch.dispatcher.handle(operationId)).toBe('skipped');
      expect(asked).toBe(2);
      expect(calls).toEqual([]);
      // Taken, never marked: provably unsent. When its lease ends it goes back to waiting, and stays there paused.
      expect(await operation(operationId)).toMatchObject({ status: 'pending', attempts: 1, sentAt: null });
      await prisma.providerOperation.update({ where: { id: operationId }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
      expect(await recoverExpired(worker.dispatch.operations)).toBe(1);
      expect(await operation(operationId)).toMatchObject({ status: 'requested', sentAt: null });
      expect(await dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations)).toBe(0);
      expect(calls).toEqual([]);
    });

    it('a pause that holds the row before the mark: the mark waits, then is refused: nothing is sent', async () => {
      const { worker, stop } = await switchedOn();
      const { operationId } = await sell();
      const open_ = new DeploymentSendGate(worker.settings, (provided) => worker.gateway.holds(provided));
      const attempt = await worker.dispatch.operations.claim(operationId, new Date(), open_);
      expect(attempt).toBe(1);
      const pause = await pausing();
      let marked: unknown = 'waiting';
      const marking = worker.dispatch.operations.beginSend(operationId, 1, new Date(), open_).then((outgoing) => { marked = outgoing; return outgoing; });
      await sleep(600);
      expect(marked).toBe('waiting');
      await pause.commit();
      expect(await marking).toBeNull();
      expect(await operation(operationId)).toMatchObject({ status: 'pending', sentAt: null });
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
      expect(await worker.dispatch.settlement.apply(first.operationId)).toBe('applied');
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
        await dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations);
        expect(calls.length).toBe(after);
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
          dispatchWaiting(worker.dispatch.dispatcher, worker.dispatch.operations), recoverExpired(worker.dispatch.operations),
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
});
