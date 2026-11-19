import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { apiTestApp } from './api-test-app';
import { GRANT_CODES } from '../access/grants';
import { ROUTES } from './routes';

// Who gets past the gate of each resource route (improvement 2, spec 2026-11-08-sorting-permissions-api-guards.md).
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
  ['GET /v1/audit', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /v1/audit/export', 'yyyyyy'], // the log's own filter, as a CSV
  ['GET /v1/postpaid/companies', 'yyynnn'],
  ['POST /v1/postpaid/companies', 'ynynnn'], // spec 2026-11-09-admin-review, 3: owner or edit grant
  ['PUT /v1/postpaid/companies/CODE1/sim', 'ynynnn'],
  ['PUT /v1/postpaid/companies/CODE1/image', 'ynynnn'], // review 2026-11-10, S11: owner or edit grant
  ['GET /v1/directory', 'yyyyyy'],
  ['GET /v1/finance', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /v1/finance/export', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /v1/finance/summary', 'yyyyyy'],
  ['GET /v1/finance/profits', 'yyyyyy'],
  ['GET /v1/finance/profits/export', 'yyyyyy'],
  ['POST /v1/handoff', 'yyyyyy'], // no session needed: judged by the one-time code, covered by its domain spec
  ['GET /v1/home', 'yyyyyy'],
  ['GET /v1/offers', 'ynynnn'],
  ['POST /v1/offers', 'ynynnn'],
  ['GET /v1/offers/live', 'yyyyyy'],
  ['PATCH /v1/offers/ID1', 'ynynnn'],
  ['DELETE /v1/offers/ID1', 'ynynnn'],
  ['POST /v1/offers/ID1/move', 'ynynnn'],
  ['GET /v1/overview', 'yyyyyy'], // every layer; the providers card only for the branch with reports or accounting
  ['POST /v1/leave', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/ledger', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /v1/postpaid/lines', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /v1/postpaid/lines', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/postpaid/lines/ID1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/addon', 'yyyyyy'], // judged after the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/charge', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/company-switch', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/disconnect', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/postpaid/lines/ID1/disconnect-quote', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/esim', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/extend', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/freeze', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/reactivate', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/refresh', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/rename', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/sim', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/switch', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/transfer', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/lines/ID1/unfreeze', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/me', 'yyyyyy'],
  ['GET /v1/notices', 'yyyyyy'],
  ['POST /v1/notices/read', 'yyyyyy'],
  ['GET /v1/postpaid/packages', 'yyyyyy'],
  ['POST /v1/postpaid/packages', 'ynynnn'],
  ['PATCH /v1/postpaid/packages/CODE1/chain', 'ynynnn'],
  ['PATCH /v1/postpaid/packages/CODE1/details', 'ynynnn'],
  ['PUT /v1/postpaid/packages/CODE1/durations', 'ynynnn'],
  ['DELETE /v1/postpaid/packages/CODE1/durations/ID1', 'ynynnn'],
  ['GET /v1/postpaid/packages/CODE1/addons', 'yyynnn'],
  ['POST /v1/postpaid/packages/CODE1/addons', 'ynynnn'],
  ['PATCH /v1/postpaid/packages/CODE1/addons/ID1', 'ynynnn'],
  ['DELETE /v1/postpaid/packages/CODE1/addons/ID1', 'ynynnn'],
  ['GET /v1/postpaid/packages/CODE1/custom-prices', 'yyynnn'],
  ['DELETE /v1/postpaid/packages/CODE1/custom-prices/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /v1/postpaid/packages/CODE1/custom-prices/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/postpaid/packages/CODE1/hidden-accounts', 'yyynnn'],
  ['GET /v1/postpaid/packages/CODE1/line-accounts', 'yyynnn'],
  ['GET /v1/postpaid/packages/CODE1/line-prices', 'yyyyyn'],
  ['PUT /v1/postpaid/packages/CODE1/line-prices', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PATCH /v1/postpaid/packages/CODE1/mode', 'ynynnn'],
  ['PUT /v1/postpaid/packages/CODE1/renewals', 'ynynnn'],
  ['GET /v1/postpaid/packages/CODE1/sheet', 'yyynnn'],
  ['PUT /v1/postpaid/packages/CODE1/switches', 'ynynnn'],
  ['GET /v1/provider-accounts', 'ynynnn'],
  ['GET /v1/provider-accounts/CODE1', 'ynynnn'],
  ['PATCH /v1/provider-accounts/CODE1/credit', 'ynynnn'],
  ['PATCH /v1/provider-accounts/CODE1/matching', 'ynynnn'],
  ['POST /v1/provider-accounts/CODE1/simulate-statement', 'ynynnn'],
  ['POST /v1/provider-accounts/CODE1/entries', 'ynynnn'],
  ['GET /v1/provider-accounts/CODE1/export', 'ynynnn'],
  ['GET /v1/provider-accounts/CODE1/reconciliations', 'ynynnn'],
  ['POST /v1/provider-accounts/CODE1/reconciliations', 'ynynnn'],
  ['POST /v1/provider-accounts/CODE1/statements/preview', 'ynynnn'],
  ['PATCH /v1/reconciliation-items/ID1', 'ynynnn'],
  ['GET /v1/reconciliations/ID1', 'ynynnn'],
  ['GET /v1/provider-operations', 'ynynnn'],
  ['POST /v1/provider-operations/ID1/charge', 'yyynnn'], // spec DB.5 P.9: the branch, with the grant the manual deduction asks (accounting not checked, see spec)
  ['GET /v1/providers', 'yyynnn'],
  ['PATCH /v1/providers/CODE1/esim-price', 'ynynnn'],
  ['GET /v1/postpaid/providers/CODE1/catalog/companies', 'ynynnn'],
  ['GET /v1/postpaid/providers/CODE1/catalog/products', 'ynynnn'],
  ['GET /v1/providers/CODE1/settings', 'yyynnn'],
  // ADR 0019, D18: a provider's dispatch switch is the branch owner's alone, whatever grants an employee holds.
  ['GET /v1/providers/CODE1/dispatch', 'ynnnnn'],
  ['POST /v1/providers/CODE1/dispatch/approve', 'ynnnnn'],
  ['POST /v1/providers/CODE1/dispatch/pause', 'ynnnnn'],
  ['POST /v1/providers/CODE1/dispatch/resume', 'ynnnnn'],
  ['PUT /v1/providers/CODE1/dispatch/credential', 'ynnnnn'],
  ['PATCH /v1/providers/CODE1/settings', 'ynynnn'],
  ['GET /v1/reports/providers', 'ynynnn'],
  ['GET /v1/reports/operations', 'ynynnn'],
  ['GET /v1/reports/balances/export', 'yyyyyy'],
  ['GET /v1/reports/supply/export', 'ynynnn'],
  ['GET /v1/reports/balances', 'yyyyyy'],
  ['GET /v1/reports/supply', 'ynynnn'],
  ['GET /v1/roles', 'ynnnnn'],
  ['POST /v1/roles', 'ynnnnn'],
  ['PUT /v1/roles/ID1', 'ynnnnn'],
  ['DELETE /v1/postpaid/sell-prices/CODE1', 'nnnyyn'],
  ['PUT /v1/postpaid/sell-prices/CODE1', 'nnnyyn'],
  // Spec 2026-11-17-system-monitor, D1: the request log is the branch owner's alone, whatever grants staff hold.
  ['GET /v1/system/requests', 'ynnnnn'],
  ['GET /v1/system/requests/summary', 'ynnnnn'],
  ['DELETE /v1/system/requests', 'ynnnnn'],
  ['GET /v1/system/errors', 'ynnnnn'],
  ['GET /v1/system/status', 'ynnnnn'],
  ['DELETE /v1/system/errors', 'ynnnnn'],
  ['GET /v1/system/alerts', 'ynnnnn'], // system monitor M.6: the branch owner alone (D1)
  ['POST /v1/system/alerts/ID1/seen', 'ynnnnn'],
  ['DELETE /v1/system/alerts', 'ynnnnn'],
  ['GET /v1/system/versions', 'ynnnnn'], // system monitor M.11: the branch owner alone (D1)
  ['POST /v1/system/versions/check', 'ynnnnn'],
  ['GET /v1/tasks', 'yyyyyy'], // read/accounting not checked (see spec)
  ['GET /v1/tasks/counts', 'yyyyyy'], // the list's own visibility (speed PF.5): who may list may count
  ['GET /v1/tasks/ID1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/tasks/ID1/cancel', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/postpaid/tasks/ID1/complete', 'ynynnn'],
  ['POST /v1/tasks/ID1/notes', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  // ADR 0019, D15: the branch owner, or a branch account holding `accounting`; nobody below the branch.
  ['GET /v1/postpaid/provider-decisions', 'ynynnn'], // the same gate as a decision: what waits, with its evidence
  ['GET /v1/postpaid/tasks/ID1/provider-decision', 'ynynnn'],
  ['POST /v1/postpaid/tasks/ID1/provider-decision', 'ynynnn'],
  ['POST /v1/postpaid/tasks/ID1/provider-decision/approval', 'ynynnn'],
  ['POST /v1/tasks/ID1/reject', 'ynynnn'],
  ['POST /v1/tasks/ID1/release', 'ynynnn'],
  ['POST /v1/tasks/ID1/take', 'ynynnn'],
  ['GET /v1/users', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /v1/users', 'ynyyyn'], // review 2026-11-10, S11: in the branch, owner or edit (staff: owner or staff grant)
  ['DELETE /v1/users/LOGIN1', 'ynynnn'], // staff or edit, then 404 for a login that is not there
  ['GET /v1/users/LOGIN1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PATCH /v1/users/LOGIN1/access', 'ynnnnn'],
  ['POST /v1/users/LOGIN1/enter', 'ynynnn'],
  ['POST /v1/users/LOGIN1/freeze', 'ynynnn'],
  ['GET /v1/postpaid/users/LOGIN1/ops', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /v1/postpaid/users/LOGIN1/ops', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/postpaid/users/LOGIN1/packages', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /v1/postpaid/users/LOGIN1/packages', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['PUT /v1/postpaid/users/LOGIN1/packages/CODE1', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/users/LOGIN1/password', 'ynyyyn'], // review 2026-11-10, S3: in the branch, owner or staff grant
  ['POST /v1/users/LOGIN1/restore', 'ynynnn'],
  ['POST /v1/users/LOGIN1/transfer', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['GET /v1/users/LOGIN1/transfer-preview', 'ynyyyn'],
  ['PATCH /v1/wallets/LOGIN1/ceiling', 'yyyyyy'], // read/accounting not checked (see spec)
  ['POST /v1/wallets/LOGIN1/deduct', 'yyyyyy'], // judged after the body or the lookup: covered by its domain spec
  ['POST /v1/wallets/LOGIN1/fund', 'yyyyyy'], // read/accounting not checked (see spec)
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
      apps[actor.id] = { app: (await apiTestApp(store, tables(actor.id))).app, sid };
    }
  });

  afterAll(async () => {
    for (const entry of Object.values(apps)) await entry?.app.close();
  });

  it('has a row for every route but the stream', () => {
    const served = ROUTES.map(([method, path]) => `${method} ${path}`).filter((key) => !key.endsWith('/stream'));
    expect(EXPECTED.map(([route]) => route).sort()).toEqual(served.sort());
  });

  const matrixRow = async (method: string, path: string) => {
    const got: string[] = [];
    for (const column of COLUMNS) {
      const { app, sid } = apps[column]!;
      const call = request(app.getHttpServer())[method.toLowerCase() as 'get'](path).set('Cookie', `sid=${sid}`);
      const response = method === 'GET' ? await call : await call.send({ msisdn: '0550000001', loginName: 'newone' });
      expect([401, 500]).not.toContain(response.status);
      got.push(response.status === 403 ? 'n' : 'y');
    }
    return got.join('');
  };

  it.each(EXPECTED)('%s → %s', async (route, access) => {
    const [method, path] = route.split(' ');
    expect(await matrixRow(method, path)).toBe(access);
  });
});
