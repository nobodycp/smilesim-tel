// Dumps the normalised markup of every office page, with the API answered from fixtures.
// It is a refactoring check, not a test: run it before and after a change and diff the two folders.
//
//   node tests/dom-snapshot.mjs <outDir> [origin]
//
// With SHOTS=<dir> it also writes a full-page screenshot of every case there, for a before/after comparison.
// ONLY=a,b limits the run to the named cases; CHROMIUM=<path> picks the browser executable.
//
// The origin defaults to the Playwright dev server, http://admin.localhost:3910 (start it with `npm run dev`
// style env: NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_API_URL=http://localhost:3911 next dev -p 3910).
// Every call under /api is intercepted in the browser, so nothing reaches a real backend.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const origin = process.argv[3] ?? 'http://admin.localhost:3910';
if (!out) throw new Error('usage: node tests/dom-snapshot.mjs <outDir> [origin]');
mkdirSync(out, { recursive: true });

const me = (layer) => ({
  loginName: layer === 'pos' ? 'pos' : 'admin',
  nickname: layer === 'pos' ? 'الكاشير' : 'الإدارة',
  layer,
  isBranchOwner: layer === 'branch',
  grants: ['edit', 'reports', 'staff'],
  impersonating: false,
  balance: 1000,
  ceiling: 0,
});

