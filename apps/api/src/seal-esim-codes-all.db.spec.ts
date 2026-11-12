import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createPrismaClient } from './db';
import { LinesRepository } from './modules/office/lines/lines.repository';
import { moveLineStatus } from './modules/office/lines/line-state';
import { open, seal } from './modules/shared/secret-box';
import { capturedOutput } from './modules/shared/testing/captured-output';
import { sealEsimCodes } from './seal-esim-codes';
import { run } from './seal-secrets';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; plan slice S.5b: the backfill as the command runs it, over
// whole tables with no `posId`. It needs a database nobody else writes to, so it has one of its own beside the
// test database: `<test database>_seal`, made the first time with the migrations applied by `prisma migrate
// deploy`, and emptied of this spec's tables at each run. It is kept between runs on purpose: dropping a database
// forces a checkpoint on the server, which stalled the other PostgreSQL specs running at the same moment.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 53).toString('base64');
const code = (n: number) => `data:image/png;base64,${Buffer.from(`WHOLE-TABLE-QR-CODE-${String(n).padStart(5, '0')}`).toString('base64')}`;

suite('sealing stored eSIM codes over whole tables (PostgreSQL, a database of its own)', () => {
  jest.setTimeout(180_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY, redis: process.env.REDIS_URL };
  const own = new URL(url ?? 'postgresql://x/y');
  const name = `${own.pathname.slice(1)}_seal`;
  own.pathname = `/${name}`;
  let admin: ReturnType<typeof createPrismaClient>;
  let prisma: ReturnType<typeof createPrismaClient>;
  let sealedOk = '';
  let damaged = '';
  const ids = { owner: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID(), poses: [randomUUID(), randomUUID(), randomUUID()] };

  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  /** Every row of both tables: its code, and everything else about it as the database holds it. */
  const rows = async () => ({
    lines: await prisma.$queryRaw<{ id: string; esimQr: string | null; rest: unknown }[]>`SELECT "id", "esimQr", to_jsonb(l) - 'esimQr' AS rest FROM "Line" l ORDER BY "id"`,
    tasks: await prisma.$queryRaw<{ id: string; esimQr: string | null; rest: unknown }[]>`SELECT "id", "esimQr", to_jsonb(t) - 'esimQr' AS rest FROM "OfficeTask" t ORDER BY "id"`,
  });
  /** Everything that is not a code: the other tables, whole. */
  const others = async () => ({
    users: await prisma.$queryRaw`SELECT to_jsonb(u) AS row FROM "User" u ORDER BY "id"`,
    wallets: await prisma.$queryRaw`SELECT to_jsonb(w) AS row FROM "Wallet" w ORDER BY "userId"`,
    entries: await prisma.$queryRaw`SELECT to_jsonb(e) AS row FROM "WalletEntry" e ORDER BY "id"`,
    packages: await prisma.$queryRaw`SELECT to_jsonb(p) AS row FROM "Package" p ORDER BY "id"`,
    notes: await prisma.$queryRaw`SELECT to_jsonb(n) AS row FROM "OfficeTaskNote" n ORDER BY "id"`,
  });
  const isClear = (value: string | null) => Boolean(value) && !value?.startsWith('v1:');
  /** Fills the tables: three points of sale, lines and tasks of every kind. Returns how many codes are clear. */
  const fill = async () => {
    await prisma.officeTaskNote.deleteMany({});
    await prisma.walletEntry.deleteMany({});
    await prisma.officeTask.deleteMany({});
    await prisma.line.deleteMany({});
    let n = 0;
    const line = (posId: string, esimQr: string | null, status = 'active') => ({ id: randomUUID(), msisdn: number(), iccid: serial(), esim: esimQr !== null, esimQr, status, packageId: ids.pkg, posId, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: { stamp: n } });
    const lines = ids.poses.flatMap((posId) => [
      ...Array.from({ length: 6 }, () => line(posId, code((n += 1)))),
      line(posId, code((n += 1)), 'frozen'),
      line(posId, code((n += 1)), 'disconnected'),
      line(posId, sealedOk),
      line(posId, damaged),
      line(posId, null),
      line(posId, null, 'frozen'),
    ]);
    await prisma.line.createMany({ data: lines });
    const task = (posId: string, status: string, action: string, esimQr: string | null, lineId: string | null = null) => ({ id: randomUUID(), action, status, posId, packageId: ids.pkg, submitterId: posId, posDelta: 0, esim: esimQr !== null, esimQr, lineId, note: `note ${n}`, log: 'opened' });
    const tasks = ids.poses.flatMap((posId, at) => {
      const onLine = lines[at * 12].id;
      return [
        task(posId, 'working', 'sim', code((n += 1)), onLine),
        task(posId, 'working', 'activate', code((n += 1))),
        task(posId, 'done', 'sim', code((n += 1)), onLine),
        task(posId, 'cancelled', 'sim', code((n += 1)), onLine),
        task(posId, 'rejected', 'activate', code((n += 1))),
        task(posId, 'working', 'sim', sealedOk, onLine),
        task(posId, 'done', 'activate', damaged),
        task(posId, 'working', 'freeze', null, onLine),
        task(posId, 'done', 'esim', null, onLine),
      ];
    });
    await prisma.officeTask.createMany({ data: tasks });
    await prisma.officeTaskNote.createMany({ data: tasks.slice(0, 4).map((row) => ({ id: randomUUID(), taskId: row.id, authorId: row.posId, body: 'a note' })) });
    await prisma.walletEntry.createMany({ data: ids.poses.map((userId, at) => ({ id: randomUUID(), userId, actorId: userId, kind: 'activate', amount: -3500, balanceAfter: 46_500, lineId: lines[at * 12].id })) });
    return { clearLines: 8 * ids.poses.length, clearTasks: 5 * ids.poses.length, lines: lines.length, tasks: tasks.length };
  };

  beforeAll(async () => {
    process.env.SECRETS_KEY = KEY;
    process.env.DATABASE_URL = url;
    admin = createPrismaClient();
    const exists = await admin.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    await admin.$disconnect();
    // Applies what is missing; nothing when the database is already at the last migration.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: join(__dirname, '..'), env: { ...process.env, DATABASE_URL: own.toString() }, stdio: 'ignore' });
    process.env.DATABASE_URL = own.toString();
    prisma = createPrismaClient();
    // Whatever an earlier run left: this database holds nothing but this spec's rows.
    await prisma.officeTaskNote.deleteMany({});
    await prisma.walletEntry.deleteMany({});
    await prisma.officeTask.deleteMany({});
    await prisma.line.deleteMany({});
    await prisma.package.deleteMany({});
    await prisma.company.deleteMany({});
    await prisma.provider.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.user.deleteMany({ where: { parentId: { not: null } } });
    await prisma.user.deleteMany({});
    sealedOk = seal(code(90_001));
    damaged = `${seal(code(90_002)).slice(0, -4)}AAAA`;
    const user = (id: string, loginName: string, layer: string, parentId: string | null) => ({ id, loginName, nickname: loginName, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch', phone: '+972 50-000-0000' });
    await prisma.user.create({ data: { ...user(ids.owner, 'owner', 'branch', null), wallet: { create: { balance: 0, ceiling: 0 } } } });
    for (const [at, id] of ids.poses.entries()) await prisma.user.create({ data: { ...user(id, `pos${at}`, 'pos', ids.owner), wallet: { create: { balance: 50_000 + at, held: 700, ceiling: 0 } } } });
    await prisma.provider.create({ data: { id: ids.provider, code: 'whole', name: 'whole' } });
    await prisma.company.create({ data: { id: ids.company, code: 'whole', name: 'whole' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true };
    await prisma.package.create({ data: { id: ids.pkg, code: 'whole', name: 'whole', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
  });

  beforeEach(() => {
    process.env.SECRETS_KEY = KEY;
    process.env.DATABASE_URL = own.toString();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = before.url;
    for (const [key, value] of [['SECRETS_KEY', before.key], ['REDIS_URL', before.redis]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('seals every clear code of every point of sale, open tasks and closed ones, and changes nothing else in the database', async () => {
    const made = await fill();
    const start = { rows: await rows(), others: await others() };
    expect(start.rows.lines.filter((row) => isClear(row.esimQr))).toHaveLength(made.clearLines);
    expect(start.rows.tasks.filter((row) => isClear(row.esimQr))).toHaveLength(made.clearTasks);

    // No `posId`: the scope the command itself uses.
    const done = await sealEsimCodes(prisma, { batchSize: 5 });
    expect(done.tables).toEqual({
      Line: { sealed: made.clearLines, skipped: 0, clearLeft: 0, sealedNow: made.clearLines + 2 * ids.poses.length },
      OfficeTask: { sealed: made.clearTasks, skipped: 0, clearLeft: 0, sealedNow: made.clearTasks + 2 * ids.poses.length },
    });

    const end = { rows: await rows(), others: await others() };
    for (const table of ['lines', 'tasks'] as const) {
      expect(end.rows[table]).toHaveLength(start.rows[table].length);
      for (const [at, was] of start.rows[table].entries()) {
        const now = end.rows[table][at];
        // The same row, and every column but the code exactly as it was (status, serial, terms, `updatedAt`, …).
        expect([now.id, now.rest]).toEqual([was.id, was.rest]);
        if (isClear(was.esimQr)) {
          expect(now.esimQr?.startsWith('v1:')).toBe(true);
          expect(open(now.esimQr ?? '')).toBe(was.esimQr);
        } else {
          // Sealed (readable or not) and empty values: byte for byte.
          expect(now.esimQr).toBe(was.esimQr);
        }
      }
    }
    // Wallets, the ledger, accounts, packages and task notes: untouched.
    expect(end.others).toEqual(start.others);

    // A second run finds nothing to do and changes nothing.
    const again = await sealEsimCodes(prisma, { batchSize: 5 });
    expect([again.tables.Line.sealed, again.tables.Line.skipped, again.tables.Line.clearLeft]).toEqual([0, 0, 0]);
    expect([again.tables.OfficeTask.sealed, again.tables.OfficeTask.skipped, again.tables.OfficeTask.clearLeft]).toEqual([0, 0, 0]);
    expect({ rows: await rows(), others: await others() }).toEqual(end);
    const left = await prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM "Line" WHERE "esimQr" IS NOT NULL AND "esimQr" NOT LIKE 'v1:%') + (SELECT count(*) FROM "OfficeTask" WHERE "esimQr" IS NOT NULL AND "esimQr" NOT LIKE 'v1:%') AS n`;
    expect(Number(left[0].n)).toBe(0);
  });

  it('two runs at the same moment seal each code once between them, and neither writes over the other', async () => {
    const made = await fill();
    const start = await rows();
    const [one, two] = await Promise.all([sealEsimCodes(prisma, { batchSize: 3 }), sealEsimCodes(prisma, { batchSize: 4 })]);
    expect(one.tables.Line.sealed + two.tables.Line.sealed).toBe(made.clearLines);
    expect(one.tables.OfficeTask.sealed + two.tables.OfficeTask.sealed).toBe(made.clearTasks);
    const end = await rows();
    for (const table of ['lines', 'tasks'] as const) {
      for (const [at, was] of start[table].entries()) {
        const now = end[table][at];
        expect(now.rest).toEqual(was.rest);
        if (isClear(was.esimQr)) expect(open(now.esimQr ?? '')).toBe(was.esimQr);
        else expect(now.esimQr).toBe(was.esimQr);
      }
    }
  });

  // The command itself needs Redis to build the application (the session store): run where the queue specs run.
  const redis = process.env.TEST_REDIS_URL;
  (redis ? it : it.skip)('the command: a dry run changes nothing and exits 0; the run seals everything, prints counts only and exits 0', async () => {
    process.env.REDIS_URL = redis;
    const made = await fill();
    const start = { rows: await rows(), others: await others() };
    let exit = -1;
    const dry = await capturedOutput(async () => {
      exit = await run(['--dry-run']);
    });
    expect(exit).toBe(0);
    expect(dry).toContain(`Line.esimQr: ${made.clearLines} stored clear, ${2 * ids.poses.length} sealed (dry run: nothing was changed)`);
    expect(dry).toContain(`OfficeTask.esimQr: ${made.clearTasks} stored clear, ${2 * ids.poses.length} sealed (dry run: nothing was changed)`);
    expect({ rows: await rows(), others: await others() }).toEqual(start);

    const real = await capturedOutput(async () => {
      exit = await run([]);
    });
    expect(exit).toBe(0);
    expect(real).toContain(`Line.esimQr: sealed ${made.clearLines}, skipped 0 (changed while this ran), 0 left clear`);
    expect(real).toContain(`OfficeTask.esimQr: sealed ${made.clearTasks}, skipped 0 (changed while this ran), 0 left clear`);
    expect(real).toContain('no eSIM code is stored clear');
    for (const text of [dry, real]) {
      for (const row of start.rows.lines.filter((line) => isClear(line.esimQr)).slice(0, 6)) {
        const payload = (row.esimQr ?? '').split(',')[1];
        for (let at = 0; at + 12 <= payload.length; at += 6) expect(text).not.toContain(payload.slice(at, at + 12));
      }
      for (const secret of [KEY, own.password, '+972 50-000-0000']) expect(text).not.toContain(secret);
    }
    const end = { rows: await rows(), others: await others() };
    expect(end.rows.lines.filter((row) => isClear(row.esimQr))).toEqual([]);
    expect(end.rows.tasks.filter((row) => isClear(row.esimQr))).toEqual([]);
    expect(end.rows.lines.map((row) => row.rest)).toEqual(start.rows.lines.map((row) => row.rest));
    expect(end.rows.tasks.map((row) => row.rest)).toEqual(start.rows.tasks.map((row) => row.rest));
    expect(end.others).toEqual(start.others);
  });

  it('the writes that take any column of a line or a task refuse a code that is not sealed, before they reach the database', async () => {
    const untouched = { line: { updateMany: () => { throw new Error('reached the database'); } }, officeTask: { update: () => { throw new Error('reached the database'); } } };
    const repo = new LinesRepository({ prisma } as never);
    expect(() => repo.recordTaskResult(untouched as never, 'task', { esimQr: code(1) })).toThrow('An eSIM code must be sealed before it is stored');
    expect(() => repo.recordTaskResult(untouched as never, 'task', { esimQr: { set: code(1) } })).toThrow('An eSIM code must be sealed before it is stored');
    await expect(moveLineStatus(untouched as never, 'line', ['active'], 'frozen', { esimQr: code(2) })).rejects.toThrow('An eSIM code must be sealed before it is stored');
    // A sealed value, and no code at all, go through to the write.
    expect(() => repo.recordTaskResult(untouched as never, 'task', { esimQr: sealedOk })).toThrow('reached the database');
    await expect(moveLineStatus(untouched as never, 'line', ['active'], 'frozen', {})).rejects.toThrow('reached the database');
  });
});
