import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';
import { GRANT_CODES } from './office-grants';
import { ROUTES } from './testing/office-routes';

// Who gets past the gate of each office route (improvement 2, spec 2026-11-08-sorting-permissions-api-guards.md).
// Six accounts call every route over tables that hold only the caller: `y` = the route lets this account through
// its permission check (any answer but 401/403/500; with no data it is usually 400 or 404), `n` = 403 before it
// reads anything. Columns: branch owner, branch staff with no grant, branch staff with every grant, main agent,
// agent, point of sale (each layer with its default grants). A change of who may call a route changes a row here.
// The stream is left out (it never ends).

jest.setTimeout(60_000);

const COLUMNS = ['owner', 'staff0', 'staffall', 'main', 'agent', 'pos'] as const;

// The rows marked "read/accounting not checked" are open to a branch staff member with no grant today: the API
// never checks the `read` or `accounting` grants. Owner decision (ADR 0006): left as is until the staff roles are
// defined; enforcing the grants then changes these rows on purpose.
const EXPECTED: [route: string, access: string][] = [
  ['POST /office/announcements', 'yyyyyn'],
  ['GET /office/audit', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /office/companies', 'yyynnn'],
  ['PUT /office/companies/CODE1/sim', 'ynynnn'],
  ['POST /office/companies/image', 'yyynnn'],
  ['GET /office/directory', 'yyyyyy'],
  ['GET /office/finance', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /office/finance/export', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /office/finance/summary', 'yyyyyy'],
  ['GET /office/finance/profits', 'yyyyyy'],
  ['GET /office/finance/profits/export', 'yyyyyy'],
  ['GET /office/home', 'yyyyyy'],
  ['POST /office/leave', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/ledger/SCOPE1', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /office/lines', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /office/lines', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/lines/ID1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/charge', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/company-switch', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/disconnect', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/lines/ID1/disconnect-quote', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/esim', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/extend', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/freeze', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/reactivate', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/refresh', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/rename', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/sim', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/switch', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/transfer', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/lines/ID1/unfreeze', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/me', 'yyyyyy'],
  ['GET /office/notices', 'yyyyyy'],
  ['POST /office/notices/read', 'yyyyyy'],
  ['GET /office/packages', 'yyyyyy'],
  ['PATCH /office/packages/CODE1/chain', 'ynynnn'],
  ['GET /office/packages/CODE1/custom-prices', 'yyynnn'],
  ['DELETE /office/packages/CODE1/custom-prices/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /office/packages/CODE1/custom-prices/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/packages/CODE1/line-prices', 'yyyyyn'],
  ['PUT /office/packages/CODE1/line-prices', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PATCH /office/packages/CODE1/mode', 'ynynnn'],
  ['PUT /office/packages/CODE1/renewals', 'ynynnn'],
  ['GET /office/packages/CODE1/sheet', 'yyynnn'],
  ['PUT /office/packages/CODE1/switches', 'ynynnn'],
  ['GET /office/provider-operations', 'ynynnn'],
  ['GET /office/providers', 'yyynnn'],
  ['PATCH /office/providers/CODE1/esim-price', 'ynynnn'],
  ['GET /office/providers/CODE1/settings', 'yyynnn'],
  ['PATCH /office/providers/CODE1/settings', 'ynynnn'],
  ['GET /office/reports/KIND1', 'ynynnn'],
  ['GET /office/reports/KIND1/export', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/reports/balances', 'yyyyyy'],
  ['GET /office/reports/orders', 'yyyyyy'],
  ['GET /office/reports/sales', 'yyyyyy'],
  ['GET /office/reports/supply', 'ynynnn'],
  ['GET /office/roles', 'ynnnnn'],
  ['POST /office/roles', 'ynnnnn'],
  ['DELETE /office/sell-prices/CODE1', 'nnnyyn'],
  ['PUT /office/sell-prices/CODE1', 'nnnyyn'],
  ['GET /office/tasks', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /office/tasks/ID1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/tasks/ID1/cancel', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/tasks/ID1/complete', 'ynynnn'],
  ['POST /office/tasks/ID1/notes', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/tasks/ID1/reject', 'ynynnn'],
  ['POST /office/tasks/ID1/release', 'ynynnn'],
  ['POST /office/tasks/ID1/take', 'ynynnn'],
  ['GET /office/users', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /office/users', 'yyyyyn'],
  ['DELETE /office/users/LOGIN1', 'nnnnnn'],
  ['GET /office/users/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PATCH /office/users/LOGIN1/access', 'ynnnnn'],
  ['POST /office/users/LOGIN1/enter', 'ynynnn'],
  ['POST /office/users/LOGIN1/freeze', 'nnnnnn'],
  ['GET /office/users/LOGIN1/ops', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /office/users/LOGIN1/ops', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/users/LOGIN1/packages', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /office/users/LOGIN1/packages', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /office/users/LOGIN1/packages/CODE1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/users/LOGIN1/password', 'yyyyyn'],
  ['POST /office/users/LOGIN1/restore', 'nnnnnn'],
  ['POST /office/users/LOGIN1/transfer', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /office/users/LOGIN1/transfer-preview', 'ynyyyn'],
  ['GET /office/wallets', 'yyyyyy'], // read/accounting not checked (see spec)
  ['PATCH /office/wallets/LOGIN1/ceiling', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /office/wallets/LOGIN1/deduct', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /office/wallets/LOGIN1/fund', 'yyyyyy'], // read/accounting not checked (see spec)
];

const ACTORS: { id: (typeof COLUMNS)[number]; layer: string; isBranchOwner: boolean; liveGrants: string }[] = [
  { id: 'owner', layer: 'branch', isBranchOwner: true, liveGrants: '' },
  { id: 'staff0', layer: 'branch', isBranchOwner: false, liveGrants: '' },
  { id: 'staffall', layer: 'branch', isBranchOwner: false, liveGrants: GRANT_CODES.join(',') },
  { id: 'main', layer: 'main_agent', isBranchOwner: false, liveGrants: 'read,edit,transferLines,transferPos,transferAgents' },
  { id: 'agent', layer: 'agent', isBranchOwner: false, liveGrants: 'read,edit,transferLines,transferPos' },
  { id: 'pos', layer: 'pos', isBranchOwner: false, liveGrants: 'read' },
];

function tables(actorId: string) {
  const model = (name: string) => new Proxy({}, {
    get: (_t, method: string) => async (args?: { where?: { id?: string } }) => {
      if (name === 'user' && method === 'findUnique' && args?.where?.id === actorId) {
        const a = ACTORS.find((row) => row.id === actorId)!;
        return { id: a.id, loginName: a.id, nickname: a.id, isBranchOwner: a.isBranchOwner, liveGrants: a.liveGrants, parentId: null, disabledAt: null };
      }
      if (method.startsWith('findMany') || method === 'groupBy') return [];
      if (method === 'count') return 0;
      if (method === 'aggregate') return { _sum: {}, _count: 0 };
      if (method.startsWith('find')) return null;
      return {};
    },
  });
  return new Proxy({}, {
    get: (_t, key: string) => {
      if (key === '$transaction') return async (run: unknown) => (typeof run === 'function' ? run(tables(actorId)) : []);
      if (key === '$queryRaw' || key === '$executeRaw') return async () => [];
      if (key === 'then') return undefined;
      return model(key);
    },
  });
}

describe('office permission matrix', () => {
  const apps: Partial<Record<(typeof COLUMNS)[number], { app: INestApplication; sid: string }>> = {};

  beforeAll(async () => {
    for (const actor of ACTORS) {
      const store = new MemoryAuthStore();
      for (const a of ACTORS) {
        store.addUser({
          id: a.id, loginName: a.id, nickname: a.id, disabledAt: null, mustChangePassword: false, layer: a.layer as 'branch',
          twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: a.isBranchOwner, passwordHash: 'x',
        });
      }
      const sid = await store.saveSession({ userId: actor.id, scope: 'full', userAgent: '', ip: '' });
      apps[actor.id] = { app: (await officeTestApp(store, tables(actor.id))).app, sid };
    }
  });

  afterAll(async () => {
    for (const entry of Object.values(apps)) await entry?.app.close();
  });

  it('has a row for every route but the stream', () => {
    const served = ROUTES.map(([method, path]) => `${method} ${path}`).filter((key) => !key.endsWith('/stream'));
    expect(EXPECTED.map(([route]) => route).sort()).toEqual(served.sort());
  });

  it.each(EXPECTED)('%s → %s', async (route, access) => {
    const [method, path] = route.split(' ');
    const got: string[] = [];
    for (const column of COLUMNS) {
      const { app, sid } = apps[column]!;
      const call = request(app.getHttpServer())[method.toLowerCase() as 'get'](path).set('Cookie', `sid=${sid}`);
      const response = method === 'GET' ? await call : await call.send({ msisdn: '0550000001', loginName: 'newone' });
      expect([401, 500]).not.toContain(response.status);
      got.push(response.status === 403 ? 'n' : 'y');
    }
    expect(got.join('')).toBe(access);
  });
});
