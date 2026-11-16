// Dumps the normalised markup and the computed styles of every screen, with the API answered from fixtures.
// It is a refactoring check, not a test: run it before and after a change and diff the two folders (CHK-ZERO in
// docs/superpowers/plans/2026-11-13-ui-maintenance.md).
//
//   node tests/dom-snapshot.mjs <outDir> [origin]
//
// The origin is the admin door of a running app (default http://admin.localhost:3000, the one dev copy); each case
// opens its own door (admin., main., agent. or pos.) on the same port. Every call under /api is answered in the
// browser from the fixtures below, so nothing reaches a real backend (the server-side branding read still does).
//
// Options (environment):
//   ONLY=a,b       the named cases only            CHROMIUM=<path>   the browser executable
//   THEME=dark     LOCALE=en|he                    the preference cookies (default light, ar)
//   WIDTH=<px>     the viewport width (default 1280; any value; a case may fix its own)
//   SHOTS=<dir>    a full-page screenshot of every case there
//   STYLES=1       <case>.styles.tsv: one row per element, `key \t style hash \t ::before hash \t ::after hash`
//                  (a pseudo hash is `-` when its `content` is none), sorted by key; <case>.paths.tsv maps each key
//                  to its DOM-index path, for reading only (CHK-ZERO diffs .styles.tsv and .states.tsv, not it)
//   STATES=1       <case>.states.tsv: a forced-state pass (see below)
//   CANARY_CSS=<file>        a stylesheet injected before hashing (guard canaries; no tracked file changes)
//   CANARY_REMOVE=<selector> the first match removed before hashing
//   LOG_API=1      print the /api paths no fixture answered (each gets a 404; silent without it)
//
// Every case freezes the page clock at 2026-11-13 09:00 (Asia/Jerusalem) and settles motion before every hash:
// running animations are finished (an infinite one, which cannot finish, is cancelled), then two animation frames
// pass, until none runs. Reduced motion is not emulated, so `animation-*` / `transition-*` stay in the hash with
// their end values, never an in-flight value. Before the first hash a case also waits until the page has asked
// /api for nothing for 300ms (a pager reads its next chunk after the first renders; a row landing mid-hash would
// be read mid-entrance), then settles again.
//
// Row keys are stable: an element's author id (generated React ids are ignored), else its parent's key plus
// `tag.class.chain:n`, n counted among siblings of the same tag and class chain. Removing one element therefore
// removes its rows only; it does not shift its later siblings.
//
// The forced-state pass forces `hover`, `focus` and `active` (CDP CSS.forcePseudoState; `focus` is forced as
// `:focus` and `:focus-visible` together, as a keyboard focus sets both) one state at a time, as a real pointer or
// focus would: the element's ancestors get `hover`, `active` or `focus-within` too. Targets are the elements that
// have a box and are (1) controls — button, a, input, select, textarea, [role=tab], [role=menuitem], .line-op,
// .co-card, .pick-card, .pack-pick, .filter-pop button — all three states; (2) `[tabindex]`, `summary`,
// `[contenteditable]` — `focus`; (3) any other element a state rule of the loaded sheets styles through that state
// on its own compound (`.stat:hover`, `.fact-grid > div:hover::after`, `.data tbody tr:hover td`,
// `.users-layer:focus-visible`: the selector up to that compound, states and pseudo-elements taken off, matches
// it) — the states those rules name. It then hashes the element's whole subtree with each
// node's pseudos in full; then the own row of every ancestor a state rule styles (`.x:hover`, `.x:focus-within`)
// and the whole subtree of every ancestor a state rule styles below it (`.x:hover .child`, `.x:focus-within .y`,
// `.x:has(:focus-visible) …`), each row listed where the state makes it differ from the rest state; and releases
// the state. Forcing a state
// fires no event, so the settle after it is synchronous (finish until none runs) and waits no frame.
// Rows: `target key \t state \t node key \t style hash \t ::before \t ::after`. A second pass hashes the elements
// already disabled (`:disabled`, `[aria-disabled=true]`, also under forced hover) and those carrying an aria
// state (`aria-expanded|pressed|selected|current|checked|invalid`).
//
// A case is [name, path, layer, empty, options]: layer `branch` | `main` | `agent` | `pos` (the door and the
// fixture session), or `bare` (the bare host with no door, where the layout draws the door chooser; no fixture
// answers there); `empty` swaps the lists for empty ones; options { wait, dump, width, steps } — `wait` the
// selector that means "drawn" (default .canvas-inner; [data-slot="auth"] for sign-in), `dump` the node whose markup goes to
// <case>.html (default `wait`), `steps` an open state reached before hashing: [{ click | mousedown: selector,
// wait?: selector }], dispatched as DOM events so no pointer stays over the page. An unknown option, step key or
// layer stops the run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const origin = process.argv[3] ?? 'http://admin.localhost:3000';
if (!out) throw new Error('usage: node tests/dom-snapshot.mjs <outDir> [origin]');
mkdirSync(out, { recursive: true });

const NOW = '2026-11-13T09:00:00+02:00';
const LAYERS = { branch: 'branch', main: 'main_agent', agent: 'agent', pos: 'pos' };
const HOSTS = { branch: 'admin', main: 'main', agent: 'agent', pos: 'pos', bare: '' };
const LOGINS = { branch: ['admin', 'الإدارة'], main: ['main1', 'رئيسي'], agent: ['agent1', 'وكيل'], pos: ['pos', 'الكاشير'] };

const me = (layer) => ({
  loginName: LOGINS[layer][0],
  nickname: LOGINS[layer][1],
  layer: LAYERS[layer],
  isBranchOwner: layer === 'branch',
  grants: ['edit', 'reports', 'staff'],
  stops: [],
  impersonating: false,
  balance: 1000,
  ceiling: layer === 'branch' ? 0 : 500,
});

