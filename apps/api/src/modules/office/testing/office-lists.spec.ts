import 'reflect-metadata';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Layer } from '../../auth/decide-login';
import { hashOnce } from './test-hash';
import { OfficeFailure } from '../../shared/office-failure';
import { OfficeFacade } from './office-facade';
import { after, decodeCursor, encodeCursor } from '../../shared/paging';
import { EXPIRING_DAYS, SUSPEND_AFTER_DAYS, expiringWhere, isSuspended, linesWhere, suspendedWhere } from '../rules/office-paging';

// A small in-memory stand-in for the Prisma client: it reads the `where`, `orderBy`, `cursor`,
// `skip` and `take` the service sends, so the lists are proven to page in the query and not in memory.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const OPERATORS = ['in', 'contains', 'not', 'lt', 'gt', 'gte', 'lte'];

function scalar(value: unknown) {
  return value instanceof Date ? value.getTime() : value;
}

function holds(value: unknown, condition: unknown): boolean {
  if (condition instanceof Date) return scalar(value) === condition.getTime();
  if (condition && typeof condition === 'object') {
    const spec = condition as Record<string, unknown>;
    if (!Object.keys(spec).some((key) => OPERATORS.includes(key))) return value != null && matches(value as Row, spec);
    return Object.entries(spec).every(([operator, expected]) => {
      if (operator === 'mode') return true;
      if (operator === 'in') return (expected as unknown[]).includes(value);
      if (operator === 'contains') {
        const fold = (text: unknown) => (spec.mode === 'insensitive' ? String(text).toLowerCase() : String(text));
        return value != null && fold(value).includes(fold(expected));
      }
      if (operator === 'not') return expected === null ? value !== null : scalar(value) !== scalar(expected);
      if (operator === 'lt') return (scalar(value) as number) < (scalar(expected) as number);
      if (operator === 'gt') return (scalar(value) as number) > (scalar(expected) as number);
      if (operator === 'gte') return (scalar(value) as number) >= (scalar(expected) as number);
      if (operator === 'lte') return (scalar(value) as number) <= (scalar(expected) as number);
      throw new Error(`unsupported operator ${operator}`);
    });
  }
  return value === condition;
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return [condition].flat().every((part) => matches(row, part as Where));
    if (key === 'OR') return (condition as Where[]).some((part) => matches(row, part));
    if (key === 'NOT') return !matches(row, condition as Where);
    return holds(row[key], condition);
  });
}

type FindArgs = {
  where?: Where;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  cursor?: { id: string };
  skip?: number;
  take?: number;
};

