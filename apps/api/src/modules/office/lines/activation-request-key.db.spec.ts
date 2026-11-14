import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import IORedis from 'ioredis';
import request from 'supertest';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { capturedOutput } from '../../shared/testing/captured-output';
import { DuplicateGuardInterceptor, type WriteStore } from '../../shared/duplicate-guard.interceptor';
import type { NoticeService } from '../../notifications/notice.service';
import { officeTestApp } from '../testing/office-test-app';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D14; spec item 4 (without "required"); plan slice S.6.
// A request that opens an activation task carries an `Idempotency-Key`. The database keeps one task per key and
// submitter: the same request is answered with the first task and holds, records and tells nothing again; the
// same key with another request is refused. Every request goes through HTTP. The first app has NO duplicate
// guard in front, so what is proved is what the database does alone; the second has the guard, as production,
// on real Redis when the spec run has one (TEST_REDIS_URL) and on its memory store otherwise.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PRICE = 3500;
const KEY = Buffer.alloc(32, 77).toString('base64');

suite('one activation task per request key (PostgreSQL)', () => {
  jest.setTimeout(90_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY, redis: process.env.REDIS_URL };
  const redisUrl = process.env.TEST_REDIS_URL;
  const tag = randomUUID().slice(0, 8);
  // owner (branch) > posA, posB
  const u = { owner: randomUUID(), posA: randomUUID(), posB: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let guarded: INestApplication;
  let guard: DuplicateGuardInterceptor;
  /** The guard's own store: Redis, or memory when the run has no Redis. */
  let real: WriteStore;
  let recorded: unknown[][];
  let cookie: Record<keyof typeof u, string>;
  /** A second session of posA: the guard is per session, so only the database stands between the two. */
  let otherSession = '';
  /** How many times a notice was written. Counted here and written nowhere: a real notice goes to every branch
   *  user in the database, the accounts of other spec files included. */
  let noticeWrites = 0;
  /** Every value the guard stored, as it was stored. */
  let kept: string[] = [];

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const key = () => `req-${randomUUID()}`;
  /** The manual route: the simulated provider refuses, so a task is opened. */
  const body = (over: Record<string, unknown> = {}) => ({ packageCode: `rk-${tag}`, posLoginName: `rk-${tag}-posa`, outcome: 'fail', ...over });
  const post = (who: keyof typeof u | { cookie: string }, sent: Record<string, unknown>, requestKey?: string, on: INestApplication = app) => {
    const call = request(on.getHttpServer()).post('/office/lines').set('Cookie', typeof who === 'string' ? cookie[who] : who.cookie);
    return (requestKey === undefined ? call : call.set('Idempotency-Key', requestKey)).send(sent);
  };
  const tasks = () => prisma.officeTask.findMany({ where: { posId: { in: [u.posA, u.posB] } }, orderBy: { createdAt: 'asc' } });
  const wallet = (id = u.posA) => prisma.wallet.findUniqueOrThrow({ where: { userId: id } });
  const holds = () => prisma.walletEntry.count({ where: { userId: u.posA, kind: 'hold' } });
  const entries = () => prisma.walletEntry.count({ where: { userId: { in: Object.values(u) } } });
  const operations = () => prisma.providerOperation.count({ where: { providerId: ids.provider } });
  /** The activations on record: one per request that did something or was refused, none for a repeat. */
  const activations = () => recorded.filter(([, , draft]) => (draft as { action: string }).action === 'activate').map(([, , , result, reason]) => `${String(result)} ${String(reason)}`.trim());
  const summary = (responses: { status: number; body: { taskId?: string; code?: string } }[]) => ({
    statuses: responses.map((response) => (response.status === 201 ? '201' : `${response.status} ${response.body.code}`)).sort(),
    taskIds: [...new Set(responses.filter((response) => response.status === 201).map((response) => response.body.taskId))],
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null, isBranchOwner = false) => ({ id, loginName: `rk-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner });
    for (const account of [row(u.owner, 'owner', 'branch', null, true), row(u.posA, 'posa', 'pos', u.owner), row(u.posB, 'posb', 'pos', u.owner)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: 1_000_000, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    cookie = {} as typeof cookie;
    for (const [name, id] of Object.entries(u)) cookie[name as keyof typeof u] = `sid=${await auth.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' })}`;
    otherSession = `sid=${await auth.saveSession({ userId: u.posA, scope: 'full', userAgent: '', ip: '' })}`;
    await prisma.provider.create({ data: { id: ids.provider, code: `rk-${tag}`, name: 'rk' } });
    await prisma.company.create({ data: { id: ids.company, code: `rk-${tag}`, name: 'rk' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: PRICE, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    await prisma.package.create({ data: { id: ids.pkg, code: `rk-${tag}`, name: 'rk', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const notice = { write: async () => { noticeWrites += 1; return []; }, publish: async () => undefined } as unknown as NoticeService;
    ({ app, recorded } = await officeTestApp(auth, prisma as unknown as Record<string, unknown>, notice));
    // The guard reads REDIS_URL when it is made.
    if (redisUrl) process.env.REDIS_URL = redisUrl;
    else delete process.env.REDIS_URL;
    guard = new DuplicateGuardInterceptor();
    real = guard.store;
    ({ app: guarded } = await officeTestApp(auth, prisma as unknown as Record<string, unknown>, notice, [guard]));
  });

  beforeEach(() => {
    recorded.length = 0;
    noticeWrites = 0;
    process.env.SECRETS_KEY = KEY;
    kept = [];
    guard.store = { ...real, save: (name, value, seconds) => { kept.push(value); return real.save(name, value, seconds); } };
  });

  afterEach(async () => {
    // Each test starts from no tasks, no lines, nothing held and full wallets.
    await prisma.walletEntry.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.officeTask.deleteMany({ where: { posId: { in: [u.posA, u.posB] } } });
    await prisma.line.deleteMany({ where: { posId: { in: [u.posA, u.posB] } } });
    await prisma.wallet.updateMany({ where: { userId: { in: Object.values(u) } }, data: { balance: 1_000_000, held: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    await app.close();
    await guarded.close();
    await guard.onModuleDestroy();
    if (before.redis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = before.redis;
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: Object.values(u) } } });
    for (const id of [u.posA, u.posB, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
  });

  it('answers the same key and body with the first task: one task, one hold, one record, nothing told twice', async () => {
    const requestKey = key();
    const sent = body({ iccid: serial() });
    const first = await post('posA', sent, requestKey);
    expect([first.status, first.body.applied, first.headers['idempotent-replay']]).toEqual([201, false, undefined]);
    const after = { entries: await entries(), notices: noticeWrites, operations: await operations() };
    expect(after.notices).toBeGreaterThan(0);

    const again = await post('posA', sent, requestKey);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replay']).toBe('true');

    const rows = await tasks();
    expect(rows).toMatchObject([{ id: first.body.taskId, status: 'working', submitterId: u.posA, held: PRICE, posDelta: -PRICE, unitPrice: PRICE }]);
    // What is stored is the SHA-256 of the submitter and the key, never the key itself, and the fingerprint of the body.
    expect(rows[0].requestKey).toBe(createHash('sha256').update(`${u.posA}:${requestKey}`).digest('hex'));
    expect(rows[0].requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });
    expect(await holds()).toBe(1);
    expect({ entries: await entries(), notices: noticeWrites, operations: await operations() }).toEqual(after);
    expect(activations()).toEqual(['ok']);
  });

  it('opens one task and holds once when ten requests carry one key and one serial at the same moment', async () => {
    const requestKey = key();
    const sent = body({ iccid: serial() });
    const result = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey))));
    expect(result.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
    expect(result.taskIds).toHaveLength(1);
    expect(await tasks()).toMatchObject([{ id: result.taskIds[0], held: PRICE }]);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });
    expect(await holds()).toBe(1);
    expect(await operations()).toBe(0);
    expect(activations()).toEqual(['ok']);
  });

  it('does the same with nothing to wait on but the key: ten eSIM requests with no serial, each given another number', async () => {
    const requestKey = key();
    const sent = body({ esim: true });
    const result = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey))));
    expect(result.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
    expect(result.taskIds).toHaveLength(1);
    expect(await tasks()).toHaveLength(1);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: (await tasks())[0].held });
    expect(await holds()).toBe(1);
    expect(activations()).toEqual(['ok']);
  });

  it('refuses the key with another body and leaves the first task as it was', async () => {
    const requestKey = key();
    const sent = body({ iccid: serial() });
    const first = await post('posA', sent, requestKey);
    for (const other of [body({ iccid: serial() }), { ...sent, esim: true }, { ...sent, currentDetails: 'x' }, { ...sent, posLoginName: `rk-${tag}-posb` }]) {
      const refused = await post('posA', other, requestKey);
      expect([refused.status, refused.body.code]).toEqual([400, 'INVALID']);
      expect(JSON.stringify(refused.body)).not.toContain(first.body.taskId);
    }
    expect(await tasks()).toMatchObject([{ id: first.body.taskId, held: PRICE }]);
    expect(await wallet()).toMatchObject({ held: PRICE });
    expect(await holds()).toBe(1);
    expect(activations()).toEqual(['ok', 'fail INVALID', 'fail INVALID', 'fail INVALID', 'fail INVALID']);
  });

  it('lets one of ten different requests under one key through and refuses the rest', async () => {
    const requestKey = key();
    const result = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', body({ iccid: serial() }), requestKey))));
    expect(result.statuses).toEqual(['201', ...Array.from({ length: 9 }, () => '400 INVALID')]);
    expect(await tasks()).toHaveLength(1);
    expect(await holds()).toBe(1);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: PRICE });
  });

  it('keeps a key to its account: the same text from another account opens that account’s own task, never the first one', async () => {
    const requestKey = key();
    const sent = body({ esim: true });
    const first = await post('posA', sent, requestKey);
    // The branch owner may activate for the same point of sale: the same body and the same key text.
    const byOwner = await post('owner', sent, requestKey);
    expect([byOwner.status, byOwner.headers['idempotent-replay']]).toEqual([201, undefined]);
    expect(byOwner.body.taskId).not.toBe(first.body.taskId);
    // Another point of sale sending the first one's key and body is judged on its own rights, not answered with the first task.
    const reaching = await post('posB', sent, requestKey);
    expect([reaching.status, reaching.body.code]).toEqual([403, 'FORBIDDEN']);
    expect(JSON.stringify(reaching.body)).not.toContain(first.body.taskId);
    // With a body of its own, the same key text opens its own task.
    const byOther = await post('posB', body({ esim: true, posLoginName: `rk-${tag}-posb` }), requestKey);
    expect(byOther.status).toBe(201);
    expect(byOther.body.taskId).not.toBe(first.body.taskId);
    const rows = await tasks();
    expect(rows.map((row) => row.submitterId).sort()).toEqual([u.owner, u.posA, u.posB].sort());
    expect(new Set(rows.map((row) => row.requestKey)).size).toBe(3);
  });

  it('answers a repeat with the first task after that task was closed, and holds nothing again', async () => {
    const requestKey = key();
    const sent = body({ iccid: serial() });
    const first = await post('posA', sent, requestKey);
    const cancelled = await request(app.getHttpServer()).post(`/office/tasks/${first.body.taskId}/cancel`).set('Cookie', cookie.posA).send({});
    expect(cancelled.status).toBe(201);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 0 });
    const again = await post('posA', sent, requestKey);
    expect([again.status, again.body, again.headers['idempotent-replay']]).toEqual([201, first.body, 'true']);
    expect(await tasks()).toMatchObject([{ id: first.body.taskId, status: 'cancelled' }]);
    expect(await wallet()).toMatchObject({ balance: 1_000_000, held: 0 });
    expect(await holds()).toBe(1);
    // The same sale is made again only with a new key.
    const anew = await post('posA', sent, key());
    expect(anew.status).toBe(201);
    expect(anew.body.taskId).not.toBe(first.body.taskId);
  });

  it('leaves nothing behind when the request fails, so the same key can be sent again', async () => {
    const requestKey = key();
    const sent = body({ iccid: serial() });
    await prisma.wallet.update({ where: { userId: u.posA }, data: { balance: 0 } });
    const refused = await post('posA', sent, requestKey);
    expect([refused.status, refused.body.code]).toEqual([400, 'BALANCE_CEILING']);
    expect(await tasks()).toEqual([]);
    expect(await entries()).toBe(0);
    await prisma.wallet.update({ where: { userId: u.posA }, data: { balance: 1_000_000 } });
    const retried = await post('posA', sent, requestKey);
    expect([retried.status, retried.headers['idempotent-replay']]).toEqual([201, undefined]);
    expect(await tasks()).toMatchObject([{ id: retried.body.taskId, held: PRICE }]);
    expect(await holds()).toBe(1);
  });

  it('refuses a malformed key before anything is written, and treats an empty one as none', async () => {
    const sent = body({ esim: true });
    for (const bad of ['short', 'has space in it', 'x'.repeat(121), 'semi;colon;key', 'slash/slash/key']) {
      const refused = await post('posA', sent, bad);
      expect([refused.status, refused.body.code]).toEqual([400, 'INVALID']);
    }
    expect(await tasks()).toEqual([]);
    expect(await entries()).toBe(0);
    const none = await post('posA', sent, '');
    expect(none.status).toBe(201);
    expect(await tasks()).toMatchObject([{ id: none.body.taskId, requestKey: null, requestHash: null }]);
  });

  it('leaves the manual route without a key as it was: each request is its own task', async () => {
    const sent = body({ esim: true });
    const first = await post('posA', sent);
    const second = await post('posA', sent);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.taskId).not.toBe(first.body.taskId);
    const rows = await tasks();
    expect(rows.map((row) => [row.requestKey, row.requestHash])).toEqual([[null, null], [null, null]]);
    expect(await holds()).toBe(2);
    // A taken serial is still refused as before, with or without a key.
    const iccid = serial();
    expect((await post('posA', body({ iccid }))).status).toBe(201);
    const taken = await post('posA', body({ iccid }), key());
    expect([taken.status, taken.body.code]).toEqual([409, 'SIM_TAKEN']);
  });

  describe('with the duplicate guard in front, as in production', () => {
    /** Every key and value the guard holds in Redis, with what it was asked to save. */
    const stored = async () => {
      if (!redisUrl) return kept.join('\n');
      const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
      try {
        const names = await redis.keys('write:*');
        return [...names, ...(await Promise.all(names.map((name) => redis.get(name)))), ...kept].join('\n');
      } finally {
        redis.disconnect();
      }
    };
    const fragments = (text: string) => Array.from({ length: 12 }, (_, at) => text.slice(40 + at * 97, 40 + at * 97 + 24)).filter((part) => part.length === 24);

    it('one session, ten at once: every one is answered with the one task, none is refused, and one task holds once', async () => {
      for (const sent of [body({ iccid: serial() }), body({ esim: true })]) {
        const requestKey = key();
        const responses = await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey, guarded)));
        const result = summary(responses);
        expect(result.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
        expect(result.taskIds).toHaveLength(1);
        expect(new Set(responses.map((response) => JSON.stringify(response.body))).size).toBe(1);
        expect(await prisma.officeTask.count({ where: { id: result.taskIds[0] } })).toBe(1);
        // Afterwards the guard answers it, and so does the database for a session the guard has never seen.
        const fromGuard = await post('posA', sent, requestKey, guarded);
        const fromDatabase = await post({ cookie: otherSession }, sent, requestKey, guarded);
        expect([fromGuard.status, fromGuard.body.taskId, fromGuard.headers['idempotent-replay']]).toEqual([201, result.taskIds[0], 'true']);
        expect([fromDatabase.status, fromDatabase.body.taskId, fromDatabase.headers['idempotent-replay']]).toEqual([201, result.taskIds[0], 'true']);
      }
      expect(await tasks()).toHaveLength(2);
      expect(await holds()).toBe(2);
      expect(await wallet()).toMatchObject({ balance: 1_000_000, held: (await tasks()).reduce((sum, row) => sum + (row.held ?? 0), 0) });
      expect(await entries()).toBe(2);
      expect(await operations()).toBe(0);
    });

    it('two sessions of one account at once, which the guard cannot tell apart from two people: still one task, no refusal', async () => {
      const requestKey = key();
      const sent = body({ esim: true });
      const calls = Array.from({ length: 10 }, (_, at) => post(at % 2 ? 'posA' : { cookie: otherSession }, sent, requestKey, guarded));
      const result = summary(await Promise.all(calls));
      expect(result.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
      expect(result.taskIds).toHaveLength(1);
      expect(await tasks()).toHaveLength(1);
      expect(await holds()).toBe(1);
    });

    it('refuses the key with another body: ten at once after the first, and ten different ones together', async () => {
      const requestKey = key();
      const sent = body({ iccid: serial() });
      const first = await post('posA', sent, requestKey, guarded);
      expect(first.status).toBe(201);
      const others = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', body({ iccid: serial() }), requestKey, guarded))));
      expect(others.statuses).toEqual(Array.from({ length: 10 }, () => '400 INVALID'));
      const together = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', body({ iccid: serial() }), `${requestKey}-b`, guarded))));
      expect(together.statuses).toEqual(['201', ...Array.from({ length: 9 }, () => '400 INVALID')]);
      expect(await tasks()).toHaveLength(2);
      expect(await holds()).toBe(2);
    });

    it('lets the same key through again after a request that failed', async () => {
      const requestKey = key();
      const sent = body({ iccid: serial() });
      await prisma.wallet.update({ where: { userId: u.posA }, data: { balance: 0 } });
      const refused = summary(await Promise.all(Array.from({ length: 5 }, () => post('posA', sent, requestKey, guarded))));
      expect(refused.statuses).toEqual(Array.from({ length: 5 }, () => '400 BALANCE_CEILING'));
      expect(await tasks()).toEqual([]);
      await prisma.wallet.update({ where: { userId: u.posA }, data: { balance: 1_000_000 } });
      const retried = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey, guarded))));
      expect(retried.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
      expect(retried.taskIds).toHaveLength(1);
      expect(await holds()).toBe(1);
    });

    it('still decides in the database when the guard’s store is down', async () => {
      const down = async () => { throw new Error('redis is down'); };
      guard.store = { claim: down, save: down, drop: down };
      const requestKey = key();
      const sent = body({ iccid: serial() });
      const result = summary(await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey, guarded))));
      expect(result.statuses).toEqual(Array.from({ length: 10 }, () => '201'));
      expect(result.taskIds).toHaveLength(1);
      expect(await tasks()).toHaveLength(1);
      expect(await holds()).toBe(1);
    });

    it('an activation made at once: ten at once make one line, the eSIM code is nowhere in Redis or the output in the clear, and neither is the key', async () => {
      const requestKey = key();
      const sent = body({ esim: true, outcome: 'success' });
      let responses: request.Response[] = [];
      const output = await capturedOutput(async () => {
        responses = await Promise.all(Array.from({ length: 10 }, () => post('posA', sent, requestKey, guarded)));
      });
      expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 10 }, () => 201));
      expect(new Set(responses.map((response) => JSON.stringify(response.body))).size).toBe(1);
      expect(responses.filter((response) => response.headers['idempotent-replay'] === 'true')).toHaveLength(9);
      const code: string = responses[0].body.line.esimQr;
      expect(code).toMatch(/^data:image\/png;base64,/);
      expect(await prisma.line.count({ where: { posId: u.posA } })).toBe(1);
      expect(await entries()).toBe(1);
      expect(kept).toHaveLength(1);
      expect(kept[0].startsWith('v1:')).toBe(true);
      const everything = await stored();
      const parts = fragments(code);
      expect(parts.length).toBeGreaterThan(5);
      for (const part of parts) {
        expect(everything).not.toContain(part);
        expect(output).not.toContain(part);
      }
      expect(everything).not.toContain(requestKey);
      expect(output).not.toContain(requestKey);
      // The same without a key of the client's: the guard's ten-second copy is sealed too.
      const unkeyed = await post('posA', body({ esim: true, outcome: 'success' }), undefined, guarded);
      expect(unkeyed.status).toBe(201);
      expect(kept[1].startsWith('v1:')).toBe(true);
      for (const part of fragments(unkeyed.body.line.esimQr)) expect(await stored()).not.toContain(part);
      // No task was opened, so no key is stored: on this route the repeat is the guard's to stop (D13: simulation only).
      expect(await tasks()).toEqual([]);
    });

    it('does not activate a second time when the kept answer cannot be read back', async () => {
      const requestKey = key();
      const sent = body({ esim: true, outcome: 'success' });
      expect((await post('posA', sent, requestKey, guarded)).status).toBe(201);
      // The sealing key is gone, then another one: the sealed copy does not open.
      delete process.env.SECRETS_KEY;
      const none = await post('posA', sent, requestKey, guarded);
      process.env.SECRETS_KEY = Buffer.alloc(32, 78).toString('base64');
      const other = summary(await Promise.all(Array.from({ length: 5 }, () => post('posA', sent, requestKey, guarded))));
      expect([none.status, none.body.code]).toEqual([409, 'DUPLICATE_REQUEST']);
      expect(other.statuses).toEqual(Array.from({ length: 5 }, () => '409 DUPLICATE_REQUEST'));
      expect(await prisma.line.count({ where: { posId: u.posA } })).toBe(1);
      expect(await entries()).toBe(1);
    });

    it('a task’s answer carries no code and is replayed with or without a sealing key', async () => {
      delete process.env.SECRETS_KEY;
      const requestKey = key();
      const sent = body({ iccid: serial() });
      const first = await post('posA', sent, requestKey, guarded);
      const again = await post('posA', sent, requestKey, guarded);
      expect([first.status, again.status, again.headers['idempotent-replay']]).toEqual([201, 201, 'true']);
      expect(again.body).toEqual(first.body);
      expect(kept).toEqual([JSON.stringify(first.body)]);
      expect(await tasks()).toHaveLength(1);
    });
  });
});
