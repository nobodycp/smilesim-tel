import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import IORedis from 'ioredis';
import request from 'supertest';
import { createPrismaClient } from '../../../db';
import { hashSessionToken } from '../../auth/session-token';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { seal } from '../../shared/secret-box';
import { capturedOutput } from '../../shared/testing/captured-output';
import { ActivityRecorder } from '../activity/activity-recorder';
import { officeTestApp } from '../testing/office-test-app';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; spec items 23 and 24; plan slice S.5c (API step):
//   - a list never carries an eSIM code;
//   - the detail of a line or a task hands it to the line's point of sale, the accounts above it on its own path
//     and the branch, and to nobody else;
//   - each time a code leaves, the read is on record first (`esim_read`): who, which line or task, when, from
//     where; never the code;
//   - nothing of a code is in the process output, the activity log, the notices, the outbox or the queue.
// Every request goes through HTTP, as a browser's would.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 61).toString('base64');
const CODE = {
  sealed: 'data:image/png;base64,QUNDRVNTLVNFQUxFRC1DT0RFLU9ORS1YWFhY',
  clear: 'data:image/png;base64,QUNDRVNTLUNMRUFSLUNPREUtVFdPLVlZWVk=',
  task: 'data:image/png;base64,QUNDRVNTLVRBU0stQ09ERS1USFJFRS1aWlpa',
};