const line = (n, status, extra = {}) => ({
  id: `ln${n}`, msisdn: `055${String(n).padStart(7, '0')}`, iccid: n % 2 ? '8997201' : null, esim: n % 2 === 0, status,
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم', posLoginName: 'pos', posPrice: 26,
  createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z', ...extra,
});
const lines = [line(1, 'active'), line(2, 'frozen'), line(3, 'disconnected')];
const pack = (code, name, extra = {}) => ({
  code, name, providerName: 'مزود', sellable: true, activateInput: 'generated', companyName: 'سلكوم', dataGb: 400, months: 1, branchCost: 20, mainPrice: 22,
  agentPrice: 24, posPrice: 26, subscriberPrice: 30, editableField: null, autoActivate: true, autoCharge: true,
  autoDisconnect: false, autoFreeze: false, autoSwitch: false, ...extra,
});
const packages = [pack('cell-400', '400 جيجا', { editableField: 'pos' }), pack('cell-1000', '1000 جيجا')];
// The main and agent doors are told their own sell price (the sell cells render only there): `editableField` is the
// field the door sets for the layer below it, as the API gives it (pricing/rules/prices.ts: main → 'agent',
// agent → 'pos'); without it the screen draws no `.sell-cell`.
const sellPack = (code, name, editableField) => pack(code, name, {
  editableField, branchCost: null, price: 22, renewalPrice: 22, canActivate: true, sellPrice: 25, sellRenewalPrice: 25, sellDefault: 24, sellRenewalDefault: 24,
});
const provider = {
  code: 'cell', name: 'مزود',
  companies: [{ name: 'سلكوم', image: '', packages: [
    { code: 'cell-400', name: '400 جيجا', dataGb: 400, months: 1, price: 20, enabled: true },
    { code: 'cell-1000', name: '1000 جيجا', dataGb: 1000, months: 1, price: 40, enabled: false },
  ] }],
};
const task = (id, status) => ({
  id, status, action: 'activate', packageName: '400 جيجا', msisdn: '0550000001', posLoginName: 'pos', posDelta: -26,
  createdAt: '2026-11-12T08:00:00.000Z', log: 'سجل', note: 'ملاحظة', resultNote: '', canTake: status === 'pending', canWork: status === 'working', canCancel: status === 'pending',
});
const ledger = (id) => ({
  id, at: '2026-10-02T10:30:00.000Z', kind: 'extend', amount: -26, balanceBefore: 100, balanceAfter: 74, note: null,
  packageName: '400 جيجا', msisdn: '0550000001', actorLoginName: 'pos',
});
const finance = (id) => ({
  id, at: '2026-10-02T10:30:00.000Z', loginName: 'pos', layer: 'pos', actorLoginName: 'admin', kind: 'charge',
  amount: -26, balanceBefore: 100, balanceAfter: 74, msisdn: '0550000001', companyName: 'سلكوم',
  packageName: '400 جيجا', packagePrice: 26, note: '',
});
const audit = (id) => ({
  id, action: 'extend', status: 'done', at: '2026-10-02T10:30:00.000Z', msisdn: '0550000001', companyName: 'سلكوم',
  packageName: '400 جيجا', providerName: 'مزود', actorName: 'الكاشير',
});
const users = [
  { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', roleName: '', parentLoginName: null, balance: 1000, ceiling: 0, frozen: false, self: true, directChild: false, canEnter: false, canFreeze: false, canDelete: false },
  { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', roleName: '', parentLoginName: 'admin', balance: 50, ceiling: 500, frozen: false, self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true },
  { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', roleName: '', parentLoginName: 'main1', balance: 10, ceiling: 100, frozen: true, self: false, directChild: false, canEnter: true, canFreeze: true, canDelete: false },
];
const roles = [{ id: 'r1', name: 'محاسب', read: true, edit: false, accounting: true, tasks: false, reports: true, staff: false, enter: false }];
const home = {
  pendingTasks: 2, openTasks: 3, activeLines: 5, inactiveLines: 1, expiringLines: 1,
  operations: [{ id: 'o1', at: '2026-10-02T10:30:00.000Z', kind: 'extend', amount: -26, note: null, loginName: 'pos' }],
};
const reports = {
  providers: { items: [{ providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', price: 20, lines: 4 }], nextCursor: null, total: 1 },
  operations: { items: [{ id: 'e2', at: '2026-10-02T10:30:00.000Z', loginName: 'pos', actorLoginName: 'admin', kind: 'activate', amount: -26, balanceAfter: 74, note: 'ن' }] },
  balances: {
    items: [
      { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', parentLoginName: 'admin', balance: 5000, ceiling: 50000, used: 0, held: 0, available: 55000, frozen: false, lastAt: '2026-11-12T08:00:00.000Z' },
      { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', parentLoginName: 'main1', balance: -2600, ceiling: 10000, used: 2600, held: 2600, available: 4800, frozen: true, lastAt: null },
    ],
    nextCursor: null, total: 2,
    totals: { balance: 2400, ceiling: 60000, used: 2600, held: 2600, available: 59800, debtors: 1, debt: 2600 },
  },
  supply: {
    rows: [{ providerCode: 'cell', providerName: 'مزود', operations: 12, cost: 24000, profit: 6000 }],
    totals: { operations: 12, cost: 24000, profit: 6000 }, capped: false,
  },
};

// Fixtures for the screens added in UI maintenance P1.1 (shapes from lib/api-types.ts).
const sim = { length: 10, prefix: '05', esim: true };
const shelf = {
  capped: false,
  companies: [{
    code: 'cell', name: 'سلكوم', image: '', sim, esimPrice: 500,
    providers: [{ code: 'cell', name: 'مزود', packages: [
      { code: 'cell-400', name: '400 جيجا', months: 1, dataGb: 400, smsCount: null, minutes: -1, branchCost: 2000, mainPrice: 2200, renewalBranchCost: 2000, renewalMainPrice: 2200, forSale: true, enabled: true, lines: 4, activeLines: 3, stoppedLines: 1 },
      { code: 'cell-1000', name: '1000 جيجا', months: 1, dataGb: 1000, smsCount: 100, minutes: null, branchCost: 4000, mainPrice: 4400, renewalBranchCost: 4000, renewalMainPrice: 4400, forSale: false, enabled: false, lines: 0, activeLines: 0, stoppedLines: 0 },
    ] }],
  }],
};
const packageSheet = {
  code: 'cell-400', name: '400 جيجا', providerCode: 'cell', providerName: 'مزود', companyCode: 'cell', companyName: 'سلكوم',
  enabled: true, forSale: true, dataGb: 400, suspendAfterDays: 90, esimAvailable: true, smsCount: null, minutes: -1, details: 'تفاصيل',
  months: 1, branchCost: 2000, mainPrice: 2200, agentPrice: 2400, posPrice: 2600, subscriberPrice: 3000,
  renewalBranchCost: 2000, renewalMainPrice: 2200, renewalAgentPrice: 2400, renewalPosPrice: 2600, renewalSubscriberPrice: 3000,
  esimPrice: null, esimPriceEffective: 500, esimPriceSource: 'company', lines: 4, activeLines: 3, renewals: ['cell-1000'], switches: [],
  modes: { activate: 'auto', charge: 'manual', disconnect: 'off', freeze: 'auto', switch: 'manual' },
  inheritedModes: ['freeze'], providerModes: { activate: 'auto', charge: 'manual', disconnect: 'off', freeze: 'auto', switch: 'manual' },
};
const customPrices = [
  { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', parentLoginName: 'admin', defaultPrice: 2200, defaultRenewalPrice: 2200, price: 2100, renewalPrice: null },
];
const account = {
  loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', parentLoginName: 'admin', frozen: false, isBranchOwner: false, staff: false,
  roleId: 'r1', roleName: 'محاسب', roleGrants: ['read'], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: ['read'],
  roles: [{ id: 'r1', name: 'محاسب', grants: ['read'] }], canEdit: true,
  listed: { ...users[1], held: 0 },
};
const userPackages = {
  summary: { total: 2, visible: 1, custom: 1 },
  companies: [{ code: 'cell', name: 'سلكوم', packages: [
    { code: 'cell-400', name: '400 جيجا', dataGb: 400, months: 1, companyCode: 'cell', hidden: false, hiddenAbove: null, parentBuy: 2000, parentRenewalBuy: 2000, price: 2100, renewalPrice: null, effective: 2100, renewalEffective: 2200, source: 'custom', lines: 3 },
    { code: 'cell-1000', name: '1000 جيجا', dataGb: 1000, months: 1, companyCode: 'cell', hidden: true, hiddenAbove: null, parentBuy: 4000, parentRenewalBuy: 4000, price: null, renewalPrice: null, effective: 4400, renewalEffective: 4400, source: 'layer', lines: 0 },
  ] }],
};
const taskDetail = {
  ...task('t1', 'pending'), submitterLoginName: 'pos', assigneeLoginName: null, companyName: 'سلكوم', providerName: 'مزود', lastNote: null,
  createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:30:00.000Z', iccid: '8997201', esim: false, esimQr: null, sim,
  lineStatus: null, operation: null, hold: 'held', canNote: true, canNoteInternal: true,
};
const taskEvents = [
  { id: 'e1', kind: 'system', body: 'فُتحت المهمة', authorName: null, at: '2026-11-12T08:00:00.000Z' },
  { id: 'e2', kind: 'note', internal: true, body: 'ملاحظة داخلية', authorName: 'الإدارة', at: '2026-11-12T08:20:00.000Z' },
];
const decision = {
  taskId: 't4', action: 'activate', msisdn: '0550000004', packageName: '400 جيجا', posLoginName: 'pos', submitterLoginName: 'pos',
  waitingSince: '2026-11-12T07:00:00.000Z', phase: 'unknown', reason: null, held: 2600, proposal: null,
  decisions: ['confirm-success', 'declare-failure'], canApprove: false, canRefuse: false, blocked: null,
};
const notices = [
  { id: 'n1', kind: 'task.done', payload: { taskId: 't3', action: 'activate', msisdn: '0550000003', packageName: '400 جيجا' }, actorName: 'الإدارة', href: '/tasks/t3', read: false, createdAt: '2026-11-13T06:00:00.000Z' },
  { id: 'n2', kind: 'wallet.funded', payload: { amount: 5000, senderName: 'الإدارة' }, actorName: 'الإدارة', href: '/wallet', read: true, createdAt: '2026-11-10T06:00:00.000Z' },
];
const summary = (layer) => ({
  balance: 100000, ceiling: layer === 'branch' ? 0 : 50000, held: 2600, unlimited: layer === 'branch', moneyIn: 50000, moneyOut: 26000, count: 4,
  profit: 1200, sales: 3, manual: 1, days: 30,
  series: [{ day: '2026-11-11', balance: 90000 }, { day: '2026-11-12', balance: 95000 }, { day: '2026-11-13', balance: 100000 }],
});
const offer = {
  id: 'f1', title: 'عرض الشتاء', body: 'باقات بسعر أقل', image: null, actionLabel: 'اطلب', actionHref: '/packages', seconds: 8, active: true,
  position: 1, layers: ['pos'], startsAt: null, endsAt: null,
};
const providerAccount = {
  code: 'cell', name: 'مزود', purchases: 24000, payments: 30000, settlements: 0, balance: 6000, creditLimit: 10000, alertFloor: 2000,
  held: 2600, available: 13400, matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: '2026-11-01T08:00:00.000Z', matchOverdue: true, openDifferences: 1,
};
const overview = {
  period: 'month', from: '2026-11-01T00:00:00.000Z',
  lines: { active: 5, expiring: 1, frozen: 1, disconnected: 1, suspended: 0 },
  lineChange: { active: 1, expiring: 0, frozen: 0, disconnected: -1, suspended: 0 },
  sales: { count: 4, amount: 10400, profit: 1200, refunds: 0, refundAmount: 0, net: 10400, activations: 2, capped: false,
    trend: [{ day: '2026-11-12', amount: 5200, profit: 600, count: 2 }, { day: '2026-11-13', amount: 5200, profit: 600, count: 2 }] },
  top: {
    packages: [{ key: 'cell-400', label: '400 جيجا', count: 4, amount: 10400, profit: 1200 }],
    companies: [{ key: 'cell', label: 'سلكوم', count: 4, amount: 10400, profit: 1200 }],
    providers: [{ key: 'cell', label: 'مزود', count: 4, amount: 10400, profit: 1200 }],
  },
  active: { main_agent: [{ key: 'main1', label: 'main1', nickname: 'رئيسي', count: 4, amount: 10400, profit: 600 }], agent: [], pos: [] },
  users: { counts: { main_agent: 1, agent: 0, pos: 1 }, frozen: 1, debtors: 1, debt: 2600, ceilings: 60000, used: 2600 },
  tasks: { pending: 2, working: 1, done: 3, rejected: 0, cancelled: 0, oldestOpenMinutes: 90 },
  pulse: {
    current: { count: 4, amount: 10400, activations: 2, profit: 1200 },
    previous: { count: 2, amount: 5200, activations: 1, profit: 600 },
    trend: [{ at: '2026-11-12', count: 2, amount: 5200, activations: 1, profit: 600 }, { at: '2026-11-13', count: 2, amount: 5200, activations: 1, profit: 600 }],
  },
  providers: [{ code: 'cell', name: 'مزود', operations: 12, cost: 24000, profit: 6000, balance: 6000, creditLimit: 10000, available: 13400, status: 'working', problem: null, failures: 0, alertFloor: 2000 }],
};
const signInMethods = { twoFactorEnabled: false, twoFactorMethod: 'app', canDisable: true, required: false, allowedMethods: ['app', 'sms', 'email'], phone: null, email: null, passkeys: [] };
const sessions = [{ id: 's1', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130', ip: '127.0.0.1', createdAt: '2026-11-13T06:00:00.000Z', lastSeenAt: '2026-11-13T08:55:00.000Z', current: true }];

// What each endpoint answers. `empty` swaps the lists for empty ones. Paths drop the leading /api.
function answer(path, layer, empty) {
  if (layer === 'bare') return null;
  const list = (rows) => (empty ? [] : rows);
  if (path === '/v1/me') return me(layer);
  if (path === '/v1/notices') return { unread: empty ? 0 : 1, items: list(notices), nextCursor: null };
  if (path === '/v1/home') return home;
  if (path === '/v1/overview') return overview;
  if (path === '/v1/offers/live') return { offers: list(layer === 'branch' ? [] : [offer]) };
  if (path === '/v1/offers') return { offers: list([offer]) };
  if (path === '/v1/lines') return { items: list(lines), poses: [{ loginName: 'pos', nickname: 'الكاشير' }], nextCursor: empty ? null : 'c2' };
  if (path.startsWith('/v1/lines/')) return { line: { ...lines[0], switchTargets: ['cell-1000'] }, history: [{ id: 'h1', action: 'extend', at: '2026-10-02T10:30:00.000Z', msisdn: '0550000001', companyName: 'سلكوم', packageName: '400 جيجا', actorName: 'الكاشير' }] };
  if (path === '/v1/packages') {
    const field = layer === 'main' ? 'agent' : 'pos';
    const rows = layer === 'main' || layer === 'agent' ? [sellPack('cell-400', '400 جيجا', field), sellPack('cell-1000', '1000 جيجا', field)] : packages;
    return { packages: list(rows), companies: [{ name: 'سلكوم', image: '' }] };
  }
  if (/^\/v1\/packages\/[^/]+\/custom-prices$/.test(path)) return list(customPrices);
  if (/^\/v1\/packages\/[^/]+\/addons$/.test(path)) return { addons: [] };
  if (/^\/v1\/packages\/[^/]+\/line-prices$/.test(path)) return { current: 2600, groups: [{ price: 2600, count: 3 }] };
  if (path.endsWith('/sheet')) return packageSheet;
  if (path === '/v1/companies') return empty ? { capped: false, companies: [] } : shelf;
  if (path === '/v1/providers') return { providers: [provider] };
  if (/^\/v1\/providers\/[^/]+\/settings$/.test(path)) return { code: 'cell', name: 'مزود', modes: { activate: 'auto', charge: 'manual', disconnect: 'off', freeze: 'auto', switch: 'manual' }, esimPrice: null };
  if (/^\/v1\/providers\/[^/]+\/catalog\/companies$/.test(path)) return { simulated: true, companies: [{ code: 'hot', name: 'هوت', sim, esimPrice: 500, added: false }, { code: 'cell', name: 'سلكوم', sim, esimPrice: 500, added: true }] };
  if (/^\/v1\/providers\/[^/]+\/catalog\/products$/.test(path)) return { simulated: true, products: [{ code: 'p1', name: 'باقة 200', dataGb: 200, smsCount: null, minutes: -1, months: 1, details: '', cost: 1500, renewalCost: 1500, addons: [], added: false }] };
  if (path === '/v1/tasks') return { items: list([task('t1', 'pending'), task('t2', 'working'), task('t3', 'done')]), nextCursor: empty ? null : 'c2' };
  if (/^\/v1\/tasks\/[^/]+\/provider-decision$/.test(path)) return null;
  if (path.startsWith('/v1/tasks/')) return { task: taskDetail, events: taskEvents };
  if (path === '/v1/provider-decisions') return { items: list([decision]), nextCursor: null, total: list([decision]).length, totals: { approval: 0, decision: list([decision]).length } };
  if (path === '/v1/users') return { items: list(users), nextCursor: null, total: list(users).length };
  if (/^\/v1\/users\/[^/]+\/ops$/.test(path)) return { denied: [], deniedAbove: [] };
  if (/^\/v1\/users\/[^/]+\/packages$/.test(path)) return userPackages;
  if (/^\/v1\/users\/[^/]+$/.test(path)) return account;
  if (path === '/v1/directory') return { items: users.map((row) => ({ loginName: row.loginName, nickname: row.nickname, layer: row.layer, parentLoginName: null, frozen: false, mine: true })), nextCursor: null, total: users.length };
  if (path === '/v1/roles') return { roles: list(roles) };
  if (path === '/v1/audit') return { items: list([audit('a1'), audit('a2')]), nextCursor: empty ? null : 'c2' };
  if (path === '/v1/finance/summary') return summary(layer);
  if (path === '/v1/finance/profits') return { packages: list([{ packageName: '400 جيجا', companyName: 'سلكوم', sales: 10400, refunds: 0, profit: 1200 }]), totals: { sales: 10400, refunds: 0, profit: 1200 }, capped: false };
  if (path === '/v1/finance') return { items: list([finance('c1'), finance('c2')]), nextCursor: empty ? null : 'c2' };
  if (path === '/v1/provider-operations') return {
    items: list([{
      id: 'p1', at: '2026-10-02T10:30:00.000Z', kind: 'charge', msisdn: '0550000001',
      providerCode: 'cell', providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', cost: 20,
    }]),
    nextCursor: empty ? null : 'c2',
    stats: empty ? { count: 0, cost: 0, monthCost: 0 } : { count: 1, cost: 20, monthCost: 20 },
    providers: [{ code: 'cell', name: 'مزود' }],
  };
  if (path === '/v1/provider-accounts') return { rows: list([providerAccount]), totals: { balance: 6000, held: 2600, owed: 0 } };
  if (/^\/v1\/provider-accounts\/[^/]+\/reconciliations$/.test(path)) return { runs: [] };
  if (path.startsWith('/v1/provider-accounts/')) return {
    summary: providerAccount, capped: false,
    ledger: [{ id: 'pl1', at: '2026-11-12T08:00:00.000Z', kind: 'purchase', amount: -2000, balanceAfter: 6000, note: '', msisdn: '0550000001', packageName: '400 جيجا', actorLoginName: 'admin' }],
  };
  if (path === '/v1/ledger') return { items: list([ledger('l1'), ledger('l2')]), nextCursor: empty ? null : 'c2' };
  if (path.startsWith('/v1/reports/')) {
    const body = reports[path.split('/').pop()];
    if (!body) return undefined;
    if (empty && body.rows) return { ...body, rows: [] };
    return empty ? { ...body, items: [], nextCursor: null } : body;
  }
  if (path === '/branding') return { siteName: 'Smile Sim', tagline: 'شرائح بالجملة', hasLogo: false, hasFavicon: false, version: 1 };
  if (path === '/auth/two-factor/send') return { method: 'app' };
  if (path === '/auth/two-factor/methods') return { allowedMethods: ['app', 'sms', 'email'] };
  if (path === '/auth/sign-in-methods') return signInMethods;
  if (path === '/auth/sessions') return { sessions };
  if (path === '/auth/profile') return { loginName: me(layer).loginName, nickname: me(layer).nickname, email: '', phone: '', city: '', address: '' };
  if (path === '/auth/session-rules') return { defaults: { maxSessions: 3, sessionMinutes: 720 }, layers: { branch: { maxSessions: null, sessionMinutes: null }, main_agent: { maxSessions: null, sessionMinutes: null }, agent: { maxSessions: null, sessionMinutes: null }, pos: { maxSessions: null, sessionMinutes: null } } };
  if (path === '/auth/policy') return { policy: { branch: { required: false, method: 'app' }, main_agent: { required: false, method: 'app' }, agent: { required: false, method: 'app' }, pos: { required: false, method: 'app' } } };
  if (/^\/auth\/users\/[^/]+\/settings$/.test(path)) return { loginName: 'main1', email: '', phone: '', twoFactorEnabled: false, twoFactorExempt: false, twoFactorMethod: 'app', twoFactorMode: 'follow', requiredMethod: null, effective: { required: false, method: null } };
  if (/^\/auth\/users\/[^/]+\/session-rules$/.test(path)) return { own: { maxSessions: null, sessionMinutes: null }, layer: { maxSessions: 3, sessionMinutes: 720 }, effective: { maxSessions: 3, sessionMinutes: 720 } };
  return null;
}

const SIGN_IN = { wait: '[data-slot="auth"]' };
const cases = [
  ['home', '/', 'branch'],
  ['finance', '/finance', 'branch'],
  ['provider-operations', '/provider-operations', 'branch'],
  ['provider-operations-empty', '/provider-operations', 'branch', true],
  ['finance-empty', '/finance', 'branch', true],
  ['audit', '/audit', 'branch'],
  ['audit-empty', '/audit', 'branch', true],
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
  ['settings', '/settings', 'branch'],
  // Added in UI maintenance P1.1: every screen, the sign-in screens, the other doors, and open states.
  ['login', '/login', 'branch', false, SIGN_IN],
  ['password', '/password', 'branch', false, SIGN_IN],
  ['two-factor', '/two-factor', 'branch', false, SIGN_IN],
  ['companies', '/companies', 'branch'],
  ['companies-empty', '/companies', 'branch', true],
  ['company', '/companies/cell', 'branch'],
  ['company-new', '/companies/new', 'branch'],
  ['package-new', '/companies/cell/packages/new', 'branch'],
  ['company-package', '/companies/cell/packages/cell-400', 'branch'],
  ['user-main1', '/users/main1', 'branch'],
  ['task', '/tasks/t1', 'branch'],
  ['task-decisions', '/tasks/decisions', 'branch'],
  ['task-decisions-empty', '/tasks/decisions', 'branch', true],
  ['notices', '/notices', 'branch'],
  ['notices-empty', '/notices', 'branch', true],
  ['profits', '/profits', 'branch'],
  ['wallet', '/wallet', 'pos'],
  ['offers', '/offers', 'branch'],
  ['branding', '/branding', 'branch'],
  ['provider-accounts', '/provider-accounts', 'branch'],
  ['provider-account', '/provider-accounts/cell', 'branch'],
  ['report-balances', '/reports/balances', 'branch'],
  ['report-supply', '/reports/supply', 'branch'],
  ['packages-main', '/packages', 'main'],
  ['packages-agent', '/packages', 'agent'],
  ['users-main', '/users', 'main'],
  ['wallet-main', '/wallet', 'main'],
  ['wallet-agent', '/wallet', 'agent'],
  // The home page on a door other than the branch: the head actions and the top row (last operations, waiting tasks).
  ['home-main', '/', 'main'],
  // The bare host: no door, so the layout draws the door chooser (components/doors.tsx, styles/doors.css).
  ['doors', '/', 'bare', false, { wait: '.doors', dump: '.doors' }],
  ['users-dialog', '/users', 'branch', false, { steps: [{ click: '.page-head .ui-btn-primary, .page-head .ui-btn', wait: '.dialog' }] }],
  ['numbers-drawer', '/numbers', 'branch', false, { width: 390, steps: [{ click: '.filter-all', wait: '.filter-bar.drawer-open' }] }],
  ['numbers-filter-pop', '/numbers', 'branch', false, { steps: [{ mousedown: '.filter-panel select', wait: '.filter-pop' }] }],
  ['roles-row-menu', '/roles', 'branch', false, { steps: [{ click: '.row-menu-btn', wait: '.row-menu-panel' }] }],
  ['finance-date-pop', '/finance', 'branch', false, { steps: [{ click: '.date-field-open', wait: '.date-pop' }] }],
  ['company-new-picked', '/companies/new', 'branch', false, { steps: [
    { click: '.add-query .name-field input', wait: '.name-pop' },
    { click: '.name-pop [role=option]' },
    { click: '.add-query .ui-btn:not(:disabled)', wait: '.pick-card' },
  ] }],
  ['number-card-switch', '/numbers/ln1', 'branch', false, { steps: [{ click: '.line-op:has(.lucide-layers)', wait: '.pack-pick' }] }],
  // A number-card operation dialog that holds `Facts` (the SIM swap): its `data-slot="facts"` tiles.
  ['number-card-sim', '/numbers/ln1', 'branch', false, { steps: [{ click: '.line-op:has(.lucide-smartphone)', wait: '[data-slot="dialog"] [data-slot="facts"]' }] }],
  // The package sheet's offers tab: the custom-price rows with their `.price-pair` cells.
  ['company-package-offers', '/companies/cell/packages/cell-400', 'branch', false, { steps: [{ click: '[role=tab][data-tab="offers"]', wait: '.price-pair' }] }],
  // The entered-account door with no code in the fragment: its failed state and the back-to-sign-in button.
  ['enter', '/enter', 'branch', false, { wait: '[data-slot="auth"] a[href="/login"]', dump: '[data-slot="auth"]' }],
];
const only = process.env.ONLY?.split(',');
const width = Number(process.env.WIDTH ?? 1280);
const canaryCss = process.env.CANARY_CSS ? readFileSync(process.env.CANARY_CSS, 'utf8') : null;

// Installed in every page: the motion settle and the row hash, shared by the rest and the forced-state passes.
function snapHelpers() {
  const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  // Resolved properties only: a custom property (--rd-*) is a definition, and a refactor that names a value as a
  // token adds new ones to every element. Sorted, since Chrome's order is not stable.
  const styleHash = (style) => {
    const names = [...style].filter((prop) => !prop.startsWith('--')).sort();
    let text = '';
    for (const prop of names) text += `${prop}:${style.getPropertyValue(prop)};`;
    return hash(text);
  };
  const pseudoHash = (el, pseudo) => {
    const style = getComputedStyle(el, pseudo);
    const content = style.getPropertyValue('content');
    return content === 'none' || content === 'normal' ? '-' : styleHash(style);
  };
  const skip = (el) => el.tagName === 'NEXTJS-PORTAL' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK';
  // Ids React generates (useId: «r1», :r1:, _r_1_) move when a component is added earlier in the tree.
  const authorId = (el) => (el.id && !/[«»:]|_r_|_R_/.test(el.id) ? el.id : null);
  const keys = new Map();
  const keyOf = (el) => {
    if (keys.has(el)) return keys.get(el);
    let key;
    const id = authorId(el);
    if (id && document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1) key = `#${id}`;
    else if (el === document.body || !el.parentElement) key = el.tagName.toLowerCase();
    else {
      const sig = (node) => `${node.tagName.toLowerCase()}${[...node.classList].map((name) => `.${name}`).join('')}`;
      const own = sig(el);
      let n = 0;
      for (const sibling of el.parentElement.children) {
        if (sig(sibling) === own) n += 1;
        if (sibling === el) break;
      }
      key = `${keyOf(el.parentElement)}>${own}:${n}`;
    }
    keys.set(el, key);
    return key;
  };
  const row = (el) => `${keyOf(el)}\t${styleHash(getComputedStyle(el))}\t${pseudoHash(el, '::before')}\t${pseudoHash(el, '::after')}`;
  const subtree = (root) => {
    const rows = [];
    const walk = (el) => {
      if (skip(el)) return;
      rows.push(row(el));
      for (const child of el.children) walk(child);
    };
    walk(root);
    return rows;
  };
  // Finishes every running animation (an infinite one throws on finish() and is cancelled), until none runs.
  const finishAll = () => {
    let rounds = 0;
    for (; rounds < 20; rounds += 1) {
      const running = document.getAnimations().filter((animation) => animation.playState === 'running' || animation.playState === 'paused' || animation.pending);
      if (!running.length) break;
      running.forEach((animation) => { try { animation.finish(); } catch { animation.cancel(); } });
    }
    return rounds;
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const settle = async () => {
    for (let round = 0; round < 10; round += 1) {
      finishAll();
      await frame();
      await frame();
      if (!document.getAnimations().some((animation) => animation.playState === 'running' || animation.pending)) return;
    }
  };
  // Selectors that style something below an element by its state: the compound before the state, with the
  // state taken off, so an ancestor that matches it has its whole subtree hashed under that state.
  const prefixes = { hover: new Set(), active: new Set(), focus: new Set() };
  const own = { hover: new Set(), active: new Set(), focus: new Set() };
  // The elements a state rule styles through that state on their own compound: the selector up to that compound,
  // states and pseudo-elements taken off (`.fact-grid > div:hover::after` -> `.fact-grid > div`). They become
  // forced-state targets for that state, so a rule on an element that is not a control is seen.
  const direct = { hover: new Set(), active: new Set(), focus: new Set() };
  const stateHas = /:has\((?:[^()]|\([^()]*\))*\)/g;
  const stateFree = (text, pattern) => text.replace(stateHas, (group) => (pattern.test(group) ? '' : group))
    .replace(/::?(before|after)\b|::[a-z-]+/g, '')
    .replace(/:(hover|active|focus-within|focus-visible|focus)\b/g, '').replace(/:not\(\)/g, '').trim();
  const PATTERNS = { hover: /:hover/, active: /:active/, focus: /:focus-within|:focus-visible|:focus(?![\w-])/ };
  const readRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) { readRules(rule.cssRules); continue; }
      if (!rule.selectorText) continue;
      for (const member of rule.selectorText.split(/,(?![^(]*\))/)) {
        // Compounds at even indices, combinators between them.
        const pieces = member.trim().split(/(\s*[>+~]\s*|\s+)(?![^(]*\))(?![^[]*\])/);
        const parts = pieces.filter((_, index) => index % 2 === 0);
        parts.forEach((part, index) => {
          const last = index === parts.length - 1;
          // A structural :has() (`.desk:has(> .stack)`) is not a state; one whose argument holds the state is.
          const add = (state) => {
            const pattern = PATTERNS[state];
            if (!pattern.test(part)) return;
            const base = stateFree(part, pattern) || '*';
            // The last compound styles the element itself; an earlier one (or a state :has()) styles below it.
            if (last) own[state].add(base);
            if (!last || (part.match(stateHas) ?? []).some((group) => pattern.test(group))) prefixes[state].add(base);
            // The state on this compound itself (outside :has / :not), focus-within excluded: an element is in
            // focus-within only through a focused descendant, which the ancestor forcing reaches.
            const outside = part.replace(stateHas, '').replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
            const itself = state === 'focus' ? /:focus-visible|:focus(?![\w-])/ : pattern;
            if (!itself.test(outside)) return;
            const upTo = stateFree(pieces.slice(0, index * 2 + 1).join(''), PATTERNS.hover);
            const plain = stateFree(stateFree(upTo, PATTERNS.active), PATTERNS.focus);
            if (plain && plain !== '*') direct[state].add(plain);
          };
          add('hover');
          add('active');
          add('focus');
        });
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { readRules(sheet.cssRules); } catch { /* a cross-origin sheet */ }
  }
  const matchesAny = (el, list) => {
    for (const selector of list) {
      try { if (el.matches(selector)) return true; } catch { /* a selector matches() cannot read */ }
    }
    return false;
  };
  // Ancestors a state rule can restyle: their own row (`own`) or their whole subtree (`prefixes`).
  const lifted = (target, state) => {
    const roots = [];
    const selves = [];
    for (let el = target.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (matchesAny(el, prefixes[state])) roots.push(el);
      else if (matchesAny(el, own[state])) selves.push(el);
    }
    return { roots, selves };
  };
  // The rest state of every row, read once before the forced-state pass.
  let rest = null;
  const keepRest = () => { rest = new Set(subtree(document.body)); };
  const forcedRows = (index, state) => {
    finishAll();
    const target = document.querySelector(`[data-snap-target="${index}"]`);
    const rows = new Set(subtree(target));
    // Ancestors and lifted subtrees are listed where the state changes them (the rest is in .styles.tsv).
    const changed = (line) => { if (!rest.has(line)) rows.add(line); };
    const { roots, selves } = lifted(target, state);
    for (const el of selves) changed(row(el));
    for (const root of roots) subtree(root).forEach(changed);
    return [...rows];
  };
  // Marks every forced-state target (data-snap-target) and returns the states each one gets, in document order.
  const markTargets = (controls, focusable) => {
    const states = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (skip(el) || el.closest('nextjs-portal') || !el.getClientRects().length) continue;
      let wanted;
      if (el.matches(controls)) wanted = ['hover', 'focus', 'active'];
      else {
        wanted = ['hover', 'focus', 'active'].filter((state) => matchesAny(el, direct[state]));
        if (el.matches(focusable) && !wanted.includes('focus')) wanted.push('focus');
      }
      if (!wanted.length) continue;
      el.setAttribute('data-snap-target', String(states.length));
      states.push(wanted);
    }
    return states;
  };
  window.__snap = { subtree, settle, finishAll, keyOf, forcedRows, row, keepRest, markTargets };
}

const TARGETS = 'button, a, input, select, textarea, [role=tab], [role=menuitem], .line-op, .co-card, .pick-card, .pack-pick, .filter-pop button';
const FOCUSABLE = '[tabindex], summary, [contenteditable]';
const ANCESTOR_STATE = { hover: 'hover', active: 'active', focus: 'focus-within' };
// What CDP forces for each state: a keyboard focus is `:focus` and `:focus-visible` at once.
const PSEUDOS = { hover: ['hover'], active: ['active'], focus: ['focus', 'focus-visible'], 'focus-within': ['focus-within'] };

async function forcedStates(page) {
  const statesOf = await page.evaluate(([controls, focusable]) => {
    window.__snap.keepRest();
    return window.__snap.markTargets(controls, focusable);
  }, [TARGETS, FOCUSABLE]);
  const count = statesOf.length;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const parent = new Map();
  const targets = new Map();
  const walk = (node, up) => {
    if (node.nodeType !== 1 && node.nodeType !== 9) return;
    if (up) parent.set(node.nodeId, up);
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'data-snap-target') targets.set(Number(attrs[i + 1]), node.nodeId);
    for (const child of node.children ?? []) walk(child, node.nodeType === 1 ? node.nodeId : null);
  };
  walk(root, null);
  const { keys, off } = await page.evaluate((n) => {
    const els = Array.from({ length: n }, (_, i) => document.querySelector(`[data-snap-target="${i}"]`));
    return { keys: els.map((el) => window.__snap.keyOf(el)), off: els.map((el) => el.matches(':disabled, [aria-disabled="true"]')) };
  }, count);
  const rows = [];
  // Forces exactly `wanted` (nodeId -> pseudo-class), changing only what differs from what is forced now: targets
  // run in document order, so neighbours share most ancestors and those stay forced between them.
  const forced = new Map();
  const force = async (wanted) => {
    for (const [nodeId, pseudo] of forced) {
      if (wanted.get(nodeId) !== pseudo) {
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
        forced.delete(nodeId);
      }
    }
    for (const [nodeId, pseudo] of wanted) {
      if (forced.get(nodeId) === pseudo) continue;
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: PSEUDOS[pseudo] });
      forced.set(nodeId, pseudo);
    }
  };
  const wantedFor = (nodeId, state) => {
    const wanted = new Map([[nodeId, state]]);
    for (let up = parent.get(nodeId); up; up = parent.get(up)) wanted.set(up, ANCESTOR_STATE[state]);
    return wanted;
  };
  for (const state of ['hover', 'focus', 'active']) {
    for (let index = 0; index < count; index += 1) {
      const nodeId = targets.get(index);
      if (!nodeId || !statesOf[index].includes(state)) continue;
      await force(wantedFor(nodeId, state));
      const lines = await page.evaluate(([i, s]) => window.__snap.forcedRows(i, s), [index, state]);
      for (const line of lines) rows.push(`${keys[index]}\t${state}\t${line}`);
    }
    await force(new Map());
  }
  // Elements already disabled (and the same under hover), and elements carrying an aria state.
  const disabled = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(':disabled, [aria-disabled="true"]')) {
      if (el.closest('nextjs-portal')) continue;
      for (const line of window.__snap.subtree(el)) out.push(`${window.__snap.keyOf(el)}\tdisabled\t${line}`);
    }
    for (const el of document.querySelectorAll('[aria-expanded], [aria-pressed], [aria-selected], [aria-current], [aria-checked], [aria-invalid]')) {
      if (el.closest('nextjs-portal')) continue;
      const state = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-current', 'aria-checked', 'aria-invalid']
        .filter((name) => el.hasAttribute(name)).map((name) => `${name}=${el.getAttribute(name)}`).join(' ');
      out.push(`${window.__snap.keyOf(el)}\t${state}\t${window.__snap.row(el)}`);
    }
    return out;
  });
  rows.push(...disabled);
  for (const [index, nodeId] of targets) {
    if (!off[index]) continue;
    const key = keys[index];
    await force(wantedFor(nodeId, 'hover'));
    const lines = await page.evaluate((i) => window.__snap.forcedRows(i, 'hover'), index);
    for (const line of lines) rows.push(`${key}\tdisabled:hover\t${line}`);
  }
  await force(new Map());
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-snap-target]')) el.removeAttribute('data-snap-target');
    window.__snap.finishAll();
  });
  await cdp.detach();
  return [...new Set(rows)].sort();
}

// An unknown option or step key (a misspelt `click:` list, say) would otherwise be ignored and hash the rest state,
// so the whole list is checked before the browser starts.
const OPTIONS = new Set(['wait', 'dump', 'width', 'steps']);
const STEP_KEYS = new Set(['click', 'mousedown', 'wait']);
for (const [name, , layer, , options = {}] of cases) {
  const unknown = [...Object.keys(options).filter((key) => !OPTIONS.has(key)),
    ...(options.steps ?? []).flatMap((step) => Object.keys(step).filter((key) => !STEP_KEYS.has(key)))];
  if (unknown.length) throw new Error(`case ${name}: unknown option ${unknown.join(', ')}`);
  if (!Object.hasOwn(HOSTS, layer)) throw new Error(`case ${name}: unknown layer ${layer}`);
  if ((options.steps ?? []).some((step) => !step.click === !step.mousedown)) throw new Error(`case ${name}: a step needs click or mousedown`);
}

const QUIET_MS = 300;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const unanswered = new Set();
async function runCase([name, path, layer, empty = false, options = {}]) {
  const host = origin.replace('//admin.', HOSTS[layer] ? `//${HOSTS[layer]}.` : '//');
  const wait = options.wait ?? '.canvas-inner';
  const context = await browser.newContext({
    viewport: { width: options.width ?? width, height: 900 }, locale: 'ar', timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const prefs = [['smilesim-theme', process.env.THEME], ['smilesim-locale', process.env.LOCALE]].filter(([, value]) => value);
  if (prefs.length) await context.addCookies(prefs.map(([cookie, value]) => ({ name: cookie, value, url: host })));
  // When the page last asked /api: a list pager reads its next chunk after the first one renders, so rows can still
  // land after the wait selector (and start their entrance animation mid-hash) unless the case waits for quiet.
  let lastApi = Date.now();
  await page.route('**/api/**', (route) => {
    lastApi = Date.now();
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api/, '');
    const body = answer(apiPath, layer, empty);
    if (!body) unanswered.add(`${name}: ${route.request().method()} ${apiPath}`);
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { message: 'none' }),
    });
  });
  // `next dev` can stall one navigation while it compiles; one retry with a longer wait, then a loud failure.
  await page.goto(`${host}${path}`, { timeout: 60000 }).catch(() => page.goto(`${host}${path}`, { timeout: 90000 }));
  await page.waitForSelector(wait);
  await page.waitForFunction(() => !document.querySelector('.canvas-inner .skeleton, .canvas-inner .loading-well'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(snapHelpers);
  await page.evaluate(() => window.__snap.settle());
  for (const step of options.steps ?? []) {
    const selector = step.click ?? step.mousedown;
    await page.locator(selector).first().dispatchEvent(step.click ? 'click' : 'mousedown', { button: 0 });
    if (step.wait) await page.waitForSelector(step.wait);
    await page.evaluate(() => window.__snap.settle());
  }
  // Quiet: no /api request for QUIET_MS, then a settle; repeated while the settle itself set off a request.
  const quietUntil = Date.now() + 15000;
  for (;;) {
    const since = Date.now() - lastApi;
    if (since < QUIET_MS && Date.now() < quietUntil) {
      await page.waitForTimeout(QUIET_MS - since);
      continue;
    }
    const before = lastApi;
    await page.evaluate(() => window.__snap.settle());
    if (lastApi === before || Date.now() >= quietUntil) break;
  }
  if (canaryCss) await page.addStyleTag({ content: canaryCss });
  if (process.env.CANARY_REMOVE) await page.evaluate((selector) => document.querySelector(selector)?.remove(), process.env.CANARY_REMOVE);
  if (canaryCss || process.env.CANARY_REMOVE) await page.evaluate(() => window.__snap.settle());
  // A fresh key cache for what is on the page now.
  await page.evaluate(snapHelpers);
  if (process.env.SHOTS) {
    mkdirSync(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`), fullPage: true });
  }
  if (process.env.STYLES) {
    const { rows, paths } = await page.evaluate(() => {
      const list = window.__snap.subtree(document.body);
      const map = [];
      const walk = (el, at) => {
        if (el.tagName === 'NEXTJS-PORTAL' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
        map.push(`${window.__snap.keyOf(el)}\t${at}`);
        [...el.children].forEach((child, index) => walk(child, `${at}>${child.tagName.toLowerCase()}${index}`));
      };
      walk(document.body, 'body');
      return { rows: list, paths: map };
    });
    writeFileSync(join(out, `${name}.styles.tsv`), `${rows.sort().join('\n')}\n`);
    writeFileSync(join(out, `${name}.paths.tsv`), `${paths.sort().join('\n')}\n`);
  }
  if (process.env.STATES) {
    const rows = await forcedStates(page);
    writeFileSync(join(out, `${name}.states.tsv`), `${rows.join('\n')}\n`);
  }
  const dump = options.dump ?? wait;
  const html = await page.evaluate((selector) => document.querySelector(selector)?.innerHTML ?? '', dump);
  const pretty = html
    .replace(/ id="[^"]*"/g, '')
    .replace(/ style=""/g, '')
    .replace(/></g, '>\n<');
  writeFileSync(join(out, `${name}.html`), `${pretty}\n`);
  console.log(`case ${name} ${path} (${layer}${empty ? ', empty' : ''}${options.steps ? ', open state' : ''})`);
  await context.close();
}

for (const item of cases) {
  if (only && !only.includes(item[0])) continue;
  // A case runs in a fresh context, so a run the dev server broke (a stalled compile, a reload) is repeated once
  // from the start; a second failure is loud.
  try {
    await runCase(item);
  } catch (error) {
    console.log(`case ${item[0]} failed once (${error.message.split('\n')[0]}); repeating it`);
    for (const context of browser.contexts()) await context.close();
    await runCase(item);
  }
}
await browser.close();
if (unanswered.size && process.env.LOG_API) console.log(`unanswered:\n${[...unanswered].join('\n')}`);
console.log('snapshots written to', out);
