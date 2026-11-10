import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { officeTestApp } from './testing/office-test-app';
import { ROUTES } from './testing/office-routes';

// Every office route as the app serves it, whichever controller holds it: the method and path, and the activity
// event it writes. Called without a session, each one refuses with 401 and logs the refusal under its own event.
// The table lives in testing/office-routes.ts.

// Routes that judge something before the session, so an anonymous call with the sample body answers 400 INVALID:
// `leave` reads the impersonation session itself; `handoff` has no session yet (it trades a one-time code for one). The carrier switch (not defined yet, always refused) asks for the
// session first since 2026-11-08, like every other line route. The price and terms
// writes used to parse their body first; since 2026-11-08 (owner decision, 401 first) they ask for the session first.
const BEFORE_SESSION: Record<string, number> = {
  'POST /office/handoff': 400,
  'POST /office/leave': 400,
};

describe('office routes without a session', () => {
  let app: INestApplication;
  let recorded: unknown[][];

  beforeAll(async () => {
    ({ app, recorded } = await officeTestApp(new MemoryAuthStore(), {}));
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves every route once', () => {
    const keys = ROUTES.map(([method, path]) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(ROUTES)('%s %s refuses and logs its own event', async (method, path, event) => {
    recorded.length = 0;
    const call = request(app.getHttpServer())[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path);
    const response = method === 'GET' ? await call : await call.send({ msisdn: 'MSISDN1', loginName: 'BODYLOGIN' });
    const status = BEFORE_SESSION[`${method} ${path}`] ?? 401;
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ code: status === 401 ? 'LOGIN_REQUIRED' : 'INVALID' });
    const logged = recorded.map(([, , draft, result, reason]) => [draft, result, reason]);
    expect(logged).toEqual(
      event ? [[{ action: event[0], subjectKind: event[1], subjectRef: event[2] }, 'fail', status === 401 ? 'LOGIN_REQUIRED' : 'INVALID']] : [],
    );
  });
});
