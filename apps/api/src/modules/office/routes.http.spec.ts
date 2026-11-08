import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';

// Every office route as the app serves it, whichever controller holds it: the method and path, and the activity
// event it writes. Called without a session, each one refuses with 401 and logs the refusal under its own event.
// Generated from the controllers on 2026-11-08 before the domain split moved routes; a route that moves must
// keep its row.
type Row = [method: string, path: string, event: [action: string, kind: string, subject: string] | null];

const ROUTES: Row[] = [
  ['POST', '/office/announcements', null],
  ['GET', '/office/audit', null],
  ['GET', '/office/companies', null],
  ['PUT', '/office/companies/CODE1/sim', ['company_sim', 'company', 'CODE1']],
  ['POST', '/office/companies/image', null],
  ['GET', '/office/directory', null],
  ['GET', '/office/finance', null],
  ['GET', '/office/home', null],
  ['POST', '/office/leave', ['leave', 'account', '']],
  ['GET', '/office/ledger/SCOPE1', null],
  ['GET', '/office/lines', null],
  ['POST', '/office/lines', ['activate', 'line', 'MSISDN1']],
  ['GET', '/office/lines/ID1', null],
  ['POST', '/office/lines/ID1/charge', ['charge', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/company-switch', ['company_switch', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/disconnect', ['disconnect', 'line', 'ID1']],
  ['GET', '/office/lines/ID1/disconnect-quote', null],
  ['POST', '/office/lines/ID1/esim', ['esim', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/extend', ['extend', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/freeze', ['freeze', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/reactivate', ['reactivate', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/refresh', ['refresh', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/rename', ['rename', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/sim', ['sim', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/switch', ['switch', 'line', 'ID1']],
  ['POST', '/office/lines/ID1/transfer', null],
  ['POST', '/office/lines/ID1/unfreeze', ['unfreeze', 'line', 'ID1']],
  ['GET', '/office/me', null],
  ['GET', '/office/notices', null],
  ['POST', '/office/notices/read', null],
  ['GET', '/office/notices/stream', null],
  ['GET', '/office/packages', null],
  ['PATCH', '/office/packages/CODE1/chain', ['package_chain', 'package', 'CODE1']],
  ['GET', '/office/packages/CODE1/custom-prices', null],
  ['DELETE', '/office/packages/CODE1/custom-prices/LOGIN1', ['user_package', 'user', 'LOGIN1:CODE1']],
  ['PUT', '/office/packages/CODE1/custom-prices/LOGIN1', ['user_package', 'user', 'LOGIN1:CODE1']],
  ['GET', '/office/packages/CODE1/line-prices', null],
  ['PUT', '/office/packages/CODE1/line-prices', ['package_reprice', 'package', 'CODE1']],
  ['PATCH', '/office/packages/CODE1/mode', ['package_mode', 'package', 'CODE1']],
  ['PUT', '/office/packages/CODE1/renewals', null],
  ['GET', '/office/packages/CODE1/sheet', null],
  ['PUT', '/office/packages/CODE1/switches', null],
  ['GET', '/office/provider-operations', null],
  ['GET', '/office/providers', null],
  ['PATCH', '/office/providers/CODE1/esim-price', ['provider_esim_price', 'provider', 'CODE1']],
  ['GET', '/office/providers/CODE1/settings', null],
  ['PATCH', '/office/providers/CODE1/settings', ['provider_mode', 'provider', 'CODE1']],
  ['GET', '/office/reports/KIND1', null],
  ['GET', '/office/roles', null],
  ['POST', '/office/roles', null],
  ['DELETE', '/office/sell-prices/CODE1', ['sell_price', 'package', 'CODE1']],
  ['PUT', '/office/sell-prices/CODE1', ['sell_price', 'package', 'CODE1']],
  ['GET', '/office/tasks', null],
  ['GET', '/office/tasks/ID1', null],
  ['POST', '/office/tasks/ID1/cancel', ['task_cancel', 'task', 'ID1']],
  ['POST', '/office/tasks/ID1/complete', ['task_complete', 'task', 'ID1']],
  ['POST', '/office/tasks/ID1/notes', ['task_note', 'task', 'ID1']],
  ['POST', '/office/tasks/ID1/reject', ['task_reject', 'task', 'ID1']],
  ['POST', '/office/tasks/ID1/release', ['task_release', 'task', 'ID1']],
  ['POST', '/office/tasks/ID1/take', ['task_take', 'task', 'ID1']],
  ['GET', '/office/users', null],
  ['POST', '/office/users', ['user_create', 'account', 'BODYLOGIN']],
  ['DELETE', '/office/users/LOGIN1', ['user_delete', 'account', 'LOGIN1']],
  ['GET', '/office/users/LOGIN1', null],
  ['PATCH', '/office/users/LOGIN1/access', ['access', 'account', 'LOGIN1']],
  ['POST', '/office/users/LOGIN1/enter', ['enter', 'account', 'LOGIN1']],
  ['POST', '/office/users/LOGIN1/freeze', ['user_freeze', 'account', 'LOGIN1']],
  ['GET', '/office/users/LOGIN1/ops', null],
  ['PUT', '/office/users/LOGIN1/ops', ['user_ops', 'user', 'LOGIN1']],
  ['GET', '/office/users/LOGIN1/packages', null],
  ['PUT', '/office/users/LOGIN1/packages', ['user_package', 'user', 'LOGIN1']],
  ['PUT', '/office/users/LOGIN1/packages/CODE1', ['user_package', 'user', 'LOGIN1:CODE1']],
  ['POST', '/office/users/LOGIN1/password', ['password', 'account', 'LOGIN1']],
  ['POST', '/office/users/LOGIN1/restore', ['user_restore', 'account', 'LOGIN1']],
  ['POST', '/office/users/LOGIN1/transfer', ['user_transfer', 'user', 'LOGIN1']],
  ['GET', '/office/users/LOGIN1/transfer-preview', null],
  ['GET', '/office/wallets', null],
  ['PATCH', '/office/wallets/LOGIN1/ceiling', null],
  ['POST', '/office/wallets/LOGIN1/fund', ['fund', 'account', 'LOGIN1']],
];

// Routes that judge something before the session, so an anonymous call with the sample body answers 400 INVALID:
// the carrier switch is not defined yet; `leave` reads the impersonation session itself; the price and terms
// writes parse their body first. Moving a route behind ActorInterceptor turns its 400 into 401: that is a
// behaviour change and needs its own decision before the row changes.
const BEFORE_SESSION: Record<string, number> = {
  'POST /office/lines/ID1/company-switch': 400,
  'POST /office/leave': 400,
  'PUT /office/packages/CODE1/custom-prices/LOGIN1': 400,
  'PUT /office/packages/CODE1/line-prices': 400,
  'PUT /office/users/LOGIN1/ops': 400,
  'PUT /office/users/LOGIN1/packages': 400,
  'PUT /office/users/LOGIN1/packages/CODE1': 400,
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
