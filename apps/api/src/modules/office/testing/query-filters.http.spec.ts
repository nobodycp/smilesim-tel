import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { emptyTables } from './empty-tables';
import { officeTestApp } from './office-test-app';
import { hashOnce } from './test-hash';
import { AuditQuery } from '../../auditing/audit.schemas';
import { LinesQuery } from '../lines/lines.schemas';
import { NoticesQuery } from '../../notifications/notices.schemas';
import { TasksQuery } from '../tasks/tasks.schemas';
import { FinanceQuery, ProviderOperationsQuery } from '../wallets/wallets.schemas';

// A query is parsed by a schema, like a body (backend-engineering.mdc 4.1; plan backend-loose-ends A.4): a filter
// with a value outside its set is 400 INVALID, where it used to be dropped and the list came back unfiltered; a
// parameter the route does not name is ignored. Called as the branch owner over empty tables.

const REFUSED: [path: string, why: string][] = [
  ['/office/lines?status=bogus', 'a status that is not one'],
  ['/office/lines?status=active&status=frozen', 'a filter sent twice'],
  ['/office/tasks?status=open', 'a task status that is not one'],
  ['/office/tasks?action=explode', 'an operation that is not one'],
  ['/office/notices?group=everything', 'a group that is not one'],
  ['/office/notices?unread=yes', 'a switch that is neither on nor off'],
  ['/office/users?layer=staff', 'a layer that is not one'],
  ['/office/directory?mine=maybe', 'a switch that is neither on nor off'],
  ['/office/audit?action=nothing', 'an action the log never writes'],
  ['/office/audit?from=yesterday', 'a day that is not a date'],
  ['/office/finance?kind=gift', 'a kind no entry carries'],
  ['/office/finance?scope=everything', 'a scope that is not one'],
  ['/office/finance/export?layer=moon', 'a layer that is not one'],
  ['/office/finance/summary?days=5', 'a window the summary does not offer'],
  ['/office/finance/profits?to=never', 'a day that is not a date'],
  ['/office/ledger?direction=sideways', 'a direction that is not one'],
  ['/office/provider-operations?match=maybe', 'a match state that is not one'],
  ['/office/provider-accounts/sky?from=soon', 'a day that is not a date'],
  ['/office/reports/balances?negative=2', 'a switch that is neither on nor off'],
  ['/office/reports/supply?from=x', 'a day that is not a date'],
  ['/office/overview?period=week', 'a period the home does not offer'],
];

const ACCEPTED = [
  '/office/lines?status=expiring&q=055&utm_source=mail',
  '/office/lines?status=&q=',
  '/office/tasks?status=working&action=activate&fbclid=1',
  '/office/notices?group=wallet&unread=1',
  '/office/users?layer=agent&q=a',
  '/office/directory?mine=1',
  '/office/audit?action=fund&result=fail&layer=pos&from=2026-11-01&to=2026-11-10&addresses=1',
  '/office/finance?kind=fund&layer=pos&scope=money&from=2026-11-01',
  '/office/finance/summary?days=90',
  '/office/ledger?kind=charge&direction=out',
  '/office/provider-operations?kind=activate&match=pending&provider=sky',
  '/office/reports/balances?layer=pos&negative=1',
  '/office/overview?period=day',
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
    ({ app } = await officeTestApp(store, emptyTables().tables));
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
    const anonymous = await request(app.getHttpServer()).get('/office/lines?status=bogus');
    expect(anonymous.status).toBe(401);
  });
});

// The web keeps the options of its filter selects in its own files (there is no shared package). Each list below
// is read from the screen that sends it and parsed by the schema of the route it goes to: a value the web can
// send and the API would refuse fails here, before a person meets it as an error on the screen.
const web = join(__dirname, '../../../../../web/features');
const describeWeb = existsSync(web) ? describe : describe.skip;

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
