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
import { leaked, probeApp, sendSecrets } from '../../request-log.fixture';

// The request log in PostgreSQL (system monitor M.1, M.2): what a request leaves in its row, the filters, the figures
// the database computes, and the clearing, which leaves the activity log and writes its own event there.
// PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one). Every test of the table is in this one
// file, so they run one after another: the clearing empties the whole table, as it would the real one. Other specs
// that run beside it may write rows (the app's own middleware), so what is read here is held to this file's own day
// (a day of the years 2000–2009 picked by the run) or to its own request ids.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the request log in PostgreSQL: reading, the summary and clearing', () => {
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
  const clearOwnDay = () => prisma.requestLog.deleteMany({ where: { at: { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) } } });
  let serial = 0;
  /** One row as the writer would write it, `minutes` after 08:00. */
  const row = (minutes: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(), at: new Date(base + minutes * 60_000), durationMs: 10, method: 'GET', route: `/t-${tag}/a`, path: `/t-${tag}/a`, status: 200, code: '',
    actorId: null, actorLoginName: '', operatorId: null, layer: '', ip: '10.0.0.1', userAgent: '', requestId: `${tag}-${(serial += 1)}`, bytesIn: 0, bytesOut: 0, ...extra,
  });

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
        RequestLogService, RequestLogRepository, RequestLogWriter, UnitOfWork, PrismaService, ...API_PROVIDERS,
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
    // The entered row names who entered by login name.
    const enteredRow = (await service.list(owner(), { ...ownDay, account: login('owner') })).items[0];
    expect(enteredRow).toMatchObject({ actorLoginName: login('pos'), operatorLoginName: login('owner'), layer: 'pos' });
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

  it('clearing deletes every row, leaves the activity log, and writes one event there with the count', async () => {
    await prisma.requestLog.createMany({ data: [row(1), row(2), row(3)] });
    // A row still waiting in the writer goes with the clearing too.
    writer.add({ at: new Date(), durationMs: 1, method: 'GET', route: '', path: '/waiting', status: 200, code: '', ip: '', userAgent: '', requestId: `${tag}-waiting`, bytesIn: 0, bytesOut: 0, account: null, sessionHash: null });
    // An event of the activity log from before: the clearing does not reach it.
    const kept = await prisma.activityEvent.create({ data: { actorId: ownerId, actorLoginName: login('owner'), actorLayer: 'branch', action: 'fund', result: 'ok' } });
    const events = () => prisma.activityEvent.findMany({ where: { actorId: ownerId, action: 'request_log_clear' }, orderBy: { at: 'asc' } });
    const already = (await events()).length;
    const answer = await request(app.getHttpServer()).delete('/v1/system/requests').set('Cookie', `sid=${ownerSid}`);
    expect(answer.status).toBe(200);
    // Every row of the table: this file's three, and any another spec wrote meanwhile.
    expect(answer.body.removed).toBeGreaterThanOrEqual(4);
    expect(await prisma.requestLog.count({ where: { requestId: { startsWith: `${tag}-` } } })).toBe(0);
    expect(await prisma.activityEvent.findUnique({ where: { id: kept.id } })).not.toBeNull();
    const written = (await events()).slice(already);
    expect(written.map(({ action, result, subjectKind, subjectRef, actorLoginName }) => ({ action, result, subjectKind, subjectRef, actorLoginName }))).toEqual([
      { action: 'request_log_clear', result: 'ok', subjectKind: 'request_log', subjectRef: String(answer.body.removed), actorLoginName: login('owner') },
    ]);
  });
});
