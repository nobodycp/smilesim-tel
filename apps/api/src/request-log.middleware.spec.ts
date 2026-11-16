import 'reflect-metadata';
import { Controller, Get, Module, Param, Post, UseInterceptors, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DoorMiddleware } from './door.middleware';
import { OriginMiddleware } from './origin.middleware';
import { RATE_LIMIT_SIGN_IN, RateLimitMiddleware } from './rate-limit.middleware';
import { REQUEST_ID_HEADER, RequestLogMiddleware } from './request-log.middleware';
import { AUTH_STORE } from './modules/auth/auth.store';
import { hashSessionToken } from './modules/auth/session-token';
import { MemoryAuthStore } from './modules/auth/testing/memory-auth.store';
import { ActorInterceptor } from './modules/access/actor.interceptor';
import { ActorResolver } from './modules/access/actor-resolver';
import type { Actor } from './modules/access/types';
import { API_PROVIDERS } from './modules/platform/api-providers';
import { fail } from './modules/platform/api-failure';
import { RESOURCE_CONTROLLER_PREFIXES } from './modules/platform/route-prefixes';
import { RequestLogWriter, type RequestLogDraft } from './modules/monitoring/request-log.writer';
import { RequestLogRepository } from './modules/monitoring/request-log.repository';
import { UnitOfWork } from './modules/platform/unit-of-work';
import { NOTICE_WRITER } from './modules/platform/notices';
import { createPrismaClient } from './db';

// The request log's middleware (spec 2026-11-17-system-monitor, slice M.1): what reaches a row and what never does.
// The writer is a stand-in that keeps the drafts it is handed; `request-log.writer.db.spec.ts` follows the same
// requests into PostgreSQL.

/** Values a request can carry that must never reach the log, sent every way a request carries them. */
const SECRETS = {
  password: 'Pa55-word-NEVER-LOGGED',
  code: '771234',
  esimCode: 'LPA:1$smdp.example$ESIM-NEVER-LOGGED',
  session: 'sid-token-NEVER-LOGGED',
  home: 'home-token-NEVER-LOGGED',
  query: 'query-token-NEVER-LOGGED',
  bearer: 'bearer-NEVER-LOGGED',
  apiKey: 'api-key-NEVER-LOGGED',
  idempotency: 'idem-key-NEVER-LOGGED',
};

const OWNER: Actor = { id: 'owner-1', loginName: 'branch', nickname: 'branch', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'owner-1', impersonating: false };
const ENTERED: Actor = { id: 'pos-1', loginName: 'pos1', nickname: 'pos1', layer: 'pos', isBranchOwner: false, grants: [], operatorId: 'owner-1', impersonating: true };

/** Sessions the stand-in resolver knows: the owner's own, and the owner inside a point of sale. */
const resolver = {
  actor: async (gate: { sessionId?: string }) => {
    if (gate.sessionId === 'owner-sid' || gate.sessionId === SECRETS.session) return OWNER;
    if (gate.sessionId === 'entered-sid') return ENTERED;
    return fail(401, 'LOGIN_REQUIRED');
  },
};

@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActorInterceptor)
class SignedInProbe {
  @Get('probe/:id')
  read(@Param('id') id: string) {
    return { id };
  }

  @Post('probe/:id')
  write() {
    return { ok: true };
  }

  @Get('forbidden')
  forbidden() {
    return fail(403, 'FORBIDDEN');
  }

  @Get('crash')
  crash() {
    throw new Error('a bug');
  }
}

@Controller(RESOURCE_CONTROLLER_PREFIXES)
class OpenProbe {
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('notices/stream')
  stream() {
    return { ok: true };
  }
}

@Controller()
class HealthProbe {
  @Get('health')
  health() {
    return { ok: true };
  }
}

/** The app's four middleware in the app's order, over probe routes, with the given writer. */
async function probeApp(writer: Partial<RequestLogWriter> | null, extra: unknown[] = []) {
  @Module({
    controllers: [SignedInProbe, OpenProbe, HealthProbe],
    providers: [
      RequestLogMiddleware, OriginMiddleware, RateLimitMiddleware, DoorMiddleware, ...API_PROVIDERS,
      { provide: AUTH_STORE, useValue: new MemoryAuthStore() },
      { provide: ActorResolver, useValue: resolver },
      ...(writer ? [{ provide: RequestLogWriter, useValue: writer }] : [RequestLogWriter, RequestLogRepository]),
      ...(extra as never[]),
    ],
  })
  class ProbeModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(RequestLogMiddleware, OriginMiddleware, RateLimitMiddleware, DoorMiddleware).forRoutes('*');
    }
  }
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef };
}

