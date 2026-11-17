import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RATE_LIMIT_SIGN_IN } from './rate-limit.middleware';
import { REQUEST_ID_HEADER } from './request-log.middleware';
import { hashSessionToken } from './modules/auth/session-token';
import { RequestLogWriter, type RequestLogDraft } from './modules/monitoring/request-log.writer';
import type { RequestLogRepository } from './modules/monitoring/request-log.repository';
import { leaked, probeApp, sendSecrets } from './request-log.fixture';

// The request log's middleware (spec 2026-11-17-system-monitor, slice M.1): what reaches a row and what never does.
// The writer is a stand-in that keeps the drafts it is handed; `modules/monitoring/request-log.db.spec.ts` follows
// the same requests into PostgreSQL.

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
