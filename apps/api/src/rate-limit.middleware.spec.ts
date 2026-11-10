import type { NextFunction, Request, Response } from 'express';
import { RATE_LIMIT_ALL, RATE_LIMIT_SIGN_IN, RATE_LIMIT_WRITES, RateLimitMiddleware, memoryCounter } from './rate-limit.middleware';

function call(middleware: RateLimitMiddleware, method: string, url: string, sid?: string) {
  const req = { method, originalUrl: url, headers: { cookie: sid ? `sid=${sid}` : '' } } as unknown as Request;
  const sent: { status?: number; body?: unknown; retry?: string } = {};
  const res = {
    setHeader: (name: string, value: string) => { if (name === 'Retry-After') sent.retry = value; },
    status: (code: number) => { sent.status = code; return res; },
    json: (body: unknown) => { sent.body = body; return res; },
  } as unknown as Response;
  let passed = false;
  const next: NextFunction = () => { passed = true; };
  return middleware.use(req, res, next).then(() => ({ passed, ...sent }));
}

describe('RateLimitMiddleware', () => {
  let clock = 0;
  let middleware: RateLimitMiddleware;
  beforeEach(() => {
    clock = 1_000_000;
    middleware = new RateLimitMiddleware();
    middleware.counter = memoryCounter(() => clock);
  });

  it('lets a session make its writes up to the limit, then answers 429 RATE_LIMITED with Retry-After', async () => {
    for (let index = 0; index < RATE_LIMIT_WRITES; index += 1) {
      expect((await call(middleware, 'POST', '/office/lines/x/extend', 's1')).passed).toBe(true);
    }
    const refused = await call(middleware, 'POST', '/office/lines/x/extend', 's1');
    expect(refused).toMatchObject({ passed: false, status: 429, body: { code: 'RATE_LIMITED' }, retry: '60' });
    // Reads go on, another session is not touched, and a new window lets writes in again.
    expect((await call(middleware, 'GET', '/office/lines', 's1')).passed).toBe(true);
    expect((await call(middleware, 'POST', '/office/lines/x/extend', 's2')).passed).toBe(true);
    clock += 60_000;
    expect((await call(middleware, 'POST', '/office/lines/x/extend', 's1')).passed).toBe(true);
  });

  it('caps every request of a session, and never counts the notices stream, health, or a call without a session', async () => {
    for (let index = 0; index < RATE_LIMIT_ALL; index += 1) await call(middleware, 'GET', '/office/home', 's1');
    expect((await call(middleware, 'GET', '/office/home', 's1')).status).toBe(429);
    expect((await call(middleware, 'GET', '/office/notices/stream', 's1')).passed).toBe(true);
    expect((await call(middleware, 'GET', '/health', 's1')).passed).toBe(true);
    for (let index = 0; index < RATE_LIMIT_ALL + 5; index += 1) await call(middleware, 'GET', '/branding');
    expect((await call(middleware, 'GET', '/branding')).passed).toBe(true);
  });

  it('caps sign-in attempts from one address, whatever the login name (review 2026-11-10, S9)', async () => {
    for (let index = 0; index < RATE_LIMIT_SIGN_IN; index += 1) expect((await call(middleware, 'POST', '/auth/login')).passed).toBe(true);
    const refused = await call(middleware, 'POST', '/auth/login');
    expect([refused.status, refused.passed]).toEqual([429, false]);
    expect((await call(middleware, 'POST', '/office/handoff')).status).toBe(429);
  });

  it('lets the request through when the counter fails', async () => {
    middleware.counter = { hit: async () => { throw new Error('redis down'); } };
    expect((await call(middleware, 'POST', '/office/users', 's1')).passed).toBe(true);
  });
});