/** One write and one read that carry every secret: body, query, cookies, headers. */
async function sendSecrets(app: INestApplication) {
  const cookie = `sid=${SECRETS.session}; home=${SECRETS.home}; other=${SECRETS.code}`;
  const headers = { Cookie: cookie, Authorization: `Bearer ${SECRETS.bearer}`, 'X-Api-Key': SECRETS.apiKey, 'Idempotency-Key': SECRETS.idempotency, 'X-Code': SECRETS.code };
  const write = await request(app.getHttpServer())
    .post(`/v1/probe/one?token=${SECRETS.query}&password=${SECRETS.password}`)
    .set(headers)
    .send({ password: SECRETS.password, code: SECRETS.code, esimCode: SECRETS.esimCode, nested: { secret: SECRETS.session } });
  const read = await request(app.getHttpServer()).get(`/v1/probe/two?code=${SECRETS.code}&esim=${encodeURIComponent(SECRETS.esimCode)}`).set(headers);
  return [write, read];
}

function leaked(text: string): string[] {
  return Object.entries(SECRETS).filter(([, value]) => text.includes(value) || text.includes(encodeURIComponent(value))).map(([name]) => name);
}

describe('the request log middleware', () => {
  let app: INestApplication;
  const drafts: RequestLogDraft[] = [];
  const writer = { add: (draft: RequestLogDraft) => void drafts.push(draft) };
  const server = () => request(app.getHttpServer());
  /** The drafts written so far, once the answer's `finish` has run. */
  const settled = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return drafts;
  };

  beforeAll(async () => {
    ({ app } = await probeApp(writer));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    drafts.length = 0;
  });

  it('writes one row a request, with the route pattern, the path without its query and a request id sent back', async () => {
    const answer = await server().get('/v1/probe/abc?q=1&x=2').set('Cookie', 'sid=owner-sid').set('User-Agent', 'agent-probe');
    expect(answer.status).toBe(200);
    const [row] = await settled();
    expect(drafts).toHaveLength(1);
    expect(row).toMatchObject({ method: 'GET', route: '/v1/probe/:id', path: '/v1/probe/abc', status: 200, code: '', userAgent: 'agent-probe', bytesIn: 0, sessionHash: null });
    expect(row.account).toEqual({ actorId: 'owner-1', actorLoginName: 'branch', layer: 'branch', operatorId: null });
    expect(answer.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(row.requestId);
    expect(row.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.bytesOut).toBe(Number(answer.headers['content-length']));
    expect(row.at).toBeInstanceOf(Date);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never takes a request id from the caller', async () => {
    const answer = await server().get('/v1/open').set(REQUEST_ID_HEADER, 'caller-chosen');
    const [row] = await settled();
    expect(row.requestId).not.toBe('caller-chosen');
    expect(answer.headers['x-request-id']).toBe(row.requestId);
  });

  it('names both accounts of an entered session: the entered one, and who entered by id', async () => {
    await server().get('/v1/probe/abc').set('Cookie', 'sid=entered-sid');
    const [row] = await settled();
    expect(row.account).toEqual({ actorId: 'pos-1', actorLoginName: 'pos1', layer: 'pos', operatorId: 'owner-1' });
  });

  it('a session the handlers did not resolve travels as its hash, to be named by the writer', async () => {
    await server().get('/v1/open').set('Cookie', 'sid=someone-sid');
    const [row] = await settled();
    expect(row.account).toBeNull();
    expect(row.sessionHash).toBe(hashSessionToken('someone-sid'));
    expect(JSON.stringify(row)).not.toContain('someone-sid');
  });

  it('writes the refused requests with their code: 401, 403, 404, 500, and those refused before any route', async () => {
    await server().get('/v1/probe/abc');
    await server().get('/v1/forbidden').set('Cookie', 'sid=owner-sid');
    await server().get('/v1/no-such-path?secret=1');
    await server().get('/v1/crash').set('Cookie', 'sid=owner-sid');
    // The origin middleware refuses a write from another site; the door middleware a door that is not the origin's.
    await server().post('/v1/probe/abc').set('Origin', 'https://evil.example');
    await server().get('/v1/open').set('x-door', 'admin').set('Origin', 'http://pos.localhost:3000');
    const rows = (await settled()).map(({ status, code, route, path }) => ({ status, code, route, path }));
    expect(rows).toEqual([
      { status: 401, code: 'LOGIN_REQUIRED', route: '/v1/probe/:id', path: '/v1/probe/abc' },
      { status: 403, code: 'FORBIDDEN', route: '/v1/forbidden', path: '/v1/forbidden' },
      { status: 404, code: 'NOT_FOUND', route: '', path: '/v1/no-such-path' },
      { status: 500, code: 'SERVER_ERROR', route: '/v1/crash', path: '/v1/crash' },
      { status: 403, code: 'FORBIDDEN', route: '', path: '/v1/probe/abc' },
      { status: 403, code: 'DOOR_MISMATCH', route: '', path: '/v1/open' },
    ]);
  });

  it('writes a request the rate limit refused (429)', async () => {
    // The sign-in limit counts attempts per address before any route runs (RATE_LIMIT_SIGN_IN in a minute).
    let answer = await server().post('/auth/login').set('Cookie', 'sid=owner-sid');
    for (let attempt = 1; attempt <= RATE_LIMIT_SIGN_IN && answer.status !== 429; attempt += 1) answer = await server().post('/auth/login').set('Cookie', 'sid=owner-sid');
    expect(answer.status).toBe(429);
    const last = (await settled()).at(-1) as RequestLogDraft;
    expect(last).toMatchObject({ method: 'POST', path: '/auth/login', status: 429, code: 'RATE_LIMITED', route: '' });
    expect(last.sessionHash).toBe(hashSessionToken('owner-sid'));
  });

  it('does not write the health probe or the notices stream', async () => {
    await server().get('/health');
    await server().get('/v1/notices/stream');
    await server().get('/V1/Notices/Stream/');
    expect(await settled()).toEqual([]);
  });

  it('keeps no body, cookie, query string or header value but the user agent, cut to 200 characters', async () => {
    const [write, read] = await sendSecrets(app);
    expect([write.status, read.status]).toEqual([201, 200]);
    const rows = await settled();
    expect(rows).toHaveLength(2);
    expect(leaked(JSON.stringify(rows))).toEqual([]);
    expect(rows.map((row) => row.path)).toEqual(['/v1/probe/one', '/v1/probe/two']);
    expect(rows[0].bytesIn).toBeGreaterThan(0);
    await server().get('/v1/open').set('User-Agent', 'u'.repeat(500));
    expect((await settled())[2].userAgent).toBe('u'.repeat(200));
  });

  it('a request never waits for its log: the answer comes while the database hangs on the batch', async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = previousUrl ?? 'postgresql://stand-in';
    let hangs = true;
    const held: (() => void)[] = [];
    const insertMany = () => (hangs ? new Promise<void>((resolve) => held.push(resolve)) : Promise.resolve());
    const hanging = { insertMany, sessionsByHash: async () => [] } as unknown as RequestLogRepository;
    const slow = new RequestLogWriter(hanging);
    const { app: hung } = await probeApp(slow);
    try {
      await request(hung.getHttpServer()).get('/v1/open');
      void slow.flush();
      const started = Date.now();
      const answers = await Promise.all([1, 2, 3].map(() => request(hung.getHttpServer()).get('/v1/open')));
      expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      hangs = false;
      for (const resume of held) resume();
      await slow.flush();
      await hung.close();
      process.env.DATABASE_URL = previousUrl;
    }
  });

  it('the writer failing never fails the request', async () => {
    const { app: broken } = await probeApp({ add: () => { throw new Error('the log is broken'); } });
    try {
      const answer = await request(broken.getHttpServer()).get('/v1/open');
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ ok: true });
    } finally {
      await broken.close();
    }
  });
});

