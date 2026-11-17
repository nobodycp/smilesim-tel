import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import type { UnitOfWork } from '../platform/unit-of-work';
import { searchTerms } from '../platform/search';
import { LinesRepository } from './lines.repository';
import { linesWhere } from './rules/line-filters';
import { WalletsRepository } from '../wallets/wallets.repository';
import { financeSearch, loginIdsContaining } from '../wallets/finance-search';

// PostgreSQL only (TEST_DATABASE_URL). The search of the numbers list, the inbox and finance since DB.6 (spec
// 2026-11-17-scale-speed-cleanup, "Search (DB.6)"): for a table of inputs, the rows the new search answers are the
// rows the `contains` search it replaced answered (kept here as the reference), except the differences the spec
// names; and the planner can serve each shape from the trigram indexes. Everything runs in a rolled-back transaction.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Tx = Prisma.TransactionClient;
const ROLLBACK = new Error('rolled back on purpose');

/** The numbers list's search until DB.6. */
function oldLines(q: string): Prisma.LineWhereInput {
  const text = q.trim();
  const digits = text.replace(/\s/g, '');
  return !text
    ? {}
    : {
        OR: [
          { msisdn: { contains: digits } },
          { iccid: { contains: digits } },
          { package: { name: { contains: text, mode: 'insensitive' } } },
          { package: { company: { name: { contains: text, mode: 'insensitive' } } } },
        ],
      };
}

/** The inbox's search until DB.6. */
function oldTasks(q: string): Prisma.TaskWhereInput {
  const digits = q.replace(/\s/g, '');
  return digits ? { msisdn: { contains: digits } } : {};
}

/** The finance search until DB.6. */
function oldFinance(q: string): Prisma.WalletEntryWhereInput {
  const needle = q.trim();
  const digits = needle.replace(/\s/g, '');
  return needle
    ? {
        OR: [
          ...(digits ? [{ msisdn: { contains: digits } }] : []),
          { note: { contains: needle, mode: 'insensitive' as const } },
          { packageName: { contains: needle, mode: 'insensitive' as const } },
          { companyName: { contains: needle, mode: 'insensitive' as const } },
          { user: { loginName: { contains: needle, mode: 'insensitive' as const } } },
        ],
      }
    : {};
}

