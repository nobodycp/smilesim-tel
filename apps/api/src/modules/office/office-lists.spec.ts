import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { OfficeFailure, OfficeService } from './office.service';
import { afterFeed, decodeFeedCursor, encodeFeedCursor, linesWhere, mergeFeed } from './office-paging';

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
    passwordHash: await hashPassword('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
  const service = new OfficeService(auth);
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
  const pkgA = { id: 'pa', code: 'pk-a', name: '400 جيجا', posPrice: 30, company: { name: 'سلكوم' } };
  const pkgB = { id: 'pb', code: 'pk-b', name: '100 جيجا', posPrice: 20, company: { name: 'بيلفون' } };
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

  async function walk(query: Parameters<OfficeService['lines']>[1]) {
    const calls: FindArgs[] = [];
    const { service, gate } = await serviceWith({ line: table(lines, calls) });
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const result = await service.lines(gate, { ...query, cursor });
      pages.push(result.lines.map((line) => line.id));
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
    expect(calls[0].cursor).toBeUndefined();
    expect(calls[1].cursor).toEqual({ id: pages[0][29] });
    expect(calls[1].skip).toBe(1);
  });

  it('sends no next cursor when the last page is exactly full', async () => {
    const exact = lines.slice(0, 30);
    const { service, gate } = await serviceWith({ line: table(exact) });
    const result = await service.lines(gate);
    expect(result.lines).toHaveLength(30);
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

  it('matches a number typed with spaces', async () => {
    const { pages } = await walk({ q: ' 05500000 6 ' });
    expect(pages.flat().sort()).toEqual(Array.from({ length: 10 }, (_, i) => `ln-${pad(60 + i)}`));
  });

  it('keeps a digit search on the number and sends other text to the package and company names', () => {
    expect(linesWhere(['p'], { q: '055 024' })).toEqual({ posId: { in: ['p'] }, msisdn: { contains: '055024' } });
    expect(linesWhere(['p'], { q: 'سلكوم' })).toEqual({
      posId: { in: ['p'] },
      OR: [
        { package: { name: { contains: 'سلكوم', mode: 'insensitive' } } },
        { package: { company: { name: { contains: 'سلكوم', mode: 'insensitive' } } } },
      ],
    });
    expect(linesWhere(['p'], { q: '   ', status: 'bogus', packageCode: ' ' })).toEqual({ posId: { in: ['p'] } });
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
    ...extra,
  });

  it('pages accounting by position, with no repeat and no loss', async () => {
    const rows = Array.from({ length: 170 }, (_, i) => entry(i));
    const calls: FindArgs[] = [];
    const { service, gate } = await serviceWith({ walletEntry: table(rows, calls) });
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await service.accounting(gate, { cursor });
      sizes.push(result.entries.length);
      seen.push(...result.entries.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([80, 80, 10]);
    expect(new Set(seen).size).toBe(170);
    expect(calls.every((call) => call.take === 81)).toBe(true);
  });

  it('filters accounting by number in the query', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => entry(i));
    const { service, gate } = await serviceWith({ walletEntry: table(rows) });
    const result = await service.accounting(gate, { q: '055 000 007' });
    expect(result.entries.map((row) => row.msisdn).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `05500000${70 + i}`));
    expect(result.nextCursor).toBeNull();
  });

  it('pages the ledger and keeps its own filters on every page', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => entry(i, { kind: i % 2 ? 'charge' : 'activate' }));
    const { service, gate } = await serviceWith({ walletEntry: table(rows) });
    const first = await service.ledger(gate, 'operations', { kind: 'charge' });
    expect(first.entries).toHaveLength(50);
    expect(first.entries.every((row) => row.kind === 'charge')).toBe(true);
    expect(first.nextCursor).toBeNull();
    const all = await service.ledger(gate, 'operations', {});
    expect(all.entries).toHaveLength(80);
    const rest = await service.ledger(gate, 'operations', { cursor: all.nextCursor ?? undefined });
    expect(rest.entries).toHaveLength(20);
    expect(new Set([...all.entries, ...rest.entries].map((row) => row.id)).size).toBe(100);
  });

  it('refuses a cursor that is not ours', async () => {
    const { service, gate } = await serviceWith({ walletEntry: table([]) });
    await expect(service.accounting(gate, { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(OfficeFailure);
  });

  it('merges entries, tasks and visits in the audit into one feed that pages cleanly', async () => {
    const entries = Array.from({ length: 70 }, (_, i) => entry(i, { userId: 'pos1', createdAt: new Date(t0 + Math.floor(i / 5) * 1000) }));
    const tasks: Row[] = Array.from({ length: 50 }, (_, i) => ({
      id: `tk-${pad(i)}`,
      posId: 'pos1',
      action: 'extend',
      status: i % 5 === 0 ? 'done' : 'pending',
      posDelta: i % 5 === 0 ? -10 : 0,
      packageId: 'pa',
      nextPackageId: null,
      msisdn: null,
      createdAt: new Date(t0 + Math.floor(i / 4) * 1000),
      submitter: { loginName: 'pos1', nickname: 'نقطة' },
      assignee: null,
      line: null,
    }));
    const visits: Row[] = Array.from({ length: 30 }, (_, i) => ({
      id: `vs-${pad(i)}`,
      targetLogin: 'pos1',
      ip: '',
      createdAt: new Date(t0 + Math.floor(i / 3) * 1000),
      actor: { loginName: 'admin', nickname: 'الإدارة' },
    }));
    const { service, gate } = await serviceWith({
      walletEntry: table(entries),
      officeTask: table(tasks),
      accessLog: table(visits),
      package: table([{ id: 'pa', name: '400', company: { name: 'سلكوم' }, provider: { name: 'مزود' } }]),
      line: table([]),
    });
    const eligible = 70 + tasks.filter((task) => !(task.status === 'done' && task.posDelta !== 0)).length + 30;
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await service.audit(gate, { cursor });
      sizes.push(result.entries.length);
      ids.push(...result.entries.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(eligible).toBe(70 + 40 + 30);
    expect(sizes).toEqual([80, 60]);
    expect(new Set(ids).size).toBe(eligible);
    expect(ids.some((id) => id.startsWith('en-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('tk-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('vs-'))).toBe(true);

    const onlyVisits = await service.audit(gate, { kind: 'enter' });
    expect(onlyVisits.entries.map((row) => row.action)).toEqual(Array(30).fill('enter'));
    const onlyExtend = await service.audit(gate, { kind: 'extend' });
    expect(onlyExtend.entries.every((row) => row.action === 'extend')).toBe(true);
    expect(onlyExtend.entries).toHaveLength(40);
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
    }));
    const { service, gate } = await serviceWith({ officeTask: table(tasks), package: { findMany: async () => [{ id: 'pa', name: '400' }] } });
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await service.tasks(gate, { cursor });
      sizes.push(result.tasks.length);
      ids.push(...result.tasks.map((task) => task.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
    const done = await service.tasks(gate, { status: 'done' });
    expect(done.tasks).toHaveLength(30);
    expect(done.tasks.every((task) => task.status === 'done')).toBe(true);
    expect(done.nextCursor).toBeNull();
  });
});

describe('feed cursor', () => {
  const stamp = (i: number) => ({ id: `r-${pad(i)}`, createdAt: new Date(t0 + Math.floor(i / 3) * 1000) });

  it('round-trips a position and rejects garbage', () => {
    const row = stamp(7);
    expect(decodeFeedCursor(encodeFeedCursor(row))).toEqual({ at: row.createdAt, id: row.id });
    expect(decodeFeedCursor(undefined)).toBeUndefined();
    expect(decodeFeedCursor('')).toBeUndefined();
    expect(decodeFeedCursor('!!')).toBeNull();
    expect(decodeFeedCursor(Buffer.from('abc~x').toString('base64url'))).toBeNull();
  });

  it('turns a position into a condition that skips exactly the rows already served', () => {
    expect(afterFeed(undefined)).toEqual([]);
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...stamp(i) }));
    const cursor = decodeFeedCursor(encodeFeedCursor(stamp(9)));
    const rest = rows.filter((row) => matches(row, { AND: afterFeed(cursor ?? undefined) }));
    const ordered = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const served = ordered.findIndex((row) => row.id === 'r-009');
    expect(rest.map((row) => row.id).sort()).toEqual(ordered.slice(served + 1).map((row) => row.id).sort());
  });

  it('reports a next cursor only when a source still had more rows', () => {
    const a = Array.from({ length: 5 }, (_, i) => stamp(i));
    const b = Array.from({ length: 5 }, (_, i) => stamp(i + 5));
    expect(mergeFeed([a, b], 10).nextCursor).toBeNull();
    const merged = mergeFeed([a, b], 9);
    expect(merged.page).toHaveLength(9);
    expect(merged.nextCursor).toBe(encodeFeedCursor(merged.page[8]));
  });
});
