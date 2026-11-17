import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { hashOnce } from './test-hash';
import { companies } from '../catalog/shipped/shipped-catalog';
import { ApiFacade } from './api-facade';
import { encodeCursor } from '../platform/paging';
import { APPLY_ERRORS, DECISIONS } from '../sales/settlement/activation-settlement.rules';
import { PROVIDER_LOSSES } from '../wallets/provider-cost';
import { RequestLogRepository } from '../monitoring/request-log.repository';
import { RequestLogService } from '../monitoring/request-log.service';
import type { RequestLogWriter } from '../monitoring/request-log.writer';
import { StatusService } from '../monitoring/status.service';
import { AlertRepository } from '../monitoring/alert.repository';
import { AlertsService } from '../monitoring/alerts.service';
import type { StatusRepository } from '../monitoring/status.repository';
import type { StatusRedis } from '../monitoring/status-redis';
import { VersionsService } from '../monitoring/versions.service';
import type { VersionsRepository } from '../monitoring/versions.repository';
import type { ProviderHealthService } from '../providers/directory/provider-health.service';
import type { UnitOfWork } from '../platform/unit-of-work';
import type { Actor } from '../access/types';

// The web app keeps its own copy of the shape of these answers (apps/web/lib/api-types.ts and features/lines/api.ts: DeskMe,
// HomePayload, LineRow, PosChoice). There is no shared package, so this test is the guard: the key
// lists below are written by hand, the service must answer with exactly them, and the web types must
// declare exactly them. Change a shape on one side and this fails until the other side and the list follow.

const ME_KEYS = ['loginName', 'nickname', 'layer', 'isBranchOwner', 'grants', 'stops', 'impersonating', 'balance', 'ceiling'];
// The branch owner's alone (system monitor M.6): the open, unseen alerts. Every other account's answer has no such key.
const ME_OWNER_KEYS = ['openAlerts'];
// The announcements board left the home (spec 2026-11-09-admin-review, 6.2): no `canPost`, no `announcements`.
const HOME_KEYS = ['pendingTasks', 'openTasks', 'activeLines', 'inactiveLines', 'expiringLines', 'operations'];
const HOME_OPERATION_KEYS = ['id', 'at', 'kind', 'amount', 'note', 'packageName', 'loginName'];
// Speed plan PF.5: the tasks screen's tabs, one number per stored status (tasks/task-status.ts).
const TASK_COUNTS_KEYS = ['working', 'done', 'rejected', 'cancelled'];
// `poses` comes with the first page only (plan 2026-11-17-speed, PF.2): a page read on from a cursor has none.
// `totalCapped` beside `total` (database plan DB.8): every list's total is counted up to 10,000.
const LINES_KEYS = ['items', 'poses', 'nextCursor', 'total', 'totalCapped'];
const LINES_LATER_KEYS = ['items', 'nextCursor', 'total', 'totalCapped'];
// No `esimQr`: a list row never carries the eSIM code (ADR 0019, D17; plan slice S.5c). The detail does (below).
const LINE_KEYS = ['id', 'msisdn', 'iccid', 'esim', 'status', 'suspended', 'packageCode', 'packageName', 'companyName', 'companyImage', 'posLoginName', 'posPrice', 'createdAt', 'endsAt', 'operations'];
const LINE_OPTIONAL_KEYS = ['agentLoginName', 'mainAgentLoginName', 'addons', 'opsLocked', 'dataGb', 'smsCount', 'minutes', 'months', 'subscriberPrice', 'sim', 'switchTargets', 'lastRechargeAt', 'esimPrice'];
const POS_CHOICE_KEYS = ['loginName', 'nickname'];
const DISCONNECT_QUOTE_KEYS = ['amount', 'runsNow'];
const DECISION_ANSWER_KEYS = ['ok', 'outcome'];
const SIM_RULES_KEYS = ['length', 'prefix', 'esim'];
// `capped`: the shelf was cut at LIST_CAP packages (platform/paging.ts).
const SHELF_KEYS = ['companies', 'capped'];
const SHELF_COMPANY_KEYS = ['code', 'name', 'image', 'sim', 'esimPrice', 'providers'];
const SHELF_PROVIDER_KEYS = ['code', 'name', 'packages'];
// Prices and details joined in spec 2026-11-08-branch-packages-and-details (additions only).
const SHELF_PACKAGE_KEYS = ['code', 'name', 'months', 'dataGb', 'smsCount', 'minutes', 'branchCost', 'mainPrice', 'renewalBranchCost', 'renewalMainPrice', 'forSale', 'enabled', 'lines', 'activeLines', 'stoppedLines'];
const PACKAGE_SHEET_KEYS = [
  'code', 'name', 'providerCode', 'providerName', 'companyCode', 'companyName', 'enabled', 'forSale',
  'dataGb', 'suspendAfterDays', 'esimAvailable', 'smsCount', 'minutes', 'details', 'months',
  'branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice',
  'renewalBranchCost', 'renewalMainPrice', 'renewalAgentPrice', 'renewalPosPrice', 'renewalSubscriberPrice',
  'esimPrice', 'esimPriceEffective', 'esimPriceSource',
  // Spec 2026-11-16-package-page, P.5: porting and card-to-bill as ways to activate.
  'portMode', 'convertMode',
  // Spec 2026-11-16-package-page, P.7: the offer mark and its line.
  'offer', 'offerNote',
  'lines', 'activeLines', 'renewals', 'switches', 'modes',
  // Package plan D.2: the durations the package is sold and renewed for.
  'durations',
  // Spec 2026-11-09-admin-review, 3: which modes follow the provider, and the provider's own.
  'inheritedModes', 'providerModes',
];

// One duration of a package on its sheet (package plan D.2).
const PACKAGE_DURATION_KEYS = ['id', 'unit', 'count', 'days', 'branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice', 'noDisconnect', 'forSale', 'enabled'];

