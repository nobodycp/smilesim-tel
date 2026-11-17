import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createPrismaClient } from '../../db';
import { hashSessionToken } from '../auth/session-token';
import { ActorResolver } from '../access/actor-resolver';
import type { Actor } from '../access/types';
import { PrismaActivityRecorder } from '../auditing/activity-recorder';
import { ActivityRecorder } from '../platform/activity';
import { API_PROVIDERS } from '../platform/api-providers';
import { fail } from '../platform/api-failure';
import { NOTICE_WRITER } from '../platform/notices';
import { UnitOfWork } from '../platform/unit-of-work';
import { PrismaService } from '../platform/prisma.service';
import { RequestLogController } from './request-log.controller';
import { RequestLogRepository } from './request-log.repository';
import { RequestLogService } from './request-log.service';
import { RequestLogWriter, type RequestLogDraft } from './request-log.writer';
import { leaked, probeApp, sendCrash, sendSecrets } from '../../request-log.fixture';

// The request log in PostgreSQL (system monitor M.1, M.2): what a request leaves in its row, the filters, the figures
// the database computes, and the clearing, which leaves the activity log and writes its own event there.
// PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one). Other spec files write and read these
// tables at the same time, so what is read here is held to this file's own day (a day of the years 2000–2009 picked
// by the run) or to its own request ids, and its app's clearing removes its own rows only (`OwnRowsRepository`).

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the request log in PostgreSQL: reading, the summary, the server errors and clearing', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ownerId = randomUUID();
  const posId = randomUUID();
  const ownerSid = `owner-${tag}`;
  const enteredSid = `entered-${tag}`;
  const login = (name: string) => `rl-${tag}-${name}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let service: RequestLogService;
  let writer: RequestLogWriter;
  let uow: UnitOfWork;

  const owner = (): Actor => ({ id: ownerId, loginName: login('owner'), nickname: 'owner', layer: 'branch', isBranchOwner: true, grants: [], operatorId: ownerId, impersonating: false });
  const entered = (): Actor => ({ id: posId, loginName: login('pos'), nickname: 'pos', layer: 'pos', isBranchOwner: false, grants: [], operatorId: ownerId, impersonating: true });
  // This file's own day, 08:00: every row it writes is on it, and every read is held to it.
  const day = new Date(Date.parse('2000-01-01T00:00:00.000Z') + (Number.parseInt(tag, 16) % 3650) * 86_400_000).toISOString().slice(0, 10);
  const base = Date.parse(`${day}T08:00:00.000Z`);
  const ownDay = { from: day, to: day };
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
  const dayWhere = { at: { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) } };
  const clearOwnDay = async () => {
    await prisma.requestLog.deleteMany({ where: dayWhere });
    await prisma.requestError.deleteMany({ where: dayWhere });
  };
  let serial = 0;
  /** One row as the writer would write it, `minutes` after 08:00. */
  const row = (minutes: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(), at: new Date(base + minutes * 60_000), durationMs: 10, method: 'GET', route: `/t-${tag}/a`, path: `/t-${tag}/a`, status: 200, code: '',
    actorId: null, actorLoginName: '', operatorId: null, layer: '', ip: '10.0.0.1', userAgent: '', requestId: `${tag}-${(serial += 1)}`, bytesIn: 0, bytesOut: 0, ...extra,
  });

  /**
   * The clearing as this file's app runs it: this file's rows only. The product's clearing empties both tables, and
   * other spec files keep rows in them at the same time (the alerts' rules read the request log): run here for real
   * it deleted their rows under them (seen 2026-11-17: `alerts.db.spec.ts` lost its requests mid-test and its
   * probing alert never opened). The real, whole-table statements are run in the last test of this file, inside a
   * transaction that is rolled back, where no other session ever sees them.
   */
  class OwnRowsRepository extends RequestLogRepository {
    override clear() {
      return prisma.$transaction(async (tx) => ({
        removed: (await tx.requestLog.deleteMany({ where: { requestId: { startsWith: `${tag}-` } } })).count,
        errorsRemoved: (await tx.requestError.deleteMany({ where: { requestId: { startsWith: `${tag}-` } } })).count,
      }));
    }

    override async clearErrors() {
      return (await prisma.requestError.deleteMany({ where: { requestId: { startsWith: `${tag}-` } } })).count;
    }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    await prisma.user.create({ data: { id: ownerId, loginName: login('owner'), nickname: 'owner', passwordHash: 'x', layer: 'branch', isBranchOwner: true } });
    await prisma.user.create({ data: { id: posId, loginName: login('pos'), nickname: 'pos', passwordHash: 'x', layer: 'pos', parentId: ownerId } });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await prisma.session.create({ data: { userId: ownerId, userAgent: '', ip: '', scope: 'full', kind: 'account', tokenHash: hashSessionToken(ownerSid), expiresAt } });
    await prisma.session.create({ data: { userId: posId, userAgent: '', ip: '', scope: 'full', kind: 'impersonation', operatorId: ownerId, tokenHash: hashSessionToken(enteredSid), expiresAt } });
    const actors = { actor: async (gate: { sessionId?: string }) => (gate.sessionId === ownerSid ? owner() : gate.sessionId === enteredSid ? entered() : fail(401, 'LOGIN_REQUIRED')) };
    const moduleRef = await Test.createTestingModule({
      controllers: [RequestLogController],
      providers: [
        RequestLogService, { provide: RequestLogRepository, useClass: OwnRowsRepository }, RequestLogWriter, UnitOfWork, PrismaService, ...API_PROVIDERS,
        { provide: NOTICE_WRITER, useValue: {} },
        { provide: ActorResolver, useValue: actors },
        { provide: ActivityRecorder, useClass: PrismaActivityRecorder },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = moduleRef.get(RequestLogService);
    writer = moduleRef.get(RequestLogWriter);
    uow = moduleRef.get(UnitOfWork);
    await clearOwnDay();
  });

  afterAll(async () => {
    await app.close();
    // The one client of the app (the unit of work's, the activity recorder's): closed even if a hook used it again.
    await uow.prisma.$disconnect();
    await clearOwnDay();
    await prisma.activityEvent.deleteMany({ where: { actorId: { in: [ownerId, posId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [ownerId, posId] } } });
    await prisma.user.deleteMany({ where: { id: posId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  beforeEach(async () => {
    await clearOwnDay();
  });

  const ids = async (query: Record<string, string>) => (await service.list(owner(), { ...ownDay, ...query })).items.map((item) => item.requestId).sort();

  it('filters by status class, exact status, code, route, account, address, duration and time', async () => {
    const rows = [
      row(1, { requestId: 'ok' }),
      row(2, { requestId: 'denied', status: 401, code: 'LOGIN_REQUIRED' }),
      row(3, { requestId: 'missing', status: 404, code: 'NOT_FOUND', route: '', path: `/t-${tag}/nowhere` }),
      row(4, { requestId: 'crash', status: 500, code: 'SERVER_ERROR', durationMs: 900 }),
      row(5, { requestId: 'pos', actorId: posId, actorLoginName: login('pos'), layer: 'pos' }),
      row(6, { requestId: 'entered', actorId: posId, actorLoginName: login('pos'), layer: 'pos', operatorId: ownerId }),
      row(7, { requestId: 'other-ip', ip: '10.0.0.2' }),
    ];
    await prisma.requestLog.createMany({ data: rows });
    expect(await ids({})).toEqual(['crash', 'denied', 'entered', 'missing', 'ok', 'other-ip', 'pos']);
    expect(await ids({ status: '4xx' })).toEqual(['denied', 'missing']);
    expect(await ids({ status: '404' })).toEqual(['missing']);
    expect(await ids({ status: '5xx' })).toEqual(['crash']);
    expect(await ids({ code: 'LOGIN_REQUIRED' })).toEqual(['denied']);
    expect(await ids({ route: `/t-${tag}/a` })).toEqual(['crash', 'denied', 'entered', 'ok', 'other-ip', 'pos']);
    // An account is found as itself and as the account that entered another.
    expect(await ids({ account: login('pos') })).toEqual(['entered', 'pos']);
    expect(await ids({ account: login('owner').toUpperCase() })).toEqual(['entered']);
    expect(await ids({ ip: '10.0.0.2' })).toEqual(['other-ip']);
    expect(await ids({ slowerThan: '500' })).toEqual(['crash']);
    expect(await ids({ from: at(3), to: at(5) })).toEqual(['crash', 'missing', 'pos']);
    expect(await ids({ status: '4xx', route: `/t-${tag}/a` })).toEqual(['denied']);
    // The requests no route matched, which an empty `route` cannot ask for.
    expect(await ids({ unmatched: '1' })).toEqual(['missing']);
    expect(await ids({ unmatched: '0' })).toEqual(['crash', 'denied', 'entered', 'missing', 'ok', 'other-ip', 'pos']);
    // The entered row names who entered by login name.
    const enteredRow = (await service.list(owner(), { ...ownDay, account: login('owner') })).items[0];
    expect(enteredRow).toMatchObject({ actorLoginName: login('pos'), operatorLoginName: login('owner'), layer: 'pos' });
  });

  it('filters by method, by a part of the path (case ignored, wildcards literal) and by the start of an address, in the rows and the summary alike', async () => {
    await prisma.requestLog.createMany({
      data: [
        row(1, { requestId: 'get', path: `/T-${tag}/Lines/42` }),
        row(2, { requestId: 'post', method: 'POST', path: `/t-${tag}/lines` }),
        row(3, { requestId: 'delete', method: 'DELETE', path: `/t-${tag}/a_b%c`, ip: '10.0.7.9' }),
        row(4, { requestId: 'lookalike', path: `/t-${tag}/axbyc`, ip: '10.01.1.1' }),
        row(5, { requestId: 'backslash', path: `/t-${tag}/x\\y`, ip: '192.168.0.1' }),
      ],
    });
    expect(await ids({ method: 'POST' })).toEqual(['post']);
    expect(await ids({ method: 'DELETE' })).toEqual(['delete']);
    expect(await ids({ path: 'lines' })).toEqual(['get', 'post']);
    expect(await ids({ path: 'LINES/4' })).toEqual(['get']);
    // `_` and `%` are the characters themselves, not one character and any characters.
    expect(await ids({ path: 'a_b%c' })).toEqual(['delete']);
    expect(await ids({ path: '_' })).toEqual(['delete']);
    expect(await ids({ path: '%' })).toEqual(['delete']);
    expect(await ids({ path: 'x\\y' })).toEqual(['backslash']);
    // The start of an address finds a range; the whole address still finds itself; `_` is not a wildcard there either.
    expect(await ids({ ip: '10.0.' })).toEqual(['delete', 'get', 'post']);
    expect(await ids({ ip: '10.0.7.9' })).toEqual(['delete']);
    expect(await ids({ ip: '10.0_' })).toEqual([]);
    expect(await ids({ ip: '10.0.0.1' })).toEqual(['get', 'post']);
    // The summary reads the same rows under the same filters.
    expect((await service.summary(owner(), { ...ownDay, ip: '10.0.' })).count).toBe(3);
    expect((await service.summary(owner(), { ...ownDay, path: '%' })).count).toBe(1);
    expect((await service.summary(owner(), { ...ownDay, method: 'POST', path: 'LINES' })).busiest).toEqual([{ method: 'POST', route: `/t-${tag}/a`, calls: 1, medianMs: 10, p95Ms: 10 }]);
    expect((await service.summary(owner(), { ...ownDay, unmatched: '1' })).count).toBe(0);
  });

  it('pages newest first by cursor, with the total of the filter', async () => {
    await prisma.requestLog.createMany({ data: Array.from({ length: 85 }, (_, n) => row(n, { requestId: `p${String(n).padStart(2, '0')}` })) });
    const first = await service.list(owner(), ownDay);
    expect(first.total).toBe(85);
    expect(first.items).toHaveLength(80);
    expect(first.items[0].requestId).toBe('p84');
    const second = await service.list(owner(), { ...ownDay, cursor: first.nextCursor as string });
    expect(second.items.map((item) => item.requestId)).toEqual(['p04', 'p03', 'p02', 'p01', 'p00']);
    expect(second.nextCursor).toBeNull();
  });

  it('walks every row once, in order, across pages that end among rows sharing one time', async () => {
    // 250 rows, 30 to a minute, random ids: every page of 80 ends inside a minute, where only the id orders rows.
    const rows = Array.from({ length: 250 }, (_, n) => row(Math.floor(n / 30)));
    await prisma.requestLog.createMany({ data: rows });
    const expected = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1)).map((item) => item.requestId);
    const served: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const listed = await service.list(owner(), { ...ownDay, ...(cursor ? { cursor } : {}) });
      expect(listed.total).toBe(250);
      served.push(...listed.items.map((item) => item.requestId));
      cursor = listed.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(served).toEqual(expected);
  });

  it('sums up in the database: count, refused, failed, error rate, and the slowest and busiest routes with median and p95', async () => {
    const slow = `/t-${tag}/slow`;
    const busy = `/t-${tag}/busy`;
    await prisma.requestLog.createMany({
      data: [
        ...[10, 20, 30, 40, 100].map((durationMs, n) => row(n, { route: slow, durationMs, status: n === 4 ? 500 : 200, code: n === 4 ? 'SERVER_ERROR' : '' })),
        ...Array.from({ length: 8 }, (_, n) => row(10 + n, { route: busy, durationMs: 5, status: n < 2 ? 403 : 200 })),
        row(30, { method: 'POST', route: busy, durationMs: 7 }),
      ],
    });
    const summary = await service.summary(owner(), ownDay);
    expect({ count: summary.count, refused: summary.refused, failed: summary.failed, errorRate: summary.errorRate }).toEqual({ count: 14, refused: 2, failed: 1, errorRate: 0.0714 });
    // percentile_cont interpolates: the median of 10..100 is 30, the 95th percentile 40 + 0.8 × 60 = 88.
    expect(summary.slowest).toEqual([
      { method: 'GET', route: slow, calls: 5, medianMs: 30, p95Ms: 88 },
      { method: 'POST', route: busy, calls: 1, medianMs: 7, p95Ms: 7 },
      { method: 'GET', route: busy, calls: 8, medianMs: 5, p95Ms: 5 },
    ]);
    expect(summary.busiest.map(({ method, route, calls }) => [method, route, calls])).toEqual([['GET', busy, 8], ['GET', slow, 5], ['POST', busy, 1]]);
    // The same filters as the list.
    const failing = await service.summary(owner(), { ...ownDay, status: '5xx' });
    expect({ count: failing.count, failed: failing.failed, errorRate: failing.errorRate, routes: failing.busiest.length }).toEqual({ count: 1, failed: 1, errorRate: 1, routes: 1 });
    const none = await service.summary(owner(), { ...ownDay, ip: '192.0.2.1' });
    expect(none).toEqual({ count: 0, refused: 0, failed: 0, errorRate: 0, slowest: [], busiest: [] });
  });

  it('names the account of a session the handlers did not resolve, and both accounts of an entered one', async () => {
    const draft = (requestId: string, sessionHash: string): RequestLogDraft => ({
      at: new Date(), durationMs: 1, method: 'GET', route: '', path: '/x', status: 404, code: 'NOT_FOUND', ip: '', userAgent: '', requestId, bytesIn: 0, bytesOut: 0, account: null, sessionHash,
    });
    writer.add(draft(`${tag}-own`, hashSessionToken(ownerSid)));
    writer.add(draft(`${tag}-entered`, hashSessionToken(enteredSid)));
    await writer.flush();
    const rows = await prisma.requestLog.findMany({ where: { requestId: { in: [`${tag}-own`, `${tag}-entered`] } }, orderBy: { requestId: 'desc' } });
    expect(rows.map(({ actorId, actorLoginName, layer, operatorId }) => ({ actorId, actorLoginName, layer, operatorId }))).toEqual([
      { actorId: ownerId, actorLoginName: login('owner'), layer: 'branch', operatorId: null },
      { actorId: posId, actorLoginName: login('pos'), layer: 'pos', operatorId: ownerId },
    ]);
  });

  it('is the branch owner\'s alone: an entered session is refused, and so is anyone else', async () => {
    await expect(service.list(entered())).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(service.summary({ ...owner(), isBranchOwner: false })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(service.clear(entered())).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const refused = await request(app.getHttpServer()).delete('/v1/system/requests').set('Cookie', `sid=${enteredSid}`);
    expect(refused.status).toBe(403);
  });

  it('no secret sent with a request reaches its row (M.1, through the real middleware and writer)', async () => {
    const { app: probe, moduleRef } = await probeApp(null, [UnitOfWork, PrismaService, { provide: NOTICE_WRITER, useValue: {} }]);
    try {
      const answers = await sendSecrets(probe);
      await moduleRef.get(RequestLogWriter).flush();
      const requestIds = answers.map((answer) => answer.headers['x-request-id'] as string);
      const rows = await prisma.requestLog.findMany({ where: { requestId: { in: requestIds } }, orderBy: { at: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(leaked(JSON.stringify(rows))).toEqual([]);
      expect(rows.map(({ method, route, path, status }) => ({ method, route, path, status }))).toEqual([
        { method: 'POST', route: '/v1/probe/:id', path: '/v1/probe/one', status: 201 },
        { method: 'GET', route: '/v1/probe/:id', path: '/v1/probe/two', status: 200 },
      ]);
      // The session the handlers resolved names its account; the cookie itself is nowhere.
      expect(rows.map((row) => row.actorLoginName)).toEqual(['branch', 'branch']);
      await prisma.requestLog.deleteMany({ where: { requestId: { in: requestIds } } });
    } finally {
      await probe.close();
      await moduleRef.get(UnitOfWork).prisma.$disconnect();
    }
  });

  it('a request that crashes with secrets in its body, query, cookie, headers and error message leaves none in its rows (M.4)', async () => {
    const { app: probe, moduleRef } = await probeApp(null, [UnitOfWork, PrismaService, { provide: NOTICE_WRITER, useValue: {} }]);
    try {
      const answer = await sendCrash(probe);
      expect(answer.status).toBe(500);
      expect(answer.body).toEqual({ message: expect.any(String), code: 'SERVER_ERROR' });
      await moduleRef.get(RequestLogWriter).flush();
      const requestId = answer.headers['x-request-id'] as string;
      const rows = await prisma.requestLog.findMany({ where: { requestId } });
      const errors = await prisma.requestError.findMany({ where: { requestId } });
      expect(rows.map(({ status, route }) => ({ status, route }))).toEqual([{ status: 500, route: '/v1/probe/:id/crash' }]);
      expect(errors).toHaveLength(1);
      expect(leaked(JSON.stringify([rows, errors]))).toEqual([]);
      const [error] = errors;
      // The class and a code for the message, never its words; the frames name functions and files, the frame-shaped
      // line the message carried is not one of them.
      expect({ method: error.method, route: error.route, name: error.name, message: error.message }).toEqual({ method: 'POST', route: '/v1/probe/:id/crash', name: 'TypeError', message: 'unclassified' });
      const frames = error.stack.split('\n');
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]).toMatch(/crashWithSecrets \(src\/request-log\.fixture\.ts:\d+:\d+\)$/);
      expect(error.stack).not.toContain('NEVER-LOGGED');
      await prisma.requestLog.deleteMany({ where: { requestId } });
      await prisma.requestError.deleteMany({ where: { requestId } });
    } finally {
      await probe.close();
      await moduleRef.get(UnitOfWork).prisma.$disconnect();
    }
  });
  it('groups the server errors by route and message, with the count, first and last seen and the last request (M.4)', async () => {
    const route = `/t-${tag}/broken`;
    const error = (minutes: number, extra: Record<string, unknown> = {}) => ({
      id: randomUUID(), requestId: `${tag}-e${(serial += 1)}`, at: new Date(base + minutes * 60_000), method: 'GET', route, name: 'TypeError', message: 'unclassified', stack: `f${minutes} (dist/x.js:1:1)`, ...extra,
    });
    await prisma.requestError.createMany({
      data: [error(1), error(5, { requestId: 'last-of-three' }), error(3), error(2, { message: 'P2024', name: 'PrismaClientKnownRequestError' }), error(4, { route: `/t-${tag}/other` })],
    });
    const answer = await service.errors(owner(), { ...ownDay, route });
    expect({ total: answer.total, capped: answer.capped }).toEqual({ total: 4, capped: false });
    expect(answer.items).toEqual([
      { method: 'GET', route, name: 'TypeError', message: 'unclassified', count: 3, firstAt: at(1), lastAt: at(5), lastRequestId: 'last-of-three', stack: ['f5 (dist/x.js:1:1)'] },
      { method: 'GET', route, name: 'PrismaClientKnownRequestError', message: 'P2024', count: 1, firstAt: at(2), lastAt: at(2), lastRequestId: expect.any(String), stack: ['f2 (dist/x.js:1:1)'] },
    ]);
    // The day range holds; another route is its own group.
    expect((await service.errors(owner(), { ...ownDay })).items.map((group) => [group.route, group.count])).toEqual([[route, 3], [`/t-${tag}/other`, 1], [route, 1]]);
    expect((await service.errors(owner(), { from: at(3), to: at(4) })).items.filter((group) => group.route.startsWith(`/t-${tag}/`)).map((group) => [group.route, group.count])).toEqual([[`/t-${tag}/other`, 1], [route, 1]]);
    await expect(service.errors(entered())).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
  it('clearing the errors alone leaves the requests, and is recorded like the clearing of the log (M.4)', async () => {
    await prisma.requestLog.createMany({ data: [row(1)] });
    await prisma.requestError.createMany({ data: [{ requestId: `${tag}-alone`, at: new Date(base), method: 'GET', route: '/x', name: 'Error', message: 'unclassified' }] });
    const events = () => prisma.activityEvent.findMany({ where: { actorId: ownerId, action: 'request_log_clear', subjectKind: 'request_errors' } });
    const already = (await events()).length;
    const answer = await request(app.getHttpServer()).delete('/v1/system/errors').set('Cookie', `sid=${ownerSid}`);
    expect(answer.status).toBe(200);
    expect(answer.body.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.requestError.count({ where: { requestId: `${tag}-alone` } })).toBe(0);
    expect(await prisma.requestLog.count({ where: dayWhere })).toBe(1);
    const written = (await events()).slice(already);
    expect(written.map(({ result, subjectRef }) => ({ result, subjectRef }))).toEqual([{ result: 'ok', subjectRef: String(answer.body.removed) }]);
    const refused = await request(app.getHttpServer()).delete('/v1/system/errors').set('Cookie', `sid=${enteredSid}`);
    expect(refused.status).toBe(403);
  });
  it('clearing deletes every row, leaves the activity log, and writes one event there with the count', async () => {
    await prisma.requestLog.createMany({ data: [row(1), row(2), row(3)] });
    await prisma.requestError.createMany({ data: [{ requestId: `${tag}-crashed`, at: new Date(base), method: 'GET', route: '/x', name: 'Error', message: 'unclassified' }] });
    // A row still waiting in the writer goes with the clearing too.
    writer.add({ at: new Date(), durationMs: 1, method: 'GET', route: '', path: '/waiting', status: 200, code: '', ip: '', userAgent: '', requestId: `${tag}-waiting`, bytesIn: 0, bytesOut: 0, account: null, sessionHash: null });
    // An event of the activity log from before: the clearing does not reach it.
    const kept = await prisma.activityEvent.create({ data: { actorId: ownerId, actorLoginName: login('owner'), actorLayer: 'branch', action: 'fund', result: 'ok' } });
    const events = () => prisma.activityEvent.findMany({ where: { actorId: ownerId, action: 'request_log_clear' }, orderBy: { at: 'asc' } });
    const already = (await events()).length;
    const answer = await request(app.getHttpServer()).delete('/v1/system/requests').set('Cookie', `sid=${ownerSid}`);
    expect(answer.status).toBe(200);
    // This file's rows only (`OwnRowsRepository`): the three, the one that waited in the writer, and what earlier
    // tests of this file left.
    expect(answer.body.removed).toBeGreaterThanOrEqual(4);
    expect(await prisma.requestLog.count({ where: { requestId: { startsWith: `${tag}-` } } })).toBe(0);
    // D5: the errors go with their requests, and the answer says how many of each.
    expect(answer.body.errorsRemoved).toBeGreaterThanOrEqual(1);
    expect(await prisma.requestError.count({ where: { requestId: `${tag}-crashed` } })).toBe(0);
    expect(await prisma.activityEvent.findUnique({ where: { id: kept.id } })).not.toBeNull();
    const written = (await events()).slice(already);
    expect(written.map(({ action, result, subjectKind, subjectRef, actorLoginName }) => ({ action, result, subjectKind, subjectRef, actorLoginName }))).toEqual([
      { action: 'request_log_clear', result: 'ok', subjectKind: 'request_log', subjectRef: String(answer.body.removed), actorLoginName: login('owner') },
    ]);
  });
  it('the real clearing empties both tables, and the real clearing of the errors leaves the requests (rolled back: no other session sees it)', async () => {
    class RolledBack extends Error {}
    const seen: Record<string, unknown> = {};
    // A row and an error that carry nothing of this file: the real statements are not held to this file's rows.
    const foreign = `foreign-${randomUUID()}`;
    const mine = { requestId: { startsWith: `${tag}-` } };
    await expect(prisma.$transaction(async (tx) => {
      // The repository as the product builds it, on a unit of work that is this transaction.
      const real = new RequestLogRepository({ prisma: tx, runTx: <T>(run: (client: typeof tx) => Promise<T>) => run(tx) } as unknown as UnitOfWork);
      await tx.requestLog.createMany({ data: [row(1), row(2), row(3, { requestId: foreign })] });
      const error = (requestId: string) => ({ requestId, at: new Date(base), method: 'GET', route: '/x', name: 'Error', message: 'unclassified' });
      await tx.requestError.createMany({ data: [error(`${tag}-real`), error(foreign)] });
      seen.errorsRemoved = await real.clearErrors();
      seen.afterErrors = [await tx.requestError.count({ where: { requestId: { in: [`${tag}-real`, foreign] } } }), await tx.requestLog.count({ where: { requestId: foreign } })];
      await tx.requestError.createMany({ data: [error(`${tag}-real-2`), error(foreign)] });
      seen.cleared = await real.clear();
      seen.left = [await tx.requestLog.count({ where: { OR: [mine, { requestId: foreign }] } }), await tx.requestError.count({ where: { OR: [mine, { requestId: foreign }] } })];
      throw new RolledBack();
    }, { timeout: 30_000 })).rejects.toBeInstanceOf(RolledBack);
    // The errors alone: both gone, the foreign request still there.
    expect(seen.errorsRemoved).toBeGreaterThanOrEqual(2);
    expect(seen.afterErrors).toEqual([0, 1]);
    // The whole log: every request and error this transaction could name, this file's or not.
    const cleared = seen.cleared as { removed: number; errorsRemoved: number };
    expect(cleared.removed).toBeGreaterThanOrEqual(3);
    expect(cleared.errorsRemoved).toBeGreaterThanOrEqual(2);
    expect(seen.left).toEqual([0, 0]);
    // Rolled back: nothing of it is in the table.
    expect(await prisma.requestLog.count({ where: { requestId: foreign } })).toBe(0);
  });
});