// The same requests into PostgreSQL through the real writer (PostgreSQL only: see wallet-concurrency.db.spec.ts).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the request log in PostgreSQL', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let app: INestApplication;
  let writer: RequestLogWriter;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    let moduleRef;
    ({ app, moduleRef } = await probeApp(null, [UnitOfWork, { provide: NOTICE_WRITER, useValue: {} }]));
    writer = moduleRef.get(RequestLogWriter);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('no secret sent with a request reaches its row', async () => {
    const answers = await sendSecrets(app);
    await writer.flush();
    const ids = answers.map((answer) => answer.headers['x-request-id'] as string);
    const rows = await prisma.requestLog.findMany({ where: { requestId: { in: ids } }, orderBy: { at: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(leaked(JSON.stringify(rows))).toEqual([]);
    expect(rows.map(({ method, route, path, status }) => ({ method, route, path, status }))).toEqual([
      { method: 'POST', route: '/v1/probe/:id', path: '/v1/probe/one', status: 201 },
      { method: 'GET', route: '/v1/probe/:id', path: '/v1/probe/two', status: 200 },
    ]);
    // The session the handlers resolved names its account; the cookie itself is nowhere.
    expect(rows.map((row) => row.actorLoginName)).toEqual(['branch', 'branch']);
    await prisma.requestLog.deleteMany({ where: { requestId: { in: ids } } });
  });
});