const line = (n, status, extra = {}) => ({
  id: `ln${n}`, msisdn: `055${String(n).padStart(7, '0')}`, iccid: n % 2 ? '8997201' : null, esim: n % 2 === 0, status,
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم', posLogin: 'pos', posPrice: 26,
  createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z', ...extra,
});
const lines = [line(1, 'active'), line(2, 'frozen'), line(3, 'disconnected')];
const pack = (code, name, extra = {}) => ({
  code, name, providerName: 'مزود', companyName: 'سلكوم', dataGb: 400, months: 1, branchCost: 20, mainPrice: 22,
  agentPrice: 24, posPrice: 26, subscriberPrice: 30, editableField: null, autoActivate: true, autoCharge: true,
  autoDisconnect: false, autoFreeze: false, autoSwitch: false, ...extra,
});
const packages = [pack('cell-400', '400 جيجا', { editableField: 'pos' }), pack('cell-1000', '1000 جيجا')];
const provider = {
  code: 'cell', name: 'مزود',
  companies: [{ name: 'سلكوم', image: '', packages: [
    { code: 'cell-400', name: '400 جيجا', dataGb: 400, months: 1, price: 20, enabled: true },
    { code: 'cell-1000', name: '1000 جيجا', dataGb: 1000, months: 1, price: 40, enabled: false },
  ] }],
};
const task = (id, status) => ({
  id, status, action: 'activate', packageName: '400 جيجا', msisdn: '0550000001', posLogin: 'pos', posDelta: -26,
  log: 'سجل', note: 'ملاحظة', resultNote: '', canTake: status === 'pending', canWork: status === 'working', canCancel: status === 'pending',
});
const ledger = (id) => ({
  id, at: '2026-10-02T10:30:00.000Z', kind: 'extend', amount: -26, balanceBefore: 100, balanceAfter: 74, note: null,
  packageName: '400 جيجا', msisdn: '0550000001', actorLogin: 'pos',
});
const finance = (id) => ({
  id, at: '2026-10-02T10:30:00.000Z', loginName: 'pos', layer: 'pos', actorLogin: 'admin', kind: 'charge',
  amount: -26, balanceBefore: 100, balanceAfter: 74, msisdn: '0550000001', companyName: 'سلكوم',
  packageName: '400 جيجا', packagePrice: 26, note: '',
});
const audit = (id) => ({
  id, action: 'extend', status: 'done', at: '2026-10-02T10:30:00.000Z', msisdn: '0550000001', companyName: 'سلكوم',
  packageName: '400 جيجا', providerName: 'مزود', actorName: 'الكاشير',
});
const users = [
  { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', roleName: '', parentLogin: null, balance: 1000, ceiling: 0, frozen: false, self: true, directChild: false, canEnter: false, canFreeze: false, canDelete: false },
  { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', roleName: '', parentLogin: 'admin', balance: 50, ceiling: 500, frozen: false, self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true },
  { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', roleName: '', parentLogin: 'main1', balance: 10, ceiling: 100, frozen: true, self: false, directChild: false, canEnter: true, canFreeze: true, canDelete: false },
];
const roles = [{ id: 'r1', name: 'محاسب', read: true, edit: false, accounting: true, tasks: false, reports: true, staff: false, enter: false }];
const sheet = {
  code: 'cell-400', name: '400 جيجا', providerCode: 'cell', providerName: 'مزود', companyName: 'سلكوم', enabled: true,
  branchCost: 20, mainPrice: 22, agentPrice: 24, posPrice: 26, subscriberPrice: 30, modes: { activate: 'auto', charge: 'manual' },
  offers: [{ loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', price: 21 }],
};
const home = {
  pendingTasks: 2, activeLines: 5, inactiveLines: 1, canPost: true,
  operations: [{ id: 'o1', at: '2026-10-02T10:30:00.000Z', kind: 'extend', amount: -26, note: null, loginName: 'pos' }],
  announcements: [{ id: 'a1', body: 'إعلان', at: '2026-10-02T10:30:00.000Z', authorName: 'الإدارة', authorLayer: 'branch' }],
};
const reports = {
  providers: { rows: [{ providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', price: 20, lines: 4 }] },
  tasks: { tasks: [task('t1', 'done')], nextCursor: null },
  numbers: { lines, nextCursor: 'c2' },
  operations: { entries: [{ id: 'e2', at: '2026-10-02T10:30:00.000Z', loginName: 'pos', actorLogin: 'admin', kind: 'activate', amount: -26, balanceAfter: 74, note: 'ن' }] },
};

// What each office endpoint answers. `empty` swaps the lists for empty ones.
function answer(path, layer, empty) {
  const list = (rows) => (empty ? [] : rows);
  if (path === '/office/me') return me(layer);
  if (path === '/office/notices') return { unread: 0, notices: [] };
  if (path === '/office/home') return home;
  if (path === '/office/lines') return { lines: list(lines), poses: [{ loginName: 'pos', nickname: 'الكاشير' }], nextCursor: empty ? null : 'c2' };
  if (path.startsWith('/office/lines/')) return { line: lines[0], history: [{ id: 'h1', action: 'extend', at: '2026-10-02T10:30:00.000Z', msisdn: '0550000001', companyName: 'سلكوم', packageName: '400 جيجا', actorName: 'الكاشير' }] };
  if (path === '/office/packages') return { packages: list(packages), companies: [{ name: 'سلكوم', image: '' }] };
  if (path.endsWith('/sheet')) return sheet;
  if (path === '/office/providers') return { providers: [provider] };
  if (path === '/office/tasks') return { tasks: list([task('t1', 'pending'), task('t2', 'working'), task('t3', 'done')]), nextCursor: empty ? null : 'c2' };
  if (path === '/office/users') return { users: list(users) };
  if (path === '/office/roles') return { roles: list(roles) };
  if (path === '/office/audit') return { entries: list([audit('a1'), audit('a2')]), nextCursor: empty ? null : 'c2' };
  if (path === '/office/finance') return { entries: list([finance('c1'), finance('c2')]), nextCursor: empty ? null : 'c2' };
  if (path === '/office/provider-operations') return {
    entries: list([{
      id: 'p1', at: '2026-10-02T10:30:00.000Z', kind: 'charge', msisdn: '0550000001',
      providerCode: 'cell', providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', cost: 20,
    }]),
    nextCursor: empty ? null : 'c2',
    stats: empty ? { count: 0, cost: 0, monthCost: 0 } : { count: 1, cost: 20, monthCost: 20 },
    providers: [{ code: 'cell', name: 'مزود' }],
  };
  if (path.startsWith('/office/ledger/')) return { entries: list([ledger('l1'), ledger('l2')]), nextCursor: empty ? null : 'c2' };
  if (path.startsWith('/office/reports/')) {
    const body = reports[path.split('/').pop()];
    return empty ? { ...body, rows: body.rows && [], entries: body.entries && [], lines: body.lines && [], tasks: body.tasks && [], nextCursor: null } : body;
  }
  return null;
}

const cases = [
  ['home', '/', 'branch'],
  ['finance', '/finance', 'branch'],
  ['provider-operations', '/provider-operations', 'branch'],
  ['provider-operations-empty', '/provider-operations', 'branch', true],
  ['finance-empty', '/finance', 'branch', true],
  ['audit', '/audit', 'branch'],
  ['audit-empty', '/audit', 'branch', true],
  ['operations', '/operations', 'branch'],
  ['operations-empty', '/operations', 'branch', true],
  ['numbers', '/numbers', 'branch'],
  ['numbers-pos', '/numbers', 'pos'],
  ['numbers-empty', '/numbers', 'branch', true],
  ['number-card', '/numbers/ln1', 'branch'],
  ['tasks', '/tasks', 'branch'],
  ['tasks-empty', '/tasks', 'branch', true],
  ['roles', '/roles', 'branch'],
  ['roles-empty', '/roles', 'branch', true],
  ['users', '/users', 'branch'],
  ['packages', '/packages', 'branch'],
  ['packages-pos', '/packages', 'pos'],
  ['providers', '/providers', 'branch'],
  ['provider', '/providers/cell', 'branch'],
  ['package-sheet', '/providers/cell/cell-400', 'branch'],
  ['report-providers', '/reports/providers', 'branch'],
  ['report-tasks', '/reports/tasks', 'branch'],
  ['report-tasks-empty', '/reports/tasks', 'branch', true],
  ['report-numbers', '/reports/numbers', 'branch'],
  ['report-numbers-empty', '/reports/numbers', 'branch', true],
  ['report-operations', '/reports/operations', 'branch'],
];
const only = process.env.ONLY?.split(',');

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [name, path, layer, empty = false] of cases) {
  if (only && !only.includes(name)) continue;
  const host = origin.replace('//admin.', layer === 'pos' ? '//pos.' : '//admin.');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const body = answer(url.pathname.replace(/^\/api/, ''), layer, empty);
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { message: 'none' }),
    });
  });
  await page.goto(`${host}${path}`);
  await page.waitForSelector('.canvas-inner');
  await page.waitForFunction(() => !document.querySelector('.canvas-inner .skeleton, .canvas-inner .loading-well'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  if (process.env.SHOTS) {
    mkdirSync(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`) });
  }
  const html = await page.evaluate(() => document.querySelector('.canvas-inner')?.innerHTML ?? '');
  const pretty = html
    .replace(/ id="[^"]*"/g, '')
    .replace(/ style=""/g, '')
    .replace(/></g, '>\n<');
  writeFileSync(join(out, `${name}.html`), `${pretty}\n`);
  await page.close();
}
await browser.close();
console.log('snapshots written to', out);