suite('who is handed an eSIM code, and the record of it (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  const tag = randomUUID().slice(0, 8);
  // owner (branch) > main > agent > posA, posB ;  owner > agent2 > posC
  const u = { owner: randomUUID(), staff: randomUUID(), main: randomUUID(), agent: randomUUID(), posA: randomUUID(), posB: randomUUID(), agent2: randomUUID(), posC: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const line = { sealed: randomUUID(), clear: randomUUID(), none: randomUUID(), damaged: randomUUID() };
  const task = { own: randomUUID(), onLine: randomUUID(), movedSubmitter: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let recorded: unknown[][];
  let cookie: Record<keyof typeof u, string>;
  let sealedCode = '';
  let damaged = '';

  const get = (who: keyof typeof u, path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie[who]);
  const events = () => recorded.map(([, ip, draft, result]) => ({ ...(draft as object), result, ip: typeof ip }));
  /** No part of any code, clear or sealed, longer than a few characters. */
  const expectNoCode = (text: string, extra: string[] = []) => {
    for (const whole of [...Object.values(CODE), sealedCode, damaged, ...extra]) {
      const payload = whole.startsWith('data:') ? whole.slice(whole.indexOf(',') + 1) : whole.slice(3);
      for (let start = 0; start + 12 <= payload.length; start += 6) expect(text).not.toContain(payload.slice(start, start + 12));
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    sealedCode = seal(CODE.sealed);
    damaged = `${seal('data:image/png;base64,REFNQUdFRC1BQ0NFU1MtQ09ERQ==').slice(0, -4)}AAAA`;
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null, isBranchOwner = false) => ({ id, loginName: `acc-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner });
    const rows = [
      row(u.owner, 'owner', 'branch', null, true), row(u.staff, 'staff', 'branch', u.owner), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main),
      row(u.posA, 'posa', 'pos', u.agent), row(u.posB, 'posb', 'pos', u.agent), row(u.agent2, 'agent2', 'agent', u.owner), row(u.posC, 'posc', 'pos', u.agent2),
    ];
    for (const account of rows) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: 100_000, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    cookie = {} as typeof cookie;
    for (const [name, id] of Object.entries(u)) cookie[name as keyof typeof u] = `sid=${await auth.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' })}`;
    await prisma.provider.create({ data: { id: ids.provider, code: `acc-${tag}`, name: 'acc' } });
    await prisma.company.create({ data: { id: ids.company, code: `acc-${tag}`, name: 'acc' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoSim: true };
    await prisma.package.create({ data: { id: ids.pkg, code: `acc-${tag}`, name: 'acc', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
    const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
    const lineRow = (id: string, esimQr: string | null) => ({ id, msisdn: number(), iccid: serial(), esim: true, esimQr, status: 'active', packageId: ids.pkg, posId: u.posA, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} });
    await prisma.line.createMany({ data: [lineRow(line.sealed, sealedCode), lineRow(line.clear, CODE.clear), lineRow(line.none, null), lineRow(line.damaged, damaged)] });
    const taskRow = (id: string, over: Record<string, unknown>) => ({ id, action: 'activate', status: 'working', posId: u.posA, packageId: ids.pkg, submitterId: u.posA, posDelta: 0, esim: true, ...over });
    await prisma.officeTask.createMany({
      data: [
        taskRow(task.own, { esimQr: seal(CODE.task), msisdn: number() }),
        taskRow(task.onLine, { action: 'freeze', lineId: line.sealed }),
        // Opened by an account that is no longer above the point of sale (the point of sale was moved since).
        taskRow(task.movedSubmitter, { action: 'freeze', lineId: line.clear, submitterId: u.agent2 }),
      ],
    });
    ({ app, recorded } = await officeTestApp(auth, prisma as unknown as Record<string, unknown>));
  });

  beforeEach(() => {
    recorded.length = 0;
    process.env.SECRETS_KEY = KEY;
  });

  afterAll(async () => {
    await app.close();
    await prisma.activityEvent.deleteMany({ where: { actorLoginName: { startsWith: `acc-${tag}-` } } });
    await prisma.session.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.officeTask.deleteMany({ where: { posId: { in: Object.values(u) } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.line.deleteMany({ where: { posId: { in: Object.values(u) } } });
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: Object.values(u) } } });
    for (const id of [u.posA, u.posB, u.posC, u.agent, u.agent2, u.main, u.staff, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
  });

  it('no list carries a code: the numbers list under every filter and for every layer, the task list, and neither writes an event', async () => {
    const paths = [
      '/office/lines', '/office/lines?sim=esim', '/office/lines?status=active', `/office/lines?loginName=acc-${tag}-posa`, '/office/lines?q=05',
      '/office/tasks', '/office/tasks?status=working',
    ];
    for (const who of ['posA', 'agent', 'main', 'owner', 'staff'] as const) {
      for (const path of paths) {
        const response = await get(who, path);
        expect([who, path, response.status]).toEqual([who, path, 200]);
        expect(response.body.items.some((item: object) => 'esimQr' in item)).toBe(false);
        expectNoCode(JSON.stringify(response.body));
      }
    }
    const mine = await get('posA', '/office/lines?sim=esim');
    // The rows are all there, with everything else a row has: only the code is gone.
    expect(mine.body.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(Object.values(line)));
    expect(mine.body.items[0]).toMatchObject({ esim: true, status: 'active', packageName: 'acc' });
    expect(typeof mine.body.total).toBe('number');
    expect(events()).toEqual([]);
  });

  it('the line detail hands the code to its point of sale, the accounts above it on its path and the branch', async () => {
    for (const who of ['posA', 'agent', 'main', 'owner', 'staff'] as const) {
      const sealedRead = await get(who, `/office/lines/${line.sealed}`);
      expect([who, sealedRead.status, sealedRead.body.line?.esimQr]).toEqual([who, 200, CODE.sealed]);
      const clearRead = await get(who, `/office/lines/${line.clear}`);
      expect([who, clearRead.status, clearRead.body.line?.esimQr]).toEqual([who, 200, CODE.clear]);
    }
  });

  it('a sibling point of sale, another agent and a point of sale of another branch of the tree get nothing: not the code, not the line', async () => {
    for (const who of ['posB', 'agent2', 'posC'] as const) {
      for (const id of [line.sealed, line.clear]) {
        const response = await get(who, `/office/lines/${id}`);
        expect([who, response.status, response.body.code]).toEqual([who, 404, 'NOT_FOUND']);
        expectNoCode(JSON.stringify(response.body));
      }
      expect([who, (await get(who, `/office/tasks/${task.own}`)).status]).toEqual([who, 404]);
    }
    expect(events()).toEqual([]);
  });

  it('a task\'s detail follows the same rule; an account that only opened the task, and is not above the point of sale, reads the task without its code', async () => {
    for (const who of ['posA', 'agent', 'main', 'owner'] as const) {
      expect([who, (await get(who, `/office/tasks/${task.own}`)).body.task?.esimQr]).toEqual([who, CODE.task]);
      expect([who, (await get(who, `/office/tasks/${task.onLine}`)).body.task?.esimQr]).toEqual([who, CODE.sealed]);
    }
    recorded.length = 0;
    const moved = await get('agent2', `/office/tasks/${task.movedSubmitter}`);
    expect(moved.status).toBe(200);
    // It still sees the task it opened, with the serial and the kind, and no code.
    expect(moved.body.task).toMatchObject({ id: task.movedSubmitter, esim: true, esimQr: null });
    expect(typeof moved.body.task.iccid).toBe('string');
    expectNoCode(JSON.stringify(moved.body));
    expect(events()).toEqual([]);
    // The same task, read by an account that is on the path, carries the code and is recorded.
    expect((await get('agent', `/office/tasks/${task.movedSubmitter}`)).body.task.esimQr).toBe(CODE.clear);
    expect(events()).toEqual([{ action: 'esim_read', subjectKind: 'task', subjectRef: task.movedSubmitter, result: 'ok', ip: 'string' }]);
  });

  it('each time a code leaves there is one event naming the line or the task, and none when no code leaves', async () => {
    await get('posA', `/office/lines/${line.sealed}`);
    await get('agent', `/office/lines/${line.sealed}`);
    await get('owner', `/office/tasks/${task.own}`);
    expect(events()).toEqual([
      { action: 'esim_read', subjectKind: 'line', subjectRef: line.sealed, result: 'ok', ip: 'string' },
      { action: 'esim_read', subjectKind: 'line', subjectRef: line.sealed, result: 'ok', ip: 'string' },
      { action: 'esim_read', subjectKind: 'task', subjectRef: task.own, result: 'ok', ip: 'string' },
    ]);
    // The session each event is recorded under is the caller's own.
    expect(recorded.map(([gate]) => (gate as { sessionId: string }).sessionId)).toEqual([cookie.posA, cookie.agent, cookie.owner].map((value) => value.slice(4)));
    expectNoCode(JSON.stringify(recorded));

    recorded.length = 0;
    expect((await get('posA', `/office/lines/${line.none}`)).body.line.esimQr).toBeNull();
    expect((await get('posB', `/office/lines/${line.sealed}`)).status).toBe(404);
    expect((await get('posA', `/office/lines/${randomUUID()}`)).status).toBe(404);
    let refused = 0;
    const output = await capturedOutput(async () => {
      refused = (await get('posA', `/office/lines/${line.damaged}`)).status;
    });
    expect(refused).toBe(500);
    expectNoCode(output);
    // No code left in any of these: nothing is recorded as a read.
    expect(events()).toEqual([]);
  });

  it('when the read cannot be recorded, the code is not answered', async () => {
    const recorder = app.get(ActivityRecorder) as unknown as { recordOfficeOrFail: (...args: unknown[]) => Promise<void> };
    const real = recorder.recordOfficeOrFail;
    recorder.recordOfficeOrFail = async () => {
      throw new Error('the activity log is down');
    };
    try {
      let status = 0;
      let body = '';
      const output = await capturedOutput(async () => {
        const response = await get('posA', `/office/lines/${line.sealed}`);
        status = response.status;
        body = JSON.stringify(response.body);
        const viaTask = await get('posA', `/office/tasks/${task.own}`);
        status = Math.min(status, viaTask.status);
        body += JSON.stringify(viaTask.body);
      });
      expect(status).toBe(500);
      expect(body).toContain('SERVER_ERROR');
      expectNoCode(body);
      expectNoCode(output);
      // A read that hands over no code needs no record and still answers.
      expect((await get('posA', `/office/lines/${line.none}`)).status).toBe(200);
    } finally {
      recorder.recordOfficeOrFail = real;
    }
  });

  it('the event as it is stored: who, on which number, when, from where, and nothing of the code', async () => {
    const token = `tok-${randomUUID()}`;
    await prisma.session.create({ data: { id: randomUUID(), tokenHash: hashSessionToken(token), userId: u.posA, userAgent: 'spec', ip: '203.0.113.9', scope: 'full', kind: 'account', expiresAt: new Date(Date.now() + 3_600_000) } });
    const recorder = new ActivityRecorder({ client: prisma, available: true } as never);
    const startedAt = new Date(Date.now() - 1000);
    await recorder.recordOfficeOrFail({ sessionId: token }, '203.0.113.9', { action: 'esim_read', subjectKind: 'line', subjectRef: line.sealed });
    await recorder.recordOfficeOrFail({ sessionId: token }, '203.0.113.9', { action: 'esim_read', subjectKind: 'task', subjectRef: task.own });
    const stored = await prisma.activityEvent.findMany({ where: { actorId: u.posA, action: 'esim_read' }, orderBy: { at: 'asc' } });
    const number = (await prisma.line.findUniqueOrThrow({ where: { id: line.sealed } })).msisdn;
    expect(stored.map((event) => [event.actorLoginName, event.actorLayer, event.action, event.result, event.subjectKind, event.subjectRef, event.ip])).toEqual([
      [`acc-${tag}-posa`, 'pos', 'esim_read', 'ok', 'line', number, '203.0.113.9'],
      [`acc-${tag}-posa`, 'pos', 'esim_read', 'ok', 'task', task.own, '203.0.113.9'],
    ]);
    for (const event of stored) expect(event.at.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    expectNoCode(JSON.stringify(stored));
    // It moved no money and changed neither the line nor the task.
    expect(await prisma.walletEntry.count({ where: { userId: u.posA } })).toBe(0);
    expect((await prisma.line.findUniqueOrThrow({ where: { id: line.sealed } })).esimQr).toBe(sealedCode);
    // The strict recorder does not swallow a failure.
    await expect(new ActivityRecorder({ client: { session: prisma.session, line: prisma.line, activityEvent: { create: async () => { throw new Error('down'); } } }, available: true } as never).recordOfficeOrFail({ sessionId: token }, '', { action: 'esim_read', subjectKind: 'line', subjectRef: line.sealed })).rejects.toThrow('down');
  });

  it('an activation that returns a code leaves no part of it in the output, the activity log, the notices, the outbox or the queue', async () => {
    let issued = '';
    let lineId = '';
    const output = await capturedOutput(async () => {
      const response = await request(app.getHttpServer()).post('/office/lines').set('Cookie', cookie.owner)
        .send({ packageCode: `acc-${tag}`, posLoginName: `acc-${tag}-posa`, esim: true, outcome: 'success' });
      expect([response.status, response.body.applied]).toEqual([201, true]);
      issued = response.body.line.esimQr;
      lineId = response.body.line.id;
    });
    expect(issued).toMatch(/^data:image\/png;base64,/);
    const stored = (await prisma.line.findUniqueOrThrow({ where: { id: lineId } })).esimQr ?? '';
    expect(stored.startsWith('v1:')).toBe(true);
    // Sample the issued picture and its sealed form at many places; neither appears anywhere it should not.
    const fragments = (text: string) => Array.from({ length: 12 }, (_, at) => text.slice(60 + at * 97, 60 + at * 97 + 24)).filter((part) => part.length === 24);
    const parts = [...fragments(issued), ...fragments(stored)];
    const holds = (text: string) => parts.some((part) => text.includes(part));
    expect(parts.length).toBeGreaterThan(10);
    expect(holds(output)).toBe(false);
    expect(holds(JSON.stringify(recorded))).toBe(false);
    const dump = async (rows: Promise<unknown[]>) => JSON.stringify(await rows);
    expect(holds(await dump(prisma.activityEvent.findMany({ where: { at: { gte: new Date(Date.now() - 60_000) } } })))).toBe(false);
    expect(holds(await dump(prisma.notice.findMany({ where: { userId: { in: Object.values(u) } } })))).toBe(false);
    expect(holds(await dump(prisma.outboxMessage.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } })))).toBe(false);
    expect(holds(await dump(prisma.providerOperation.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } })))).toBe(false);
    expect(holds(await dump(prisma.walletEntry.findMany({ where: { lineId } })))).toBe(false);
    // The queue (Redis), when the spec run has one: no key and no value carries it.
    if (process.env.TEST_REDIS_URL) {
      const redis = new IORedis(process.env.TEST_REDIS_URL, { maxRetriesPerRequest: 1 });
      try {
        const keys = await redis.keys('*');
        let everything = keys.join('\n');
        for (const key of keys.slice(0, 500)) {
          const kind = await redis.type(key);
          if (kind === 'string') everything += (await redis.get(key)) ?? '';
          else if (kind === 'hash') everything += JSON.stringify(await redis.hgetall(key));
          else if (kind === 'list') everything += JSON.stringify(await redis.lrange(key, 0, -1));
          else if (kind === 'zset') everything += JSON.stringify(await redis.zrange(key, '0', '-1'));
          else if (kind === 'set') everything += JSON.stringify(await redis.smembers(key));
        }
        expect(holds(everything)).toBe(false);
      } finally {
        redis.disconnect();
      }
    }
    // The list still does not carry it, and the detail does, with its record.
    recorded.length = 0;
    expect(holds(JSON.stringify((await get('owner', '/office/lines?sim=esim')).body))).toBe(false);
    expect((await get('posA', `/office/lines/${lineId}`)).body.line.esimQr).toBe(issued);
    expect(events()).toEqual([{ action: 'esim_read', subjectKind: 'line', subjectRef: lineId, result: 'ok', ip: 'string' }]);
  });
});