suite('search: digits and names (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = before;
  });

  const scratch = (run: (tx: Tx) => Promise<void>) =>
    prisma.$transaction(async (tx) => {
      await run(tx);
      throw ROLLBACK;
    }, { timeout: 50_000 }).catch((error: unknown) => (error === ROLLBACK ? undefined : Promise.reject(error)));

  /** Letters only, so a login holds no digit the table's inputs could meet by chance. */
  const letters = () => Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

  async function seed(tx: Tx) {
    const mark = letters();
    const owner = await tx.user.create({ data: { loginName: `srch_${mark}_owner`, nickname: 'srch', passwordHash: 'x', layer: 'branch' } });
    const pos = await tx.user.create({ data: { loginName: `srch_${mark}`, nickname: 'نقطة البحث', passwordHash: 'x', layer: 'pos', parentId: owner.id } });
    const pos2 = await tx.user.create({ data: { loginName: `srch_${mark}_4455`, nickname: 'نقطة ثانية', passwordHash: 'x', layer: 'pos', parentId: owner.id } });
    const code = `srch-${randomUUID()}`;
    const provider = await tx.provider.create({ data: { code, name: 'srch' } });
    const company = await tx.company.create({ data: { code: `${code}-c1`, name: 'سلكوم-بحث' } });
    const company2 = await tx.company.create({ data: { code: `${code}-c2`, name: 'بيلفون-بحث' } });
    const prices = {
      branchCost: 1, mainPrice: 2, agentPrice: 3, posPrice: 4, subscriberPrice: 5,
      renewalBranchCost: 1, renewalMainPrice: 2, renewalAgentPrice: 3, renewalPosPrice: 4, renewalSubscriberPrice: 5,
      autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false,
    };
    const giga = await tx.package.create({ data: { code: `${code}-p1`, name: '100 جيجا بحث', providerId: provider.id, companyId: company.id, ...prices } });
    const monthly = await tx.package.create({ data: { code: `${code}-p2`, name: 'شهري بحث', providerId: provider.id, companyId: company2.id, ...prices } });
    const line = (msisdn: string, iccid: string | null, packageId: string) =>
      tx.line.create({ data: { msisdn, iccid, status: 'active', endsAt: new Date(Date.now() + 86_400_000), packageId, posId: pos.id, terms: {} } });
    // The numbers are picked so no other spec's rows share them; the lines are found by `posId` anyway.
    await line('0541001234', '8997201000000000001', monthly.id);
    await line('0559876543', '8997202000000000002', giga.id);
    await line('0521112222', null, monthly.id);
    const task = (msisdn: string) =>
      tx.task.create({ data: { action: 'charge', status: 'working', posId: pos.id, packageId: monthly.id, submitterId: pos.id, posDelta: 0, msisdn } });
    await task('0541001234');
    await task('0559876543');
    const entry = (userId: string, data: Partial<Prisma.WalletEntryUncheckedCreateInput>) =>
      tx.walletEntry.create({ data: { userId, actorId: owner.id, amount: 0, balanceAfter: 0, kind: 'activate', ...data } });
    await entry(pos.id, { msisdn: '0541001234', packageName: '100 جيجا بحث', companyName: 'سلكوم-بحث' });
    await entry(pos.id, { kind: 'fund', note: 'حوالة 1234' });
    await entry(pos2.id, { kind: 'fund' });
    // A package name no package in the catalog carries any more.
    await entry(pos.id, { msisdn: '0559876543', packageName: 'قديم 73919', companyName: 'بيلفون-بحث' });
    return { mark, owner, pos, pos2 };
  }

  /** The ids each search answers, the new and the old, among the rows this spec wrote. */
  async function answers(tx: Tx, scope: { pos: { id: string }; pos2: { id: string } }, q: string) {
    const uow = { prisma: tx } as unknown as UnitOfWork;
    const lines = new LinesRepository(uow);
    const wallets = new WalletsRepository(uow);
    const terms = searchTerms(q);
    const ids = terms ? await lines.packageIdsNamed(terms.names) : [];
    const lineIds = async (where: Prisma.LineWhereInput) =>
      (await tx.line.findMany({ where: { AND: [{ posId: scope.pos.id }, where] }, select: { msisdn: true } })).map((row) => row.msisdn).sort();
    const taskIds = async (where: Prisma.TaskWhereInput) =>
      (await tx.task.findMany({ where: { AND: [{ posId: scope.pos.id }, where] }, select: { msisdn: true } })).map((row) => row.msisdn ?? '').sort();
    const accounts = await tx.user.findMany({ where: { id: { in: [scope.pos.id, scope.pos2.id] } }, select: { id: true, loginName: true } });
    const named = terms?.digits ? await wallets.catalogNamed(terms.names) : { packageNamed: true, companyNamed: true };
    const newFinance = financeSearch(terms, { loginIds: terms ? loginIdsContaining(accounts, terms.names) : [], ...named });
    const entryIds = async (where: Prisma.WalletEntryWhereInput) =>
      (await tx.walletEntry.findMany({ where: { AND: [{ userId: { in: [scope.pos.id, scope.pos2.id] } }, where] }, select: { kind: true, msisdn: true, note: true, packageName: true, userId: true } }))
        .map((row) => [row.kind, row.msisdn ?? row.note ?? row.packageName ?? (row.userId === scope.pos2.id ? 'pos2' : '')].join(':'))
        .sort();
    const { posId: _posId, ...newLines } = linesWhere([scope.pos.id], { q }, [], ids) as Prisma.LineWhereInput & { posId?: unknown };
    void _posId;
    return {
      lines: { now: await lineIds(newLines), before: await lineIds(oldLines(q)) },
      tasks: { now: await taskIds({ ...(terms?.number ? { msisdn: { contains: terms.number } } : {}) }), before: await taskIds(oldTasks(q)) },
      finance: { now: await entryIds(newFinance), before: await entryIds(oldFinance(q)) },
    };
  }

  const ALL_LINES = ['0521112222', '0541001234', '0559876543'];
  const ALL_TASKS = ['0541001234', '0559876543'];
  const ALL_ENTRIES = ['activate:0541001234', 'activate:0559876543', 'fund:pos2', 'fund:حوالة 1234'];

  it('answers what the contains search answered, for digits and for names', async () => {
    await scratch(async (tx) => {
      const scope = await seed(tx);
      // [input, lines, tasks, entries]: the same before and after.
      const same: [string, string[], string[], string[]][] = [
        ['0541001234', ['0541001234'], ['0541001234'], ['activate:0541001234']], // a full number
        ['1001', ['0541001234'], ['0541001234'], ['activate:0541001234']], // middle digits (and the serial's)
        ['0559', ['0559876543'], ['0559876543'], ['activate:0559876543']], // a prefix
        ['055 98', ['0559876543'], ['0559876543'], ['activate:0559876543']], // with a space
        ['89972020', ['0559876543'], [], []], // a part of the serial
        ['100', ['0541001234', '0559876543'], ['0541001234'], ['activate:0541001234']], // digits that a package name holds
        ['جيجا', ['0559876543'], [], ['activate:0541001234']], // a package name
        ['سلكوم-بحث', ['0559876543'], [], ['activate:0541001234']], // a company name
        ['بيلفون-بحث', ['0521112222', '0541001234'], [], ['activate:0559876543']], // the other company
        [`srch_${scope.mark}`, [], [], ALL_ENTRIES], // a login (finance only)
        ['4455', [], [], ['fund:pos2']], // digits a login holds
        ['100 جيجا', ['0559876543'], [], ['activate:0541001234']], // digits and letters
        ['حوالة', [], [], ['fund:حوالة 1234']], // a note (a text query)
        // One digit: no minimum, as before. The second point of sale's login holds a 5.
        ['5', ALL_LINES, ALL_TASKS, ['activate:0541001234', 'activate:0559876543', 'fund:pos2']],
        ['', ALL_LINES, ALL_TASKS, ALL_ENTRIES], // nothing typed
        ['   ', ALL_LINES, ALL_TASKS, ALL_ENTRIES],
      ];
      for (const [q, lines, tasks, entries] of same) {
        const got = await answers(tx, scope, q);
        expect([q, got.lines.now, got.tasks.now, got.finance.now]).toEqual([q, lines, tasks, entries]);
        expect([q, got.lines.before, got.tasks.before, got.finance.before]).toEqual([q, lines, tasks, entries]);
      }
    });
  });

  it('finds a number typed with Arabic-Indic digits, dashes or a plus, which the contains search did not', async () => {
    await scratch(async (tx) => {
      const scope = await seed(tx);
      for (const q of ['٠٥٤١٠٠١٢٣٤', '۰۵۴۱۰۰۱۲۳۴', '054-100-1234', '+0541001234', '٠٥٤ ١٠٠ ١٢٣٤']) {
        const got = await answers(tx, scope, q);
        expect([q, got.lines.now, got.tasks.now, got.finance.now]).toEqual([q, ['0541001234'], ['0541001234'], ['activate:0541001234']]);
        expect([q, got.lines.before, got.tasks.before, got.finance.before]).toEqual([q, [], [], []]);
      }
      // A package name typed with Arabic-Indic digits.
      const giga = await answers(tx, scope, '١٠٠ جيجا');
      expect([giga.lines.now, giga.finance.now]).toEqual([['0559876543'], ['activate:0541001234']]);
    });
  });

  it('reads no note, and no stored name the catalog no longer has, for a number query in finance (the named differences)', async () => {
    await scratch(async (tx) => {
      const scope = await seed(tx);
      // The note «حوالة 1234» holds the digits: the contains search found it, the number search does not.
      const note = await answers(tx, scope, '1234');
      expect(note.finance).toEqual({ now: ['activate:0541001234'], before: ['activate:0541001234', 'fund:حوالة 1234'] });
      expect(note.lines.now).toEqual(note.lines.before);
      // «قديم 73919» is a name stored on an entry that no package in the catalog has.
      const gone = await answers(tx, scope, '73919');
      expect(gone.finance).toEqual({ now: [], before: ['activate:0559876543'] });
    });
  });

  it('can serve every number shape from the trigram indexes', async () => {
    await scratch(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const plan = async (sql: string) => (await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN (COSTS OFF) ${sql}`)).map((row) => row['QUERY PLAN']).join('\n');
      const line = await plan(`SELECT id FROM "Line" WHERE "msisdn" LIKE '%1001%' OR "iccid" LIKE '%1001%' OR "packageId" IN ('a', 'b')`);
      expect(line).toContain('Line_msisdn_trgm_idx');
      expect(line).toContain('Line_iccid_trgm_idx');
      expect(line).toContain('Line_packageId_idx');
      expect(await plan(`SELECT id FROM "Line" WHERE "msisdn" LIKE '%0541001234%'`)).toContain('Line_msisdn_trgm_idx');
      expect(await plan(`SELECT id FROM "Task" WHERE "msisdn" LIKE '%1001%'`)).toContain('Task_msisdn_trgm_idx');
      const entry = await plan(`SELECT id FROM "WalletEntry" WHERE "msisdn" LIKE '%1001%' OR "userId" IN ('a', 'b')`);
      expect(entry).toContain('WalletEntry_msisdn_trgm_idx');
      expect(entry).toContain('WalletEntry_userId_createdAt_id_idx');
    });
  });
});
