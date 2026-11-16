import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { emptyTables } from './empty-tables';
import { apiTestApp } from './api-test-app';
import { hashOnce } from './test-hash';
import { AuditQuery } from '../auditing/audit.schemas';
import { LinesQuery } from '../sales/lines.schemas';
import { NoticesQuery } from '../notifications/notices.schemas';
import { TasksQuery } from '../tasks/tasks.schemas';
import { FinanceQuery } from '../wallets/wallets.schemas';
import { ProviderOperationsQuery } from '../providers/providers.schemas';

// A query is parsed by a schema, like a body (backend-engineering.mdc 4.1; plan backend-loose-ends A.4): a filter
// with a value outside its set is 400 INVALID, where it used to be dropped and the list came back unfiltered; a
// parameter the route does not name is ignored. Called as the branch owner over empty tables.

const REFUSED: [path: string, why: string][] = [
  ['/v1/lines?status=bogus', 'a status that is not one'],
  ['/v1/lines?status=active&status=frozen', 'a filter sent twice'],
  ['/v1/tasks?status=open', 'a task status that is not one'],
  ['/v1/tasks?action=explode', 'an operation that is not one'],
  ['/v1/notices?group=everything', 'a group that is not one'],
  ['/v1/notices?unread=yes', 'a switch that is neither on nor off'],
  ['/v1/users?layer=staff', 'a layer that is not one'],
  ['/v1/directory?mine=maybe', 'a switch that is neither on nor off'],
  ['/v1/audit?action=nothing', 'an action the log never writes'],
  ['/v1/audit?from=yesterday', 'a day that is not a date'],
  ['/v1/finance?kind=gift', 'a kind no entry carries'],
  ['/v1/finance?scope=everything', 'a scope that is not one'],
  ['/v1/finance/export?layer=moon', 'a layer that is not one'],
  ['/v1/finance/summary?days=5', 'a window the summary does not offer'],
  ['/v1/finance/profits?to=never', 'a day that is not a date'],
  ['/v1/ledger?direction=sideways', 'a direction that is not one'],
  ['/v1/provider-operations?match=maybe', 'a match state that is not one'],
  ['/v1/provider-accounts/sky?from=soon', 'a day that is not a date'],
  ['/v1/reports/balances?negative=2', 'a switch that is neither on nor off'],
  ['/v1/reports/supply?from=x', 'a day that is not a date'],
  ['/v1/overview?period=week', 'a period the home does not offer'],
];

const ACCEPTED = [
  '/v1/lines?status=expiring&q=055&utm_source=mail',
  '/v1/lines?status=&q=',
  '/v1/tasks?status=working&action=activate&fbclid=1',
  '/v1/notices?group=wallet&unread=1',
  '/v1/users?layer=agent&q=a',
  '/v1/directory?mine=1',
  '/v1/audit?action=fund&result=fail&layer=pos&from=2026-11-01&to=2026-11-10&addresses=1',
  '/v1/finance?kind=fund&layer=pos&scope=money&from=2026-11-01',
  '/v1/finance/summary?days=90',
  '/v1/ledger?kind=charge&direction=out',
  '/v1/provider-operations?kind=activate&match=pending&provider=sky',
  '/v1/reports/balances?layer=pos&negative=1',
  '/v1/overview?period=day',
];

describe('query filters', () => {
  let app: INestApplication;
  let session: string;

  beforeAll(async () => {
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'admin', loginName: 'admin', nickname: 'الإدارة', disabledAt: null, mustChangePassword: false, layer: 'branch',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: true, passwordHash: await hashOnce('ownerpass1'),
    });
    session = await store.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
    ({ app } = await apiTestApp(store, emptyTables().tables));
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', `sid=${session}`);

  it.each(REFUSED)('%s is refused: %s', async (path) => {
    const response = await get(path);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID' });
  });

  it.each(ACCEPTED)('%s is read', async (path) => {
    expect((await get(path)).status).toBe(200);
  });

  it('judges the session before the query', async () => {
    const anonymous = await request(app.getHttpServer()).get('/v1/lines?status=bogus');
    expect(anonymous.status).toBe(401);
  });
});

// The web keeps the options of its filter selects in its own files (there is no shared package). Each list below
// is read from the screen that sends it and parsed by the schema of the route it goes to: a value the web can
// send and the API would refuse fails here, before a person meets it as an error on the screen.
const web = join(__dirname, '../../../../web/features');
const describeWeb = existsSync(web) ? describe : describe.skip;

// This repository holds the web beside the API: the checks below must run here, not skip (slice R.9: a move of this
// folder made the path wrong and the checks skipped without a word).
it('finds the web app beside the API, so the checks against its filter lists run', () => {
  expect(existsSync(join(__dirname, '../../../../web/package.json'))).toBe(true);
  expect(existsSync(web)).toBe(true);
});

/** The strings of `const NAME = [ … ]` in a web file. */
function listOf(file: string, name: string): string[] {
  const source = readFileSync(join(web, file), 'utf8');
  const body = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)?.[1];
  if (body === undefined) throw new Error(`${file} has no list ${name}`);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describeWeb('the web sends only filter values the API accepts', () => {
  const cases: [file: string, list: string, schema: { safeParse: (value: unknown) => { success: boolean } }, key: string][] = [
    ['audit/screens/audit-screen.tsx', 'ACTIONS', AuditQuery, 'action'],
    ['audit/screens/audit-screen.tsx', 'LAYERS', AuditQuery, 'layer'],
    ['tasks/screens/tasks-screen.tsx', 'TASK_ACTIONS', TasksQuery, 'action'],
    ['tasks/screens/tasks-screen.tsx', 'TASK_STATUSES', TasksQuery, 'status'],
    ['lines/screens/numbers-screen.tsx', 'LINE_STATUSES', LinesQuery, 'status'],
    ['notices/screens/notices-screen.tsx', 'GROUPS', NoticesQuery, 'group'],
    ['wallets/screens/finance-screen.tsx', 'KINDS', FinanceQuery, 'kind'],
    ['wallets/screens/finance-screen.tsx', 'LAYERS', FinanceQuery, 'layer'],
    ['wallets/screens/provider-operations-screen.tsx', 'KINDS', ProviderOperationsQuery, 'kind'],
  ];

  it.each(cases)('%s %s', (file, list, schema, key) => {
    const values = listOf(file, list);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((value) => !schema.safeParse({ [key]: value }).success)).toEqual([]);
  });
});
