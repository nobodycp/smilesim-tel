import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashOnce } from './test-hash';
import { companies } from './office-catalog';
import { OfficeFacade } from './testing/office-facade';

// The web app keeps its own copy of the shape of these answers (apps/web/lib/api-types.ts and features/lines/api.ts: OfficeMe,
// HomePayload, LineRow, PosChoice). There is no shared package, so this test is the guard: the key
// lists below are written by hand, the service must answer with exactly them, and the web types must
// declare exactly them. Change a shape on one side and this fails until the other side and the list follow.

const ME_KEYS = ['loginName', 'nickname', 'layer', 'isBranchOwner', 'grants', 'stops', 'impersonating', 'balance', 'ceiling'];
const HOME_KEYS = ['pendingTasks', 'activeLines', 'inactiveLines', 'expiringLines', 'canPost', 'operations', 'announcements'];
const HOME_OPERATION_KEYS = ['id', 'at', 'kind', 'amount', 'note', 'packageName', 'loginName'];
const HOME_ANNOUNCEMENT_KEYS = ['id', 'body', 'at', 'authorName', 'authorLayer'];
const LINES_KEYS = ['lines', 'poses', 'nextCursor', 'total'];
const LINE_KEYS = ['id', 'msisdn', 'iccid', 'esim', 'esimQr', 'status', 'suspended', 'packageCode', 'packageName', 'companyName', 'posLogin', 'posPrice', 'createdAt', 'endsAt', 'operations'];
const LINE_OPTIONAL_KEYS = ['opsLocked', 'dataGb', 'subscriberPrice', 'companyImage', 'sim', 'switchTargets', 'lastRechargeAt', 'esimPrice'];
const POS_CHOICE_KEYS = ['loginName', 'nickname'];
const DISCONNECT_QUOTE_KEYS = ['amount', 'runsNow'];
const SIM_RULES_KEYS = ['length', 'prefix', 'esim'];
const SHELF_KEYS = ['companies'];
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
  'lines', 'activeLines', 'renewals', 'switches', 'modes',
];

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
  const service = new OfficeFacade(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: true }), findMany: async () => accounts },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
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
  const service = new OfficeFacade(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }), findMany: async () => accounts },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
    ...tables,
  };
  return { service, gate: { sessionId } };
}

const at = new Date(Date.UTC(2026, 9, 1));