// GET /v1/packages: one row a package on sale. The price columns above the viewer and the run modes come as
// null outside the branch (plan backend-loose-ends B.4).
const PACKAGE_ROW_KEYS = [
  'code', 'name', 'providerCode', 'providerName', 'activateMode', 'sellable', 'activateInput', 'canPort', 'canConvert', 'offer', 'offerNote', 'noDisconnect', 'companyName', 'sim', 'esimPrice', 'dataGb', 'smsCount', 'minutes',
  'details', 'months', 'branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice', 'editableField',
  'autoActivate', 'autoCharge', 'autoDisconnect', 'autoFreeze', 'autoSwitch',
  'price', 'renewalPrice', 'canActivate', 'sellPrice', 'sellRenewalPrice', 'sellDefault', 'sellRenewalDefault',
];
const catalogPackage = {
  id: 'pkg-1', code: 'wecom-500gb-3f9a2', providerProductCode: 'lian-wecom-500', name: '500 جيجا', dataGb: 500, smsCount: null, minutes: null, details: null, months: 1,
  enabled: true, forSale: true, actionModes: {}, esimPrice: null,
  provider: { code: 'lian', name: 'ليان', actionModes: {}, esimPrice: null },
  company: { code: 'wecom', name: 'ويكوم', iccidLength: 19, iccidPrefix: '8997202', esim: true, esimPrice: 400 },
  branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
  renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
  autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true,
  allowActivate: true, allowCharge: true, allowDisconnect: true, allowFreeze: true, allowSwitch: true, allowExtend: true, allowRename: true, allowSim: true,
};

// The request log (system monitor M.2), branch owner only: the list's rows and envelope, and the summary.
const REQUEST_ROW_KEYS = ['id', 'at', 'durationMs', 'method', 'route', 'path', 'status', 'code', 'actorLoginName', 'layer', 'operatorLoginName', 'ip', 'userAgent', 'requestId', 'bytesIn', 'bytesOut'];
const REQUEST_LIST_KEYS = ['items', 'nextCursor', 'total', 'totalCapped'];
const REQUEST_SUMMARY_KEYS = ['count', 'refused', 'failed', 'errorRate', 'slowest', 'busiest'];
const ROUTE_FIGURES_KEYS = ['method', 'route', 'calls', 'medianMs', 'p95Ms'];
// The server errors (M.4): the grouped list, and what each clearing answers.
const ERROR_GROUP_KEYS = ['method', 'route', 'name', 'message', 'count', 'firstAt', 'lastAt', 'lastRequestId', 'stack'];
const ERROR_LIST_KEYS = ['items', 'capped', 'total'];
const LOG_CLEARED_KEYS = ['removed', 'errorsRemoved'];
// The alerts (system monitor M.6).
const ALERT_KEYS = ['id', 'kind', 'state', 'loginName', 'ip', 'method', 'route', 'path', 'part', 'detail', 'count', 'firstAt', 'lastAt', 'closedAt', 'seenAt', 'seenByLoginName', 'link'];
const ALERT_LINK_KEYS = ['from', 'to'];
const ALERT_LINK_OPTIONAL_KEYS = ['status', 'code', 'method', 'route', 'unmatched', 'ip', 'account', 'slowerThan'];
const ALERT_SEEN_KEYS = ['id', 'seenAt', 'seenByLoginName'];
// The versions page (M.11): the answer and one item.
const VERSIONS_KEYS = ['checking', 'checkedAt', 'items'];
const VERSION_ITEM_KEYS = ['name', 'kind', 'where', 'current', 'latest', 'latestInCycle', 'behind', 'supportEnds', 'supportEnded', 'checkedAt', 'failed', 'cycles'];
// The system status (M.5): the answer, a part, and each part's figures, by name.
const STATUS_KEYS = ['at', 'state', 'parts'];
const STATUS_PART_KEYS = ['name', 'state', 'note', 'figures'];
const STATUS_FIGURE_KEYS: Record<string, string[]> = {
  api: ['uptimeS', 'commit', 'rssBytes', 'heapUsedBytes', 'limitBytes', 'memoryBasis', 'memoryShare'],
  worker: ['workers', 'lastBeatAgeS'],
  postgres: ['pingMs', 'connections', 'sizeBytes'],
  redis: ['configured', 'pingMs', 'usedMemoryBytes'],
  queues: ['configured', 'queues'],
  outbox: ['unpublished', 'oldestAgeS'],
  providers: ['problems', 'providers'],
  requests: ['windowMinutes', 'count', 'failed', 'errorRate', 'slowestRoute'],
  schema: ['carried', 'applied', 'missing'],
};
const FIGURE_TYPE_NAMES: Record<string, string> = {
  api: 'ApiFigures', worker: 'WorkerFigures', postgres: 'PostgresFigures', redis: 'RedisFigures', queues: 'QueuesFigures',
  outbox: 'OutboxFigures', providers: 'ProvidersFigures', requests: 'RequestsFigures', schema: 'SchemaFigures',
};

const sorted = (list: string[]) => [...list].sort();
const keysOf = (value: object) => sorted(Object.keys(value));

const accounts = [
  { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null },
  { id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'admin' },
];

async function serviceWith(tables: Record<string, unknown>) {
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: 'admin',
    loginName: 'admin',
    nickname: 'الإدارة',
    disabledAt: null,
    mustChangePassword: false,
    layer: 'branch',
    twoFactorExempt: true,
    twoFactorEnabled: false,
    isBranchOwner: true,
    passwordHash: await hashOnce('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
  const service = new ApiFacade(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: true }), findMany: async () => accounts },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
    // The company marks that are set (speed plan PF.7): none unless a spec says so.
    $queryRaw: async () => [],
    ...tables,
  };
  return { service, gate: { sessionId } };
}

async function posServiceWith(tables: Record<string, unknown>) {
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: 'pos1',
    loginName: 'pos1',
    nickname: 'نقطة',
    disabledAt: null,
    mustChangePassword: false,
    layer: 'pos',
    twoFactorExempt: true,
    twoFactorEnabled: false,
    isBranchOwner: false,
    passwordHash: await hashOnce('pointpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
  const service = new ApiFacade(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }), findMany: async () => accounts },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
    // The company marks that are set (speed plan PF.7): none unless a spec says so.
    $queryRaw: async () => [],
    ...tables,
  };
  return { service, gate: { sessionId } };
}

const at = new Date(Date.UTC(2026, 9, 1));