function table(rows: Row[], calls: FindArgs[] = []) {
  return {
    findMany: async (args: FindArgs = {}) => {
      calls.push(args);
      const order = [args.orderBy ?? []].flat().flatMap((part) => Object.entries(part));
      let list = rows.filter((row) => matches(row, args.where ?? {}));
      list = [...list].sort((a, b) => {
        for (const [key, direction] of order) {
          const x = scalar(a[key]) as number | string;
          const y = scalar(b[key]) as number | string;
          if (x === y) continue;
          return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
      if (args.cursor) {
        const at = list.findIndex((row) => row.id === args.cursor?.id);
        list = at < 0 ? [] : list.slice(at + (args.skip ?? 0));
      }
      return args.take === undefined ? list : list.slice(0, args.take);
    },
    count: async (args: { where?: Where } = {}) => rows.filter((row) => matches(row, args.where ?? {})).length,
  };
}

const pad = (n: number, width = 3) => String(n).padStart(width, '0');
const t0 = Date.UTC(2026, 9, 1);

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
  const prisma = {
    user: {
      findUnique: async () => ({ liveGrants: '', isBranchOwner: true }),
      findMany: async () => accounts,
    },
    ...tables,
  };
  (service as unknown as { prismaClient: unknown }).prismaClient = prisma;
  return { service, gate: { sessionId } };
}

describe('numbers list paging', () => {
  const pkgA = { id: 'pa', code: 'pk-a', name: '400 جيجا', posPrice: 30, company: { name: 'سلكوم' }, provider: { name: 'سكاي' } };
  const pkgB = { id: 'pb', code: 'pk-b', name: '100 جيجا', posPrice: 20, company: { name: 'بيلفون' }, provider: { name: 'الوها' } };
  const lines: Row[] = Array.from({ length: 70 }, (_, i) => ({
    id: `ln-${pad(i)}`,
    msisdn: `05500000${pad(i, 2)}`,
    iccid: null,
    esim: false,
    status: i % 2 === 0 ? 'frozen' : i % 7 === 0 ? 'disconnected' : 'active',
    posId: 'pos1',
    packageId: i % 3 === 0 ? 'pa' : 'pb',
    package: i % 3 === 0 ? pkgA : pkgB,
    pos: { loginName: 'pos1' },
    // groups of four share a createdAt so the id has to break the tie
    createdAt: new Date(t0 + Math.floor(i / 4) * 1000),
    endsAt: new Date(t0 + 86_400_000),
  }));

  async function walk(query: Parameters<OfficeFacade['lines']>[1]) {
    const calls: FindArgs[] = [];
    const { service, gate } = await serviceWith({ line: table(lines, calls) });
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const result = await service.lines(gate, { ...query, cursor });
      pages.push(result.items.map((line) => line.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    return { pages, calls };
  }

  it('serves 70 lines in three pages with none repeated and none lost', async () => {
    const { pages, calls } = await walk({});
    expect(pages.map((page) => page.length)).toEqual([30, 30, 10]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(70);
    const newestFirst = [...lines].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (a.id! < b.id! ? 1 : -1));
    expect(all).toEqual(newestFirst.map((line) => line.id));
    expect(calls.map((call) => call.take)).toEqual([31, 31, 31]);
    expect(calls[0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    // The one cursor: a condition in the query, never Prisma's row cursor (shared/paging.ts).
    expect(calls.every((call) => call.cursor === undefined && call.skip === undefined)).toBe(true);
    const last = lines.find((line) => line.id === pages[0][29])!;
    expect(JSON.stringify(calls[1].where)).toContain(JSON.stringify({ createdAt: last.createdAt, id: { lt: last.id } }));
  });

  it('sends no next cursor when the last page is exactly full', async () => {
    const exact = lines.slice(0, 30);
    const { service, gate } = await serviceWith({ line: table(exact) });
    const result = await service.lines(gate);
    expect(result.items).toHaveLength(30);
    expect(result.nextCursor).toBeNull();
  });

  it('filters by status in the query across every page', async () => {
    const expected = lines.filter((line) => line.status === 'frozen');
    expect(expected.length).toBe(35);
    const { pages, calls } = await walk({ status: 'frozen' });
    expect(pages.map((page) => page.length)).toEqual([30, 5]);
    expect(new Set(pages.flat())).toEqual(new Set(expected.map((line) => line.id)));
    expect(calls[0].where).toMatchObject({ status: 'frozen', posId: { in: ['pos1'] } });
  });

  it('filters by package code and combines it with the status', async () => {
    const both = await walk({ status: 'active', packageCode: 'pk-a' });
    const expected = lines.filter((line) => line.status === 'active' && (line.package as typeof pkgA).code === 'pk-a');
    expect(both.pages.flat().sort()).toEqual(expected.map((line) => line.id).sort());
    expect(both.calls[0].where).toMatchObject({ status: 'active', package: { code: 'pk-a' } });
  });

  it('narrows to one account\'s numbers, and to none for an account outside the tree', async () => {
    const own = await walk({ loginName: 'pos1' });
    expect(own.pages.flat()).toHaveLength(70);
    const branch = await walk({ loginName: 'admin' });
    expect(branch.pages.flat()).toHaveLength(70);
    const nobody = await walk({ loginName: 'nobody' });
    expect(nobody.pages.flat()).toHaveLength(0);
  });

  it('matches a number typed with spaces', async () => {
    const { pages } = await walk({ q: ' 05500000 6 ' });
    expect(pages.flat().sort()).toEqual(Array.from({ length: 10 }, (_, i) => `ln-${pad(60 + i)}`));
  });

  it('searches the number, the package name and the company name together', () => {
    const search = (text: string) => ({
      OR: [
        { msisdn: { contains: text.replace(/\s/g, '') } },
        { iccid: { contains: text.replace(/\s/g, '') } },
        { package: { name: { contains: text, mode: 'insensitive' } } },
        { package: { company: { name: { contains: text, mode: 'insensitive' } } } },
      ],
    });
    expect(linesWhere(['p'], { q: '055 024' })).toEqual({ posId: { in: ['p'] }, ...search('055 024') });
    expect(linesWhere(['p'], { q: '400' })).toEqual({ posId: { in: ['p'] }, ...search('400') });
    expect(linesWhere(['p'], { q: 'سلكوم' })).toEqual({ posId: { in: ['p'] }, ...search('سلكوم') });
    expect(linesWhere(['p'], { q: '   ', status: 'bogus', packageCode: ' ' })).toEqual({ posId: { in: ['p'] } });
    expect(linesWhere(['p'], { provider: 'سكاي', company: 'سلكوم', packageCode: 'pk-a' })).toEqual({
      posId: { in: ['p'] },
      package: { code: 'pk-a', provider: { name: 'سكاي' }, company: { name: 'سلكوم' } },
    });
  });

  it('reads «ending soon» as active lines that end within three days', () => {
    const now = new Date('2026-11-08T12:00:00.000Z');
    expect(EXPIRING_DAYS).toBe(3);
    expect(expiringWhere(now)).toEqual({ status: 'active', endsAt: { gte: now, lte: new Date('2026-11-11T12:00:00.000Z') } });
    const where = linesWhere(['p'], { status: 'expiring' });
    expect(where).toMatchObject({ posId: { in: ['p'] }, status: 'active' });
    expect(where.endsAt).toBeDefined();
  });

  it('reads «معلّق» as a line whose subscription ended its package\'s period ago, 90 days by default', () => {
    const now = new Date('2026-11-08T12:00:00.000Z');
    const day = 86_400_000;
    expect(SUSPEND_AFTER_DAYS).toBe(90);
    expect(isSuspended({ status: 'active', endsAt: new Date(now.getTime() - 90 * day) }, 90, now)).toBe(true);
    expect(isSuspended({ status: 'active', endsAt: new Date(now.getTime() - 89 * day) }, 90, now)).toBe(false);
    expect(isSuspended({ status: 'active', endsAt: new Date(now.getTime() - 31 * day) }, 30, now)).toBe(true);
    // A disconnected or frozen line keeps its own status.
    expect(isSuspended({ status: 'disconnected', endsAt: new Date(now.getTime() - 400 * day) }, 90, now)).toBe(false);
    expect(isSuspended({ status: 'frozen', endsAt: new Date(now.getTime() - 400 * day) }, 90, now)).toBe(false);
    expect(suspendedWhere([90, 30, 90], now)).toEqual({
      status: { in: ['active', 'suspended'] },
      OR: [
        { package: { suspendAfterDays: 90 }, endsAt: { lte: new Date(now.getTime() - 90 * day) } },
        { package: { suspendAfterDays: 30 }, endsAt: { lte: new Date(now.getTime() - 30 * day) } },
      ],
    });
    expect(linesWhere(['p'], { status: 'suspended' }, [60])).toMatchObject({ posId: { in: ['p'] }, status: { in: ['active', 'suspended'] } });
  });

  it('finds a line by its serial', async () => {
    const serial = { ...lines[0], id: 'by-serial', msisdn: '0590000001', iccid: '8997200000000000001' };
    const { service, gate } = await serviceWith({ line: table([serial, lines[1]]) });
    const found = await service.lines(gate, { q: '899 7200' });
    expect(found.items.map((line) => line.id)).toEqual(['by-serial']);
  });

  it('filters by provider and company together', async () => {
    const { pages, calls } = await walk({ provider: 'سكاي', company: 'سلكوم' });
    const expected = lines.filter((line) => (line.package as typeof pkgA).provider.name === 'سكاي');
    expect(pages.flat().sort()).toEqual(expected.map((line) => line.id).sort());
    expect(calls[0].where).toMatchObject({ package: { provider: { name: 'سكاي' }, company: { name: 'سلكوم' } } });
  });

  it('finds a package by its digits and a number that holds the same digits, as the top bar search needs', async () => {
    const mixed: Row[] = [
      { ...lines[0], id: 'by-package', msisdn: '0550000001', package: pkgA, packageId: 'pa' },
      { ...lines[1], id: 'by-number', msisdn: '0540012345', package: pkgB, packageId: 'pb' },
      { ...lines[2], id: 'neither', msisdn: '0550000003', package: pkgB, packageId: 'pb' },
    ];
    const { service, gate } = await serviceWith({ line: table(mixed) });
    const found = await service.lines(gate, { q: '400' });
    expect(found.items.map((line) => line.id).sort()).toEqual(['by-number', 'by-package']);
    const spaced = await service.lines(gate, { q: '054 0012' });
    expect(spaced.items.map((line) => line.id)).toEqual(['by-number']);
  });

  it('finds lines by company name and by package name', async () => {
    const byCompany = await walk({ q: 'بيلفون' });
    expect(byCompany.pages.flat().sort()).toEqual(lines.filter((line) => (line.package as typeof pkgB).company.name === 'بيلفون').map((line) => line.id).sort());
    const byPackage = await walk({ q: '400' });
    expect(byPackage.pages.flat().sort()).toEqual(lines.filter((line) => (line.package as typeof pkgA).code === 'pk-a').map((line) => line.id).sort());
  });

  it('keeps the search together with the status and package filters', async () => {
    const { pages } = await walk({ q: '400', status: 'active', packageCode: 'pk-a' });
    const expected = lines.filter((line) => line.status === 'active' && (line.package as typeof pkgA).code === 'pk-a').map((line) => line.id);
    expect(pages.flat().sort()).toEqual(expected.sort());
  });
});

describe('time-ordered lists', () => {
  const entry = (i: number, extra: Row = {}): Row => ({
    id: `en-${pad(i)}`,
    userId: 'admin',
    kind: 'activate',
    amount: -10,
    balanceAfter: 100 - i,
    note: null,
    msisdn: `05500000${pad(i, 2)}`,
    lineId: null,
    companyName: 'سلكوم',
    packageName: '400',
    packagePrice: 10,
    createdAt: new Date(t0 + Math.floor(i / 3) * 1000),
    actor: { loginName: 'admin', nickname: 'الإدارة' },
    user: { loginName: 'admin', layer: 'branch' },
    ...extra,
  });

  it('pages finance by position, with no repeat and no loss', async () => {
    const rows = Array.from({ length: 170 }, (_, i) => entry(i));
    const calls: FindArgs[] = [];
    const { service, gate } = await serviceWith({ walletEntry: table(rows, calls) });
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await service.finance(gate, { cursor });
      sizes.push(result.items.length);
      seen.push(...result.items.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([80, 80, 10]);
    expect(new Set(seen).size).toBe(170);
    expect(calls.every((call) => call.take === 81)).toBe(true);
  });

  it('hands the eSIM fee of a sale to the finance row, and null when there was none', async () => {
    const rows = [entry(0, { amount: -15, esimPrice: 5 }), entry(1, { esimPrice: null }), entry(2)];
    const { service, gate } = await serviceWith({ walletEntry: table(rows) });
    const result = await service.finance(gate, {});
    const byId = new Map(result.items.map((row) => [row.id, row.esimPrice]));
    expect(byId.get('en-000')).toBe(5);
    expect(byId.get('en-001')).toBeNull();
    expect(byId.get('en-002')).toBeNull();
  });

  it('filters finance by number in the query', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => entry(i));
    const { service, gate } = await serviceWith({ walletEntry: table(rows) });
    const result = await service.finance(gate, { q: '055 000 007' });
    expect(result.items.map((row) => row.msisdn).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `05500000${70 + i}`));
    expect(result.nextCursor).toBeNull();
  });

  it('pages the ledger and keeps its own filters on every page', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => entry(i, { kind: i % 2 ? 'charge' : 'activate' }));
    const { service, gate } = await serviceWith({ walletEntry: table(rows) });
    const first = await service.ledger(gate, { kind: 'charge' });
    expect(first.items).toHaveLength(50);
    expect(first.items.every((row) => row.kind === 'charge')).toBe(true);
    expect(first.nextCursor).toBeNull();
    const all = await service.ledger(gate, {});
    expect(all.items).toHaveLength(80);
    const rest = await service.ledger(gate, { cursor: all.nextCursor ?? undefined });
    expect(rest.items).toHaveLength(20);
    expect(new Set([...all.items, ...rest.items].map((row) => row.id)).size).toBe(100);
  });

  it('refuses a cursor that is not ours', async () => {
    const { service, gate } = await serviceWith({ walletEntry: table([]) });
    await expect(service.finance(gate, { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(OfficeFailure);
  });

  it('pages the activity log and filters by action', async () => {
    const now = Date.now();
    const rows: Row[] = Array.from({ length: 100 }, (_, i) => ({
      id: `ev-${pad(i)}`,
      at: new Date(now - i * 1000),
      actorId: 'admin',
      actorLoginName: i % 2 ? 'pos1' : 'admin',
      actorLayer: 'branch',
      action: i % 2 ? 'enter' : 'extend',
      result: 'ok',
      reason: '',
      ip: '',
      subjectKind: '',
      subjectRef: '',
    }));
    const { service, gate } = await serviceWith({ activityEvent: table(rows) });
    const first = await service.audit(gate, {});
    expect(first.items).toHaveLength(80);
    const second = await service.audit(gate, { cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(20);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(100);
    const onlyEnter = await service.audit(gate, { action: 'enter' });
    expect(onlyEnter.items.every((row) => row.action === 'enter')).toBe(true);
    expect(onlyEnter.items).toHaveLength(50);
  });

  it('pages tasks by position and filters by status in the query', async () => {
    const tasks: Row[] = Array.from({ length: 120 }, (_, i) => ({
      id: `tk-${pad(i)}`,
      posId: 'pos1',
      action: 'extend',
      status: i % 4 === 0 ? 'done' : 'pending',
      posDelta: 0,
      packageId: 'pa',
      msisdn: null,
      note: null,
      resultNote: null,
      log: '',
      submitterId: 'admin',
      assigneeId: null,
      createdAt: new Date(t0 + Math.floor(i / 3) * 1000),
      submitter: { loginName: 'admin' },
      assignee: null,
      notes: [],
    }));
    const { service, gate } = await serviceWith({ officeTask: table(tasks), package: { findMany: async () => [{ id: 'pa', name: '400' }] } });
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await service.tasks(gate, { cursor });
      sizes.push(result.items.length);
      ids.push(...result.items.map((task) => task.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
    const done = await service.tasks(gate, { status: 'done' });
    expect(done.items).toHaveLength(30);
    expect(done.items.every((task) => task.status === 'done')).toBe(true);
    expect(done.nextCursor).toBeNull();
  });
});

describe('task reading follows the number', () => {
  const chain = [
    { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null },
    { id: 'clerk', loginName: 'clerk', nickname: 'موظف', layer: 'branch', parentId: null },
    { id: 'main1', loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', parentId: 'admin' },
    { id: 'agent1', loginName: 'agent1', nickname: 'وكيل', layer: 'agent', parentId: 'main1' },
    { id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'agent1' },
    { id: 'pos2', loginName: 'pos2', nickname: 'نقطة ٢', layer: 'pos', parentId: 'agent1' },
  ];
  const task = (id: string, submitterId: string, posId: string): Row => ({
    id,
    posId,
    action: 'switch',
    // Open tasks are in progress from the start (spec 2026-11-09, 2); none is taken yet.
    status: 'working',
    posDelta: 0,
    packageId: 'pa',
    msisdn: '0550000001',
    note: null,
    resultNote: null,
    log: 'أخذها فلان',
    submitterId,
    assigneeId: null,
    createdAt: new Date(t0),
    submitter: { loginName: submitterId },
    assignee: null,
    notes: [{ body: 'ملاحظة' }],
  });
  const rows = [task('t-agent', 'agent1', 'pos1'), task('t-pos2', 'pos2', 'pos2')];

  async function as(id: string, layer: Layer, grants: string, owner = false) {
    const auth = new MemoryAuthStore();
    auth.addUser({
      id,
      loginName: id,
      nickname: id,
      disabledAt: null,
      mustChangePassword: false,
      layer,
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: owner,
      passwordHash: await hashOnce('ownerpass1'),
    });
    const sessionId = await auth.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' });
    const service = new OfficeFacade(auth);
    (service as unknown as { prismaClient: unknown }).prismaClient = {
      user: { findUnique: async () => ({ liveGrants: grants, isBranchOwner: owner }), findMany: async () => chain },
      officeTask: table(rows),
      package: { findMany: async () => [{ id: 'pa', name: '400' }] },
    };
    return { service, gate: { sessionId } };
  }

  it('shows the pos a task its agent opened on its number, without any grant', async () => {
    const { service, gate } = await as('pos1', 'pos', 'read');
    const list = await service.tasks(gate, {});
    expect(list.items.map((row) => row.id)).toEqual(['t-agent']);
    expect(list.items[0].lastNote).toBe('ملاحظة');
    expect(list.items[0].canTake).toBe(false);
  });

  it('shows an agent every task under it and nothing from a sibling branch user', async () => {
    const { service, gate } = await as('agent1', 'agent', 'read');
    const list = await service.tasks(gate, {});
    expect(list.items.map((row) => row.id).sort()).toEqual(['t-agent', 't-pos2']);
  });

  it('lets a branch user without the grant read everything but not take', async () => {
    const { service, gate } = await as('clerk', 'branch', 'read');
    const list = await service.tasks(gate, {});
    expect(list.items).toHaveLength(2);
    expect(list.items.every((row) => row.canTake === false && row.log === '')).toBe(true);
    await expect(service.takeTask(gate, 't-agent')).rejects.toBeInstanceOf(OfficeFailure);
  });

  it('lets the branch owner take', async () => {
    const { service, gate } = await as('admin', 'branch', '', true);
    const list = await service.tasks(gate, {});
    expect(list.items.every((row) => row.canTake && row.log !== '')).toBe(true);
  });

  describe('directory', () => {
    it('gives a pos its own name, the chain above it, and the branch, but not a sibling pos', async () => {
      const { service, gate } = await as('pos1', 'pos', 'read');
      const { items, nextCursor, total } = await service.directory(gate);
      expect(Object.fromEntries(items.map((row) => [row.loginName, row.nickname]))).toEqual({ admin: 'الإدارة', clerk: 'موظف', main1: 'رئيسي', agent1: 'وكيل', pos1: 'نقطة' });
      expect({ nextCursor, total }).toEqual({ nextCursor: null, total: 5 });
      // Only its own account is in its tree; the rest are names to show, without their parent or state.
      expect(items.filter((row) => row.mine).map((row) => row.loginName)).toEqual(['pos1']);
      expect(items.find((row) => row.loginName === 'agent1')).toEqual({ loginName: 'agent1', nickname: 'وكيل', layer: 'agent', parentLoginName: null, frozen: false, mine: false });
      expect(items.find((row) => row.loginName === 'pos1')).toMatchObject({ parentLoginName: 'agent1', mine: true });
    });

    it('gives an agent everything under it plus the chain and the branch', async () => {
      const { service, gate } = await as('agent1', 'agent', 'read');
      const { items } = await service.directory(gate);
      expect(items.map((row) => row.loginName).sort()).toEqual(['admin', 'agent1', 'clerk', 'main1', 'pos1', 'pos2']);
      expect(items.filter((row) => row.mine).map((row) => row.loginName).sort()).toEqual(['agent1', 'pos1', 'pos2']);
    });

    it('gives the branch every account', async () => {
      const { service, gate } = await as('clerk', 'branch', 'read');
      const { items, total } = await service.directory(gate);
      expect(items).toHaveLength(chain.length);
      expect(total).toBe(chain.length);
      expect(items.every((row) => row.mine)).toBe(true);
    });
  });
});

describe('the list cursor against the rows a list reads', () => {
  const stamp = (i: number) => ({ id: `r-${pad(i)}`, createdAt: new Date(t0 + Math.floor(i / 3) * 1000) });

  it('turns a position into a condition that skips exactly the rows already served', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...stamp(i) }));
    const cursor = decodeCursor(encodeCursor(stamp(9).createdAt, stamp(9).id));
    const rest = rows.filter((row) => matches(row, { AND: after(cursor ?? undefined) }));
    const ordered = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const served = ordered.findIndex((row) => row.id === 'r-009');
    expect(rest.map((row) => row.id).sort()).toEqual(ordered.slice(served + 1).map((row) => row.id).sort());
  });
});