describe('office response shapes', () => {
  it('answers /office/me with the keys of OfficeMe', async () => {
    const { service, gate } = await serviceWith({ wallet: { findUnique: async () => ({ balance: 10, ceiling: 100 }) } });
    expect(keysOf(await service.me(gate))).toEqual(sorted(ME_KEYS));
  });

  it('answers /office/home with the keys of HomePayload and of its rows', async () => {
    const { service, gate } = await serviceWith({
      officeTask: { count: async () => 2 },
      line: { count: async () => 3 },
      walletEntry: {
        findMany: async () => [{ id: 'e1', createdAt: at, kind: 'activate', amount: -5, note: null, user: { loginName: 'pos1' } }],
      },
      announcement: {
        findMany: async () => [{ id: 'a1', body: 'hello', createdAt: at, author: { nickname: 'الإدارة', loginName: 'admin', layer: 'branch' } }],
      },
    });
    const home = await service.home(gate);
    expect(keysOf(home)).toEqual(sorted(HOME_KEYS));
    expect(keysOf(home.operations[0])).toEqual(sorted(HOME_OPERATION_KEYS));
    expect(keysOf(home.announcements[0])).toEqual(sorted(HOME_ANNOUNCEMENT_KEYS));
  });

  it('answers /office/lines with the keys of its envelope, of LineRow and of PosChoice', async () => {
    const row = {
      id: 'ln-1',
      msisdn: '0550000001',
      iccid: null,
      esim: false,
      status: 'active',
      posId: 'pos1',
      createdAt: at,
      endsAt: at,
      package: { code: 'pk', name: '400', posPrice: 30, company: { name: 'سلكوم' } },
      pos: { loginName: 'pos1' },
    };
    const { service, gate } = await serviceWith({ line: { findMany: async () => [row], count: async () => 1 } });
    const listed = await service.lines(gate);
    expect(keysOf(listed)).toEqual(sorted(LINES_KEYS));
    expect(keysOf(listed.lines[0])).toEqual(sorted(LINE_KEYS));
    expect(listed.poses.length).toBeGreaterThan(0);
    expect(keysOf(listed.poses[0])).toEqual(sorted(POS_CHOICE_KEYS));
  });

  it('answers /office/companies with the fixed company shelf and package counts', async () => {
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
      company: { findMany: async () => [{ code: 'wecom', image: '', iccidLength: 19, iccidPrefix: '8997202', esim: false, esimPrice: 400 }] },
    });
    const shelf = await service.companiesShelf(gate);
    const wecom = shelf.companies.find((company) => company.code === 'wecom');

    expect(keysOf(shelf)).toEqual(sorted(SHELF_KEYS));
    expect(shelf.companies.map((company) => company.code)).toEqual(companies.map((company) => company.code));
    expect(keysOf(shelf.companies[0])).toEqual(sorted(SHELF_COMPANY_KEYS));
    expect(keysOf(shelf.companies[0].sim)).toEqual(sorted(SIM_RULES_KEYS));
    expect(wecom!.sim).toEqual({ length: 19, prefix: '8997202', esim: false });
    expect(wecom!.esimPrice).toBe(400);
    expect(shelf.companies.find((company) => company.code === 'kalam')?.esimPrice).toBe(500);
    expect(shelf.companies.find((company) => company.code === 'kalam')?.sim).toEqual({ length: null, prefix: '', esim: true });
    expect(keysOf(wecom!.providers[0])).toEqual(sorted(SHELF_PROVIDER_KEYS));
    expect(keysOf(wecom!.providers[0].packages[0])).toEqual(sorted(SHELF_PACKAGE_KEYS));
    expect(wecom!.providers[0].packages[0]).toMatchObject({ forSale: false, enabled: true, lines: 2, activeLines: 1, stoppedLines: 1 });
    expect(shelf.companies.find((company) => company.code === 'kalam')?.providers).toEqual([]);
    expect(shelf.companies.find((company) => company.code === 'symphony')?.providers).toEqual([]);
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
    };
    const { service, gate } = await serviceWith({ package: { findUnique: async () => pkg } });

    const sheet = await service.packageSheet(gate, pkg.code);

    expect(keysOf(sheet)).toEqual(sorted(PACKAGE_SHEET_KEYS));
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
});

// The same lists against the web declarations. Skipped where the web app is not checked out beside the API.
const webApi = join(__dirname, '../../../../web/lib/api-types.ts');
// The officeLines envelope is declared with its call (phase 4.3 split the web client by domain).
const webLines = join(__dirname, '../../../../web/features/lines/api.ts');
const describeWeb = existsSync(webApi) ? describe : describe.skip;

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

  it('OfficeMe', () => {
    expect(declared(typeBody(source, 'OfficeMe'))).toEqual({ required: sorted(ME_KEYS), optional: [] });
  });

  it('HomePayload and its rows', () => {
    const body = typeBody(source, 'HomePayload');
    expect(declared(body)).toEqual({ required: sorted(HOME_KEYS), optional: [] });
    expect(inlineKeys(body, 'operations')).toEqual(sorted(HOME_OPERATION_KEYS));
    expect(inlineKeys(body, 'announcements')).toEqual(sorted(HOME_ANNOUNCEMENT_KEYS));
  });

  it('LineRow, PosChoice and the officeLines envelope', () => {
    expect(declared(typeBody(source, 'LineRow'))).toEqual({ required: sorted(LINE_KEYS), optional: sorted(LINE_OPTIONAL_KEYS) });
    const pos = /export type PosChoice = \{([^}]*)\}/.exec(source);
    expect(sorted([...(pos?.[1] ?? '').matchAll(/(\w+):/g)].map((match) => match[1]))).toEqual(sorted(POS_CHOICE_KEYS));
    const envelope = /officeLines:[\s\S]*?request<\{([^}]*)\}>/.exec(source);
    expect(sorted([...(envelope?.[1] ?? '').matchAll(/(\w+):/g)].map((match) => match[1]))).toEqual(sorted(LINES_KEYS));
  });

  it('DisconnectQuote', () => {
    expect(declared(typeBody(source, 'DisconnectQuote'))).toEqual({ required: sorted(DISCONNECT_QUOTE_KEYS), optional: [] });
  });

  it('SimRules', () => {
    expect(declared(typeBody(source, 'SimRules'))).toEqual({ required: sorted(SIM_RULES_KEYS), optional: [] });
  });
});