describe('office response shapes', () => {
  it('answers /v1/me with the keys of DeskMe (the web\'s type): the branch owner with the open alerts, the others without', async () => {
    const { service, gate } = await serviceWith({ wallet: { findUnique: async () => ({ balance: 10, ceiling: 100 }) }, alert: { count: async () => 2 } });
    const me = await service.me(gate);
    expect(keysOf(me)).toEqual(sorted([...ME_KEYS, ...ME_OWNER_KEYS]));
    expect(me).toMatchObject({ openAlerts: 2 });
    const pos = await posServiceWith({ wallet: { findUnique: async () => ({ balance: 10, ceiling: 100 }) }, alert: { count: async () => { throw new Error('a point of sale never counts the alerts'); } } });
    expect(keysOf(await pos.service.me(pos.gate))).toEqual(sorted(ME_KEYS));
  });

  it('answers /v1/home with the keys of HomePayload and of its rows', async () => {
    const { service, gate } = await serviceWith({
      task: { count: async () => 2 },
      line: { count: async () => 3 },
      walletEntry: {
        findMany: async () => [{ id: 'e1', createdAt: at, kind: 'activate', amount: -5, note: null, user: { loginName: 'pos1' } }],
      },
    });
    const home = await service.home(gate);
    expect(keysOf(home)).toEqual(sorted(HOME_KEYS));
    expect(keysOf(home.operations[0])).toEqual(sorted(HOME_OPERATION_KEYS));
  });

  it('answers /v1/tasks/counts with the keys of TaskCounts, 0 for a status with no task', async () => {
    const { service, gate } = await serviceWith({
      task: { groupBy: async () => [{ status: 'working', _count: { _all: 4 } }, { status: 'done', _count: { _all: 2 } }] },
    });
    const counts = await service.taskCounts(gate);
    expect(keysOf(counts)).toEqual(sorted(TASK_COUNTS_KEYS));
    expect(counts).toEqual({ working: 4, done: 2, rejected: 0, cancelled: 0 });
  });

  it('answers /v1/lines with the keys of its envelope, of LineRow and of PosChoice', async () => {
    const row = {
      id: 'ln-1',
      msisdn: '0550000001',
      iccid: null,
      esim: false,
      status: 'active',
      posId: 'pos1',
      createdAt: at,
      endsAt: at,
      package: { code: 'pk', name: '400', posPrice: 30, company: { code: 'cellcom', name: 'سلكوم', esim: true } },
      pos: { loginName: 'pos1' },
    };
    const { service, gate } = await serviceWith({ line: { findMany: async () => [row], count: async () => 1 } });
    const listed = await service.lines(gate);
    expect(keysOf(listed)).toEqual(sorted(LINES_KEYS));
    expect(keysOf(listed.items[0])).toEqual(sorted(LINE_KEYS));
    // A company with no mark: null, never a data URL (speed plan PF.7).
    expect(listed.items[0].companyImage).toBeNull();
    expect('esimQr' in listed.items[0]).toBe(false);
    expect(listed.poses?.length).toBeGreaterThan(0);
    expect(keysOf(listed.poses?.[0] ?? {})).toEqual(sorted(POS_CHOICE_KEYS));
    // A later page (any cursor this list issues) carries no `poses`.
    const later = await service.lines(gate, { cursor: encodeCursor(at, 'ln-0') });
    expect(keysOf(later)).toEqual(sorted(LINES_LATER_KEYS));
    expect(keysOf(later.items[0])).toEqual(sorted(LINE_KEYS));
    // A company with a mark: its versioned URL, as the companies shelf carries it.
    const marked = await serviceWith({
      line: { findMany: async () => [row], count: async () => 1 },
      $queryRaw: async () => [{ code: 'cellcom', version: '0123456789abcdef' }],
    });
    expect((await marked.service.lines(marked.gate)).items[0].companyImage).toBe('/api/pictures/companies/cellcom?v=0123456789abcdef');
  });

  it('answers /v1/companies with the fixed company shelf and package counts', async () => {
    const packageRows = [
      {
        code: 'lian-wecom-500',
        name: '500 جيجا',
        months: 1,
        forSale: false,
        enabled: true,
        company: { code: 'wecom' },
        provider: { code: 'lian', name: 'ليان' },
        lines: [{ status: 'active' }, { status: 'frozen' }],
      },
    ];
    const { service, gate } = await serviceWith({
      package: { findMany: async () => packageRows },
      company: { findMany: async () => [{ code: 'wecom', iccidLength: 19, iccidPrefix: '8997202', esim: false, esimPrice: 400 }] },
      $queryRaw: async () => [{ code: 'wecom', version: '0123456789abcdef' }],
    });
    const shelf = await service.companiesShelf(gate);
    const wecom = shelf.companies.find((company) => company.code === 'wecom');

    expect(keysOf(shelf)).toEqual(sorted(SHELF_KEYS));
    expect(shelf.companies.map((company) => company.code)).toEqual(companies.map((company) => company.code));
    expect(keysOf(shelf.companies[0])).toEqual(sorted(SHELF_COMPANY_KEYS));
    expect(keysOf(shelf.companies[0].sim)).toEqual(sorted(SIM_RULES_KEYS));
    expect(wecom!.sim).toEqual({ length: 19, prefix: '8997202', esim: false });
    expect(wecom!.esimPrice).toBe(400);
    // The mark by URL, never its bytes (speed plan PF.7); null for a company without one (it was '').
    expect(wecom!.image).toBe('/api/pictures/companies/wecom?v=0123456789abcdef');
    expect(shelf.companies.find((company) => company.code === 'kalam')?.image).toBeNull();
    expect(shelf.companies.find((company) => company.code === 'kalam')?.esimPrice).toBe(500);
    expect(shelf.companies.find((company) => company.code === 'kalam')?.sim).toEqual({ length: null, prefix: '', esim: true });
    expect(keysOf(wecom!.providers[0])).toEqual(sorted(SHELF_PROVIDER_KEYS));
    expect(keysOf(wecom!.providers[0].packages[0])).toEqual(sorted(SHELF_PACKAGE_KEYS));
    expect(wecom!.providers[0].packages[0]).toMatchObject({ forSale: false, enabled: true, lines: 2, activeLines: 1, stoppedLines: 1 });
    expect(shelf.companies.find((company) => company.code === 'kalam')?.providers).toEqual([]);
    expect(shelf.companies.find((company) => company.code === 'symphony')?.providers).toEqual([]);
  });

  it('adds the companies stored since the seed after the seeded ones, by name, in the same shape', async () => {
    const { service, gate } = await serviceWith({
      package: { findMany: async () => [] },
      company: { findMany: async () => [
        { code: 'zain', name: 'زين', iccidLength: null, iccidPrefix: null, esim: true, esimPrice: 500 },
        { code: 'golan', name: 'جولان', iccidLength: null, iccidPrefix: null, esim: false, esimPrice: 300 },
      ] },
    });
    const shelf = await service.companiesShelf(gate);
    expect(shelf.companies.map((company) => company.code)).toEqual([...companies.map((company) => company.code), 'golan', 'zain']);
    expect(keysOf(shelf.companies.at(-1)!)).toEqual(sorted(SHELF_COMPANY_KEYS));
    expect(shelf.companies.find((company) => company.code === 'golan')).toMatchObject({ name: 'جولان', esimPrice: 300, providers: [] });
  });

  it('answers the package sheet with both price ladders, counts, and saved targets', async () => {
    const pkg = {
      id: 'pkg-1',
      code: 'lian-wecom-500',
      name: '500 جيجا',
      provider: { code: 'lian', name: 'ليان' },
      company: { code: 'wecom', name: 'ويكوم' },
      enabled: true,
      forSale: false,
      branchCost: 25,
      mainPrice: 25,
      agentPrice: 25,
      posPrice: 25,
      subscriberPrice: 25,
      renewalBranchCost: 30,
      renewalMainPrice: 30,
      renewalAgentPrice: 30,
      renewalPosPrice: 30,
      renewalSubscriberPrice: 30,
      autoActivate: true,
      allowActivate: true,
      autoCharge: true,
      allowCharge: true,
      autoExtend: true,
      allowExtend: true,
      autoDisconnect: true,
      allowDisconnect: true,
      autoFreeze: true,
      allowFreeze: true,
      autoSwitch: true,
      allowSwitch: true,
      autoRename: true,
      allowRename: true,
      autoSim: true,
      allowSim: true,
      lines: [{ status: 'active' }, { status: 'frozen' }],
      renewals: [{ target: { code: 'lian-wecom-500-3m' } }],
      switches: [{ target: { code: 'lian-wecom-500-5g' } }],
      durations: [{ id: 'd1', packageId: 'p1', unit: 'month', count: 1, branchCost: 30, mainPrice: 30, agentPrice: 30, posPrice: 30, subscriberPrice: 30, noDisconnect: false, forSale: true, enabled: true, providerProductCode: null, position: 0, createdAt: new Date() }],
    };
    const { service, gate } = await serviceWith({ package: { findUnique: async () => pkg } });

    const sheet = await service.packageSheet(gate, pkg.code);

    expect(keysOf(sheet)).toEqual(sorted(PACKAGE_SHEET_KEYS));
    expect(sheet.durations.map((row) => Object.keys(row).sort())).toEqual([sorted(PACKAGE_DURATION_KEYS)]);
    expect(sheet.durations[0]).toMatchObject({ unit: 'month', count: 1, days: 30, posPrice: 30 });
    expect(sheet).toMatchObject({
      companyCode: 'wecom',
      forSale: false,
      lines: 2,
      activeLines: 1,
      renewals: ['lian-wecom-500-3m'],
      switches: ['lian-wecom-500-5g'],
      renewalPosPrice: 30,
    });
  });

  it('validates subscription and renewal price ladders separately', async () => {
    const pkg = {
      id: 'pkg-1',
      months: 3,
      branchCost: 10,
      mainPrice: 10,
      agentPrice: 10,
      posPrice: 10,
      subscriberPrice: 10,
      renewalBranchCost: 20,
      renewalMainPrice: 20,
      renewalAgentPrice: 20,
      renewalPosPrice: 20,
      renewalSubscriberPrice: 20,
    };
    let saved: unknown;
    const { service, gate } = await serviceWith({
      package: {
        findUnique: async () => pkg,
        update: async ({ data }: { data: unknown }) => {
          saved = data;
          return pkg;
        },
      },
    });

    await service.setChain(gate, 'lian-wecom-500', { subscriberPrice: 11, renewalSubscriberPrice: 21 });
    expect(saved).toEqual({
      branchCost: 10,
      mainPrice: 10,
      agentPrice: 10,
      posPrice: 10,
      subscriberPrice: 11,
      renewalBranchCost: 20,
      renewalMainPrice: 20,
      renewalAgentPrice: 20,
      renewalPosPrice: 20,
      renewalSubscriberPrice: 21,
      // The duration row that mirrors the renewal ladder is written in the same statement (package plan D.2).
      durations: {
        updateMany: {
          where: { unit: 'month', count: 3 },
          data: { branchCost: 20, mainPrice: 20, agentPrice: 20, posPrice: 20, subscriberPrice: 21 },
        },
      },
    });

    await expect(service.setChain(gate, 'lian-wecom-500', { renewalBranchCost: 21 }))
      .rejects.toMatchObject({ status: 400, code: 'PRICE_BELOW_FLOOR' });
  });

  it('saves package details: amounts, unlimited as -1, not stated as null, and trimmed extra text', async () => {
    let saved: unknown;
    const { service, gate } = await serviceWith({
      package: {
        findUnique: async () => ({ id: 'p1', code: 'lian-wecom-500' }),
        update: async ({ data }: { data: unknown }) => {
          saved = data;
          return {};
        },
      },
    });
    await service.setPackageDetails(gate, 'lian-wecom-500', { dataGb: 500, smsCount: -1, minutes: null, details: '  تجوال في الأردن  ' });
    expect(saved).toEqual({ dataGb: 500, smsCount: -1, minutes: null, details: 'تجوال في الأردن' });
    await service.setPackageDetails(gate, 'lian-wecom-500', { dataGb: null, smsCount: null, minutes: 1000, details: '' });
    expect(saved).toEqual({ dataGb: null, smsCount: null, minutes: 1000, details: null });
    for (const body of [{ dataGb: -2, smsCount: null, minutes: null, details: '' }, { dataGb: 1.5, smsCount: null, minutes: null, details: '' }, { dataGb: null, smsCount: null, minutes: null, details: 'x'.repeat(301) }, { dataGb: null, smsCount: null, minutes: null }]) {
      await expect(service.setPackageDetails(gate, 'lian-wecom-500', body)).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    }
  });

  it('refuses package details to a point of sale', async () => {
    const { service, gate } = await posServiceWith({});
    await expect(service.setPackageDetails(gate, 'lian-wecom-500', { dataGb: 1, smsCount: null, minutes: null, details: '' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses the company shelf to a point of sale', async () => {
    const { service, gate } = await posServiceWith({});
    await expect(service.companiesShelf(gate)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('limits the point-of-sale package catalog to enabled packages for sale', async () => {
    let where: unknown;
    const { service, gate } = await serviceWith({
      package: {
        findMany: async (query: { where: unknown }) => {
          where = query.where;
          return [];
        },
      },
    });
    await service.packages(gate);
    expect(where).toEqual({ companyId: { not: null }, enabled: true, forSale: true });
  });

  it('answers the request log and its summary with the pinned keys, and never a session, an id of who entered or a body', async () => {
    const row = {
      id: 'r1', at: new Date('2026-11-17T10:00:00Z'), durationMs: 12, method: 'GET', route: '/v1/lines/:id', path: '/v1/lines/abc', status: 200, code: '',
      actorId: 'pos1', actorLoginName: 'pos1', operatorId: 'admin', layer: 'pos', ip: '127.0.0.1', userAgent: 'agent', requestId: 'q1', bytesIn: 0, bytesOut: 40,
    };
    const prisma = {
      requestLog: { findMany: async () => [row], count: async () => 1 },
      user: { findMany: async () => [{ id: 'admin', loginName: 'admin' }], findUnique: async () => null },
      $queryRaw: async (strings: TemplateStringsArray) =>
        strings.join('').includes('percentile_cont')
          ? [{ list: 'slowest', method: 'GET', route: '/v1/lines/:id', calls: 1, medianMs: 12, p95Ms: 12 }, { list: 'busiest', method: 'GET', route: '/v1/lines/:id', calls: 1, medianMs: 12, p95Ms: 12 }]
          : [{ count: 1, refused: 0, failed: 0 }],
    };
    const service = new RequestLogService(new RequestLogRepository({ prisma } as unknown as UnitOfWork), { flush: async () => undefined } as unknown as RequestLogWriter);
    const owner = { id: 'admin', loginName: 'admin', nickname: 'admin', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'admin', impersonating: false } as Actor;
    const list = await service.list(owner, {});
    expect(keysOf(list)).toEqual(sorted(REQUEST_LIST_KEYS));
    expect(keysOf(list.items[0])).toEqual(sorted(REQUEST_ROW_KEYS));
    expect(list.items[0]).toMatchObject({ actorLoginName: 'pos1', operatorLoginName: 'admin', at: '2026-11-17T10:00:00.000Z' });
    const summary = await service.summary(owner, {});
    expect(keysOf(summary)).toEqual(sorted(REQUEST_SUMMARY_KEYS));
    expect(keysOf(summary.slowest[0])).toEqual(sorted(ROUTE_FIGURES_KEYS));
    expect(keysOf(summary.busiest[0])).toEqual(sorted(ROUTE_FIGURES_KEYS));
  });

  it('answers the alerts, a seen mark and the clearing with the pinned keys (M.6)', async () => {
    const row = {
      id: 'a1', kind: 'probing', key: '404 10.0.0.9', state: 'open', loginName: '', accountId: null, ip: '10.0.0.9', method: '', route: '', path: '', part: '', detail: '404', count: 30,
      firstAt: new Date('2026-11-17T10:00:00Z'), lastAt: new Date('2026-11-17T10:04:00Z'), closedAt: null, seenAt: null, seenById: null, seenByLoginName: '', createdAt: new Date('2026-11-17T10:04:30Z'),
    };
    const prisma = {
      alert: {
        findMany: async () => [row], count: async () => 1, findUnique: async () => ({ id: 'a1', state: 'open', seenAt: new Date('2026-11-17T11:00:00Z'), seenByLoginName: 'admin' }),
        updateMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 3 }),
      },
    };
    const service = new AlertsService(new AlertRepository({ prisma } as unknown as UnitOfWork));
    const owner = { id: 'admin', loginName: 'admin', nickname: 'admin', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'admin', impersonating: false } as Actor;
    const list = await service.list(owner, {});
    expect(keysOf(list)).toEqual(sorted(REQUEST_LIST_KEYS));
    expect(keysOf(list.items[0])).toEqual(sorted(ALERT_KEYS));
    // Never the account's id, the key or who saw it by id.
    expect(list.items[0]).not.toHaveProperty('accountId');
    expect(list.items[0].link).toEqual({ from: '2026-11-17T09:59:00.000Z', to: '2026-11-17T10:05:00.000Z', status: '404', ip: '10.0.0.9' });
    expect(keysOf(await service.markSeen(owner, 'a1'))).toEqual(sorted(ALERT_SEEN_KEYS));
    expect(await service.clear(owner)).toEqual({ removed: 3 });
  });

  it('answers the versions page with the pinned keys: each component in each place, the web\'s with no current and its runtime\'s cycles (M.11)', async () => {
    const checkedAt = new Date('2026-11-17T10:00:00Z');
    // The cycle of the Node.js that runs this spec, and another that is never it (the test once named the other
    // `26`, and failed the day the machine's Node.js became 26: two cycles of one name).
    const nodeCycles = [{ cycle: '900', latest: '900.1.0', eol: '2099-04-30' }, { cycle: process.version.slice(1).split('.')[0], latest: '99.0.0', eol: '2000-01-01' }];
    const repo = {
      rows: async () => [
        { name: 'nodejs', kind: 'runtime', latest: '26.13.1', cycles: nodeCycles, checkedAt, failed: false },
        { name: 'next', kind: 'library', latest: '16.0.0', cycles: null, checkedAt, failed: true },
      ],
      postgresVersion: async () => '17.6 (Debian 17.6-1.pgdg120+1)',
      workerNodeVersion: async () => 'v24.21.0',
      lastCheckedAt: async () => checkedAt,
    } as unknown as VersionsRepository;
    const redis = { configured: () => true, serverVersion: async () => '7.4.1' } as unknown as StatusRedis;
    const service = new VersionsService(repo, redis, {} as AlertRepository, {} as UnitOfWork);
    const owner = { id: 'admin', loginName: 'admin', nickname: 'admin', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'admin', impersonating: false } as Actor;
    const page = await service.versions(owner);
    expect(keysOf(page)).toEqual(sorted(VERSIONS_KEYS));
    expect(page).toMatchObject({ checking: 'on', checkedAt: '2026-11-17T10:00:00.000Z' });
    for (const item of page.items) expect(keysOf(item)).toEqual(sorted(VERSION_ITEM_KEYS));
    const at = (name: string, where: string) => page.items.find((item) => item.name === name && item.where === where);
    expect(page.items.map((item) => `${item.name} ${item.where}`)).toEqual([
      'nodejs api', 'nodejs worker', 'nodejs web', 'postgresql database', 'redis cache', 'next web', 'react web', 'tailwindcss web',
      '@nestjs/core api', 'prisma api', '@prisma/client api', 'bullmq api', 'typescript api', 'zod api', 'express api', 'argon2 api',
    ]);
    expect(at('nodejs', 'api')).toMatchObject({ current: process.version, latest: '26.13.1', latestInCycle: '99.0.0', supportEnds: '2000-01-01', supportEnded: true, cycles: [] });
    expect(at('nodejs', 'worker')).toMatchObject({ current: 'v24.21.0', cycles: [] });
    expect(at('nodejs', 'web')).toMatchObject({ current: null, behind: 'unknown', latestInCycle: null, cycles: nodeCycles });
    expect(at('postgresql', 'database')).toMatchObject({ current: '17.6', latest: null, behind: 'unknown', checkedAt: null, failed: false });
    expect(at('redis', 'cache')).toMatchObject({ current: '7.4.1' });
    expect(at('next', 'web')).toMatchObject({ current: null, latest: '16.0.0', failed: true, checkedAt: '2026-11-17T10:00:00.000Z' });
    // The API's own libraries, read from their installed package.json.
    expect(at('@nestjs/core', 'api')?.current).toMatch(/^\d+\.\d+\.\d+/);
    expect(at('zod', 'api')?.current).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('answers the system status with the pinned keys: nine parts, each with its figures (M.5)', async () => {
    const service = new StatusService(
      { ping: async () => undefined, database: async () => ({ connections: 1, sizeBytes: 1 }), heartbeat: async () => ({ workers: 1, lastBeatAgeS: 1 }), outbox: async () => ({ unpublished: 0, oldestAgeS: null }), appliedMigrations: async () => ['a'], carriedMigrations: async () => ['a'] } as unknown as StatusRepository,
      { configured: () => true, ping: async () => undefined, usedMemory: async () => 1, counts: async (name: string) => ({ name, waiting: 0, active: 0, failed: 0 }) } as unknown as StatusRedis,
      { totals: async () => ({ count: 1, refused: 0, failed: 0 }), routeFigures: async () => ({ slowest: [{ method: 'GET', route: '/v1/x', calls: 1, medianMs: 1, p95Ms: 1 }], busiest: [] }) } as unknown as RequestLogRepository,
      { current: async () => [{ code: 'sky', name: 'Sky', status: 'working', reason: null, failures: 0, available: 1, alertFloor: 0 }] } as unknown as ProviderHealthService,
    );
    const owner = { id: 'admin', loginName: 'admin', nickname: 'admin', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'admin', impersonating: false } as Actor;
    const status = await service.status(owner);
    expect(keysOf(status)).toEqual(sorted(STATUS_KEYS));
    expect(status.parts.map((part) => part.name)).toEqual(Object.keys(STATUS_FIGURE_KEYS));
    for (const part of status.parts) {
      expect(keysOf(part)).toEqual(sorted(STATUS_PART_KEYS));
      expect({ name: part.name, keys: keysOf(part.figures as object) }).toEqual({ name: part.name, keys: sorted(STATUS_FIGURE_KEYS[part.name]) });
    }
  });

  it('answers the server errors grouped, and both clearings, with the pinned keys (M.4)', async () => {
    const group = { method: 'GET', route: '/v1/lines/:id', name: 'TypeError', message: 'unclassified', count: 2, firstAt: new Date('2026-11-17T10:00:00Z'), lastAt: new Date('2026-11-17T11:00:00Z'), lastRequestId: 'q2', stack: 'f (dist/a.js:1:1)\ng (dist/b.js:2:2)' };
    const prisma = {
      requestError: { count: async () => 2, deleteMany: async () => ({ count: 2 }) },
      requestLog: { deleteMany: async () => ({ count: 5 }) },
      $queryRaw: async () => [group],
    };
    const uow = { prisma, runTx: async (run: (tx: unknown) => Promise<unknown>) => run(prisma) } as unknown as UnitOfWork;
    const service = new RequestLogService(new RequestLogRepository(uow), { flush: async () => undefined } as unknown as RequestLogWriter);
    const owner = { id: 'admin', loginName: 'admin', nickname: 'admin', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'admin', impersonating: false } as Actor;
    const errors = await service.errors(owner, {});
    expect(keysOf(errors)).toEqual(sorted(ERROR_LIST_KEYS));
    expect(keysOf(errors.items[0])).toEqual(sorted(ERROR_GROUP_KEYS));
    expect(errors.items[0]).toMatchObject({ firstAt: '2026-11-17T10:00:00.000Z', stack: ['f (dist/a.js:1:1)', 'g (dist/b.js:2:2)'] });
    expect(keysOf(await service.clear(owner))).toEqual(sorted(LOG_CLEARED_KEYS));
    expect(keysOf(await service.clearErrors(owner))).toEqual(['removed']);
  });

  it('answers /v1/packages with the keys of PackageRow, and hides the columns above the viewer as null', async () => {
    const tables = { package: { findMany: async () => [catalogPackage] }, $queryRaw: async () => [{ code: 'wecom', version: '0123456789abcdef' }] };
    const asBranch = await serviceWith(tables);
    const branchShelf = await asBranch.service.packages(asBranch.gate);
    // The marks of the listed companies by URL, never their bytes (speed plan PF.7).
    expect(branchShelf.companies).toEqual([{ name: 'ويكوم', image: '/api/pictures/companies/wecom?v=0123456789abcdef' }]);
    const branchRow = branchShelf.packages[0];
    expect(keysOf(branchRow)).toEqual(sorted(PACKAGE_ROW_KEYS));
    expect(branchRow).toMatchObject({
      branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, autoActivate: true,
      providerCode: 'lian', providerName: 'ليان', activateMode: 'auto', sellable: true, activateInput: 'generated',
    });
    const asPos = await posServiceWith(tables);
    const posRow = (await asPos.service.packages(asPos.gate)).packages[0];
    expect(keysOf(posRow)).toEqual(sorted(PACKAGE_ROW_KEYS));
    // Null, never 0: a hidden price must not read as a free one.
    expect(posRow).toMatchObject({
      branchCost: null, mainPrice: null, agentPrice: null, posPrice: 3500, subscriberPrice: 3800,
      autoActivate: null, autoCharge: null, autoDisconnect: null, autoFreeze: null, autoSwitch: null,
      // Which provider, and how it runs, is not a point of sale's to know (rule 3.4): only what it needs to sell.
      providerCode: null, providerName: '', activateMode: null, sellable: true, activateInput: 'generated',
    });
    // Nothing in the row names the provider, the package's own code included (rules/package-code.ts).
    expect(JSON.stringify(posRow)).not.toMatch(/lian|ليان/);
  });
});

// The same lists against the web declarations. Skipped where the web app is not checked out beside the API.
const webApi = join(__dirname, '../../../../web/lib/api-types.ts');
// The lines envelope (the web's `lines` call) is declared with its call (phase 4.3 split the web client by domain).
const webLines = join(__dirname, '../../../../web/features/lines/api.ts');
const describeWeb = existsSync(webApi) ? describe : describe.skip;

// This repository holds the web beside the API: the checks below must run here, not skip (slice R.9).
it('finds the web app beside the API, so the shape checks against its declarations run', () => {
  expect([existsSync(webApi), existsSync(webLines)]).toEqual([true, true]);
});

/** The text between `export type NAME = {` and the `};` that closes it. */
function typeBody(source: string, name: string): string {
  const start = source.indexOf(`export type ${name} = {`);
  if (start < 0) throw new Error(`apps/web/lib/api-types.ts has no exported type ${name}`);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n};', open);
  return source.slice(open + 1, end);
}

/** Keys declared at the top level of a type body, split into required and optional. */
function declared(body: string) {
  const required: string[] = [];
  const optional: string[] = [];
  for (const match of body.matchAll(/^ {2}(\w+)(\?)?:/gm)) (match[2] ? optional : required).push(match[1]);
  return { required: sorted(required), optional: sorted(optional) };
}

/** Keys of the object type written inline after `field:` (`field: { a: string; b: number }[];`). */
function inlineKeys(body: string, field: string): string[] {
  const line = new RegExp(`^ {2}${field}: \\{(.*)\\}\\[\\];`, 'm').exec(body);
  if (!line) throw new Error(`no inline object type for ${field}`);
  return sorted([...line[1].matchAll(/(\w+):/g)].map((match) => match[1]));
}

describeWeb('web types match the pinned shapes', () => {
  const source = [webApi, webLines].map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : '')).join('\n');

  it('DeskMe', () => {
    expect(declared(typeBody(source, 'DeskMe'))).toEqual({ required: sorted(ME_KEYS), optional: sorted(ME_OWNER_KEYS) });
  });

  it('HomePayload and its rows', () => {
    const body = typeBody(source, 'HomePayload');
    expect(declared(body)).toEqual({ required: sorted(HOME_KEYS), optional: [] });
    expect(inlineKeys(body, 'operations')).toEqual(sorted(HOME_OPERATION_KEYS));
  });

  it('TaskCounts', () => {
    expect(declared(typeBody(source, 'TaskCounts'))).toEqual({ required: sorted(TASK_COUNTS_KEYS), optional: [] });
  });

  it('LineRow, PosChoice and the lines envelope', () => {
    expect(declared(typeBody(source, 'LineRow'))).toEqual({ required: sorted(LINE_KEYS), optional: sorted(LINE_OPTIONAL_KEYS) });
    // The code is declared on the detail only, and the detail call answers that type.
    expect(source).toMatch(/export type LineDetail = LineRow & \{ esimQr: string \| null \};/);
    expect(source).toMatch(/\n {2}line: \(id: string\) => request<\{ line: LineDetail; history: LineHistory\[\] \}>/);
    const pos = /export type PosChoice = \{([^}]*)\}/.exec(source);
    expect(sorted([...(pos?.[1] ?? '').matchAll(/(\w+):/g)].map((match) => match[1]))).toEqual(sorted(POS_CHOICE_KEYS));
    // The envelope is the shared `Page<Row>` plus the list's own keys (platform/paging.ts on this side).
    const page = /export type Page<Row> = \{([^}]*)\}/.exec(source);
    const own = /\n {2}lines:[\s\S]*?request<Page<LineRow> & \{([^}]*)\}>/.exec(source);
    const keys = [page?.[1] ?? '', own?.[1] ?? ''].flatMap((body) => [...body.matchAll(/(\w+)\??:/g)].map((match) => match[1]));
    expect(sorted(keys)).toEqual(sorted(LINES_KEYS));
    // `poses` is declared optional: the first page has it, a later page does not.
    expect(own?.[1]).toMatch(/\bposes\?: PosChoice\[\]/);
  });

  it('PackageRow', () => {
    expect(declared(typeBody(source, 'PackageRow'))).toEqual({ required: sorted(PACKAGE_ROW_KEYS), optional: [] });
    // The three columns a lower layer is not told, and the run modes, are declared nullable.
    const body = typeBody(source, 'PackageRow');
    for (const key of ['branchCost', 'mainPrice', 'agentPrice']) expect(body).toMatch(new RegExp(`\\b${key}: number \\| null;`));
    for (const key of ['autoActivate', 'autoCharge', 'autoDisconnect', 'autoFreeze', 'autoSwitch']) expect(body).toMatch(new RegExp(`\\b${key}: boolean \\| null;`));
  });

  it('DisconnectQuote', () => {
    expect(declared(typeBody(source, 'DisconnectQuote'))).toEqual({ required: sorted(DISCONNECT_QUOTE_KEYS), optional: [] });
  });

  // ADR 0019, D15: the answers of the two decision routes. `provider-decisions.db.spec.ts` pins what the routes
  // answer over HTTP; here the web's copy of the two shapes and of the closed lists.
  it('ProviderDecisionAnswer and ProviderDecisionApprovalAnswer', () => {
    const decision = typeBody(source, 'ProviderDecisionAnswer');
    expect(declared(decision)).toEqual({ required: sorted(DECISION_ANSWER_KEYS), optional: ['reason'] });
    expect(decision).toContain(`reason?: ${APPLY_ERRORS.map((reason) => `'${reason}'`).join(' | ')};`);
    expect(decision).toContain("outcome: 'applied' | 'proposed' | 'exception';");
    const approval = typeBody(source, 'ProviderDecisionApprovalAnswer');
    expect(declared(approval)).toEqual({ required: sorted(DECISION_ANSWER_KEYS), optional: [] });
    expect(approval).toContain("outcome: 'approved' | 'refused';");
  });

  // ADR 0019, O6: what the task and decision reads answer, as the web declares it. The API side of each list is
  // pinned over HTTP in `provider-decisions.db.spec.ts` (the same key lists, written there against real answers).
  it('the provider operation and decision reads', () => {
    expect(declared(typeBody(source, 'TaskOperationState'))).toEqual({ required: ['decisions', 'phase', 'reason'], optional: [] });
    expect(declared(typeBody(source, 'DecisionRecord'))).toEqual({ required: sorted(['sequence', 'type', 'decision', 'accountLoginName', 'evidenceKind', 'providerRef', 'note', 'suppliedEsimCode', 'at']), optional: [] });
    const standing = ['phase', 'reason', 'held', 'proposal', 'decisions', 'canApprove', 'canRefuse', 'blocked'];
    expect(declared(typeBody(source, 'DecisionStanding'))).toEqual({ required: sorted(standing), optional: [] });
    expect(source).toMatch(/export type DecisionView = DecisionStanding & \{\n {2}needs: \{ number: boolean; esimCode: boolean \};\n {2}history: DecisionRecord\[\];\n\};/);
    const waitingAt = source.indexOf('export type WaitingDecision = DecisionStanding & {');
    const waiting = source.slice(source.indexOf('{', waitingAt) + 1, source.indexOf('\n};', waitingAt));
    expect(waitingAt).toBeGreaterThan(0);
    expect(declared(waiting)).toEqual({ required: sorted(['taskId', 'action', 'msisdn', 'packageName', 'posLoginName', 'submitterLoginName', 'waitingSince']), optional: [] });
    // The closed lists are the API's own.
    expect(source).toContain(`export type OperationPhase = ${['requested', 'pending', 'unknown', 'unapplied', 'exception', 'applied', 'failed'].map((phase) => `'${phase}'`).join(' | ')};`);
    expect(source).toContain(`export type ProviderDecision = ${DECISIONS.map((decision) => `'${decision}'`).join(' | ')};`);
    expect(source).toContain(`export type ApplyReason = ${APPLY_ERRORS.map((reason) => `'${reason}'`).join(' | ')};`);
    // No read of a decision declares an eSIM code.
    for (const body of [typeBody(source, 'DecisionRecord'), typeBody(source, 'DecisionStanding'), typeBody(source, 'TaskOperationState'), waiting]) expect(body).not.toMatch(/esimQr|esimCode:/);
  });

  // Spec DB.5 P.7: the loss mark, an addition to four answers (`provider-loss.db.spec.ts` pins what the API answers).
  it('the loss mark: ProviderLoss, and the field on FinanceRow, ProviderOpRow, ProviderLedgerRow and ProviderAccount', () => {
    expect(source).toContain(`export type ProviderLoss = ${PROVIDER_LOSSES.map((loss) => `'${loss}'`).join(' | ')};`);
    for (const name of ['FinanceRow', 'ProviderOpRow']) expect(typeBody(source, name)).toMatch(/\n {2}loss: ProviderLoss \| null;/);
    expect(typeBody(source, 'ProviderLedgerRow')).toMatch(/\n {2}loss: ProviderLoss \| null;/);
    expect(typeBody(source, 'ProviderAccount')).toMatch(/\n {2}losses: number;/);
    expect(source).toMatch(/export type ProviderOpStats = \{[^}]*\blosses\?: number[^}]*\};/);
  });

  it('the request log: RequestLogRow, RouteFigures, RequestLogSummary and the list envelope', () => {
    expect(declared(typeBody(source, 'RequestLogRow'))).toEqual({ required: sorted(REQUEST_ROW_KEYS), optional: [] });
    expect(declared(typeBody(source, 'RouteFigures'))).toEqual({ required: sorted(ROUTE_FIGURES_KEYS), optional: [] });
    expect(declared(typeBody(source, 'RequestLogSummary'))).toEqual({ required: sorted(REQUEST_SUMMARY_KEYS), optional: [] });
    expect(source).toContain('export type RequestLogPage = Page<RequestLogRow>;');
    const pageKeys = [...(/export type Page<Row> = \{([^}]*)\}/.exec(source)?.[1] ?? '').matchAll(/(\w+)(\?)?:/g)].map((match) => match[1] + (match[2] ?? ''));
    // `totalCapped` is optional on the web's side only: an answer without it (the Playwright mocks) reads as not capped.
    expect(sorted(pageKeys)).toEqual(sorted(REQUEST_LIST_KEYS.map((key) => (key === 'totalCapped' ? 'totalCapped?' : key))));
  });

  it('the versions page: SystemVersions, VersionItem and VersionCycle (M.11)', () => {
    expect(declared(typeBody(source, 'SystemVersions'))).toEqual({ required: sorted(VERSIONS_KEYS), optional: [] });
    expect(declared(typeBody(source, 'VersionItem'))).toEqual({ required: sorted(VERSION_ITEM_KEYS), optional: [] });
    expect(declared(typeBody(source, 'VersionCycle'))).toEqual({ required: ['cycle', 'eol', 'latest'], optional: [] });
    expect(source).toContain("export type VersionBehind = 'none' | 'patch' | 'minor' | 'major' | 'unknown';");
  });

  it('the system status: SystemStatus, a part, and the figures of each part (M.5)', () => {
    expect(declared(typeBody(source, 'SystemStatus'))).toEqual({ required: sorted(STATUS_KEYS), optional: [] });
    for (const [name, type] of Object.entries(FIGURE_TYPE_NAMES)) {
      expect({ name, keys: declared(typeBody(source, type)) }).toEqual({ name, keys: { required: sorted(STATUS_FIGURE_KEYS[name]), optional: [] } });
      expect(source).toContain(`| StatusPartOf<'${name}', ${type}>`);
    }
    expect(source).toContain("export type StatusState = 'ok' | 'warn' | 'down';");
  });

  it('DeskMe declares the owner\'s alert count as optional; the alerts: SystemAlert, AlertLink, AlertSeen, AlertsCleared (M.6)', () => {
    expect(declared(typeBody(source, 'SystemAlert'))).toEqual({ required: sorted(ALERT_KEYS), optional: [] });
    expect(declared(typeBody(source, 'AlertLink'))).toEqual({ required: sorted(ALERT_LINK_KEYS), optional: sorted(ALERT_LINK_OPTIONAL_KEYS) });
    expect(declared(typeBody(source, 'AlertSeen'))).toEqual({ required: sorted(ALERT_SEEN_KEYS), optional: [] });
    expect(declared(typeBody(source, 'AlertsCleared'))).toEqual({ required: ['removed'], optional: [] });
    expect(source).toContain('export type SystemAlertPage = Page<SystemAlert>;');
  });

  it('the server errors: ErrorGroup, ErrorGroups and the clearings (M.4)', () => {
    expect(declared(typeBody(source, 'ErrorGroup'))).toEqual({ required: sorted(ERROR_GROUP_KEYS), optional: [] });
    expect(declared(typeBody(source, 'ErrorGroups'))).toEqual({ required: sorted(ERROR_LIST_KEYS), optional: [] });
    expect(declared(typeBody(source, 'RequestLogCleared'))).toEqual({ required: sorted(LOG_CLEARED_KEYS), optional: [] });
  });

  it('SimRules', () => {
    expect(declared(typeBody(source, 'SimRules'))).toEqual({ required: sorted(SIM_RULES_KEYS), optional: [] });
  });
});
