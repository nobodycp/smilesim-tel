import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './db';
import { open, seal } from './modules/shared/secret-box';
import { capturedOutput } from './modules/shared/testing/captured-output';
import { NoSealingKey, sealEsimCodes, sealRunLines, type CodeTable } from './seal-esim-codes';
import { run } from './seal-secrets';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; plan slice S.5b: the backfill that seals the eSIM codes
// stored before sealing on write. Every run here is limited to this spec's own point of sale (`posId`), so the
// rows other specs keep clear on purpose are never touched.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 41).toString('base64');
const code = (n: number) => `data:image/png;base64,${Buffer.from(`BACKFILL-QR-CODE-NUMBER-${String(n).padStart(4, '0')}`).toString('base64')}`;

suite('sealing stored eSIM codes (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let sealedBefore = '';
  let damaged = '';

  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  type Row = { id: string; esimQr: string | null; updatedAt?: Date };
  const lines = (): Promise<Row[]> => prisma.line.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true }, orderBy: { id: 'asc' } });
  const tasks = (): Promise<Row[]> => prisma.officeTask.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true, updatedAt: true }, orderBy: { id: 'asc' } });
  const clearOf = (rows: Row[]) => rows.filter((row) => row.esimQr && !row.esimQr.startsWith('v1:'));
  const mine = { posId: ids.pos };
  /** Puts the rows back: 7 clear lines, one sealed, one sealed that does not open, one with no code; 5 clear tasks and a sealed one. */
  const reset = async () => {
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    const line = (esimQr: string | null) => ({ id: randomUUID(), msisdn: number(), iccid: serial(), esim: true, esimQr, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} });
    await prisma.line.createMany({ data: [...Array.from({ length: 7 }, (_, n) => line(code(n))), line(sealedBefore), line(damaged), line(null)] });
    const task = (esimQr: string | null) => ({ id: randomUUID(), action: 'activate', status: 'done', posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: 0, esim: true, esimQr });
    await prisma.officeTask.createMany({ data: [...Array.from({ length: 5 }, (_, n) => task(code(100 + n))), task(sealedBefore)] });
  };
  /** Each stored value opens to the code it held before, whatever its id. */
  const opened = (rows: Row[]) => rows.map((row) => (row.esimQr && row.esimQr !== damaged ? open(row.esimQr) : row.esimQr)).sort();
  const expectNoCode = (text: string) => {
    for (let n = 0; n < 7; n += 1) {
      const payload = code(n).slice(code(n).indexOf(',') + 1);
      for (let start = 0; start + 12 <= payload.length; start += 6) expect(text).not.toContain(payload.slice(start, start + 12));
    }
    expect(text).not.toContain(KEY);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    sealedBefore = seal(code(900));
    damaged = `${seal(code(901)).slice(0, -4)}AAAA`;
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({ id, loginName: `bf-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner });
    await prisma.user.create({ data: user(ids.owner, 'branch', null, true) });
    await prisma.user.create({ data: user(ids.pos, 'pos', ids.owner, false) });
    await prisma.provider.create({ data: { id: ids.provider, code: `bf-${tag}`, name: 'bf' } });
    await prisma.company.create({ data: { id: ids.company, code: `bf-${tag}`, name: 'bf' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true };
    await prisma.package.create({ data: { id: ids.pkg, code: `bf-${tag}`, name: 'bf', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
  });

  beforeEach(async () => {
    process.env.SECRETS_KEY = KEY;
    await reset();
  });

  afterAll(async () => {
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
  });

  it('seals every clear code, leaves sealed ones byte for byte, and a second run changes nothing', async () => {
    const start = { lines: await lines(), tasks: await tasks() };
    const first = await sealEsimCodes(prisma, { ...mine, batchSize: 3 });
    expect(first.tables).toEqual({
      Line: { sealed: 7, skipped: 0, clearLeft: 0, sealedNow: 9 },
      OfficeTask: { sealed: 5, skipped: 0, clearLeft: 0, sealedNow: 6 },
    });
    const after = { lines: await lines(), tasks: await tasks() };
    expect(clearOf(after.lines)).toEqual([]);
    expect(clearOf(after.tasks)).toEqual([]);
    // Each row holds the code it held, and the rows that were sealed (one of them unreadable) or empty are untouched.
    expect(opened(after.lines)).toEqual(opened(start.lines));
    expect(opened(after.tasks)).toEqual(opened(start.tasks));
    for (const kept of [sealedBefore, damaged]) expect(after.lines.filter((row) => row.esimQr === kept)).toHaveLength(1);
    expect(after.lines.filter((row) => row.esimQr === null)).toHaveLength(1);
    // Nothing else about a task moved: its `updatedAt` is what it was.
    expect(after.tasks.map((row) => [row.id, row.updatedAt])).toEqual(start.tasks.map((row) => [row.id, row.updatedAt]));

    const second = await sealEsimCodes(prisma, { ...mine, batchSize: 3 });
    expect(second.tables.Line).toEqual({ sealed: 0, skipped: 0, clearLeft: 0, sealedNow: 9 });
    expect(second.tables.OfficeTask).toEqual({ sealed: 0, skipped: 0, clearLeft: 0, sealedNow: 6 });
    expect({ lines: await lines(), tasks: await tasks() }).toEqual(after);
  });

  it('a dry run counts and writes nothing', async () => {
    const start = { lines: await lines(), tasks: await tasks() };
    const dry = await sealEsimCodes(prisma, { ...mine, dryRun: true });
    expect(dry).toEqual({ dryRun: true, tables: { Line: { sealed: 0, skipped: 0, clearLeft: 7, sealedNow: 2 }, OfficeTask: { sealed: 0, skipped: 0, clearLeft: 5, sealedNow: 1 } } });
    expect({ lines: await lines(), tasks: await tasks() }).toEqual(start);
    expect(sealRunLines(dry)).toEqual([
      'Line.esimQr: 7 stored clear, 2 sealed (dry run: nothing was changed)',
      'OfficeTask.esimQr: 5 stored clear, 1 sealed (dry run: nothing was changed)',
    ]);
  });

  it('stopped half-way and run again, it ends where an unbroken run ends, sealing nothing twice', async () => {
    const start = { lines: await lines(), tasks: await tasks() };
    const stop = async (table: CodeTable, done: number) => {
      if (table === 'Line' && done >= 2) throw new Error('the machine went down');
    };
    await expect(sealEsimCodes(prisma, { ...mine, batchSize: 2, afterBatch: stop })).rejects.toThrow('the machine went down');
    const half = { lines: await lines(), tasks: await tasks() };
    // What the first batch committed stays sealed; the rest is as it was: a mix the readers accept.
    expect(clearOf(half.lines)).toHaveLength(5);
    expect(clearOf(half.tasks)).toHaveLength(5);
    const sealedInHalf = half.lines.filter((row) => row.esimQr?.startsWith('v1:'));

    const rest = await sealEsimCodes(prisma, { ...mine, batchSize: 2 });
    expect(rest.tables.Line).toEqual({ sealed: 5, skipped: 0, clearLeft: 0, sealedNow: 9 });
    expect(rest.tables.OfficeTask).toEqual({ sealed: 5, skipped: 0, clearLeft: 0, sealedNow: 6 });
    const end = { lines: await lines(), tasks: await tasks() };
    expect(opened(end.lines)).toEqual(opened(start.lines));
    expect(opened(end.tasks)).toEqual(opened(start.tasks));
    // The rows the broken run sealed were not sealed again.
    for (const row of sealedInHalf) expect(end.lines.find((line) => line.id === row.id)?.esimQr).toBe(row.esimQr);
  });

  it('does not write over a row that changed between its read and its write; the next run sees the new value', async () => {
    const NEW = code(555);
    let changed = '';
    let cleared = '';
    const change = async (table: CodeTable, batch: string[]) => {
      if (table !== 'Line' || changed) return;
      [changed, cleared] = batch;
      // As the office would: one line is given a new code, another loses its code, while the run holds the old ones.
      await prisma.$executeRaw`UPDATE "Line" SET "esimQr" = ${NEW} WHERE "id" = ${changed}`;
      await prisma.$executeRaw`UPDATE "Line" SET "esimQr" = NULL WHERE "id" = ${cleared}`;
    };
    const first = await sealEsimCodes(prisma, { ...mine, batchSize: 4, beforeWrite: change });
    expect(first.tables.Line).toEqual({ sealed: 5, skipped: 2, clearLeft: 1, sealedNow: 7 });
    const after = await lines();
    expect(after.find((row) => row.id === changed)?.esimQr).toBe(NEW);
    expect(after.find((row) => row.id === cleared)?.esimQr).toBeNull();
    expect(sealRunLines(first).at(-1)).toBe('1 eSIM code(s) are still stored clear: run this again');

    const second = await sealEsimCodes(prisma, { ...mine, batchSize: 4 });
    expect(second.tables.Line).toEqual({ sealed: 1, skipped: 0, clearLeft: 0, sealedNow: 8 });
    const end = await lines();
    expect(open(end.find((row) => row.id === changed)?.esimQr ?? '')).toBe(NEW);
    expect(end.find((row) => row.id === cleared)?.esimQr).toBeNull();
    expect(sealRunLines(second).at(-1)).toBe('no eSIM code is stored clear');
  });

  it.each([
    ['there is no key', undefined],
    ['the key is not 32 bytes', Buffer.alloc(8, 3).toString('base64')],
  ] as const)('refuses to start when %s, before it reads or writes', async (_name, key) => {
    if (key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = key;
    const start = { lines: await lines(), tasks: await tasks() };
    await expect(sealEsimCodes(prisma, mine)).rejects.toBeInstanceOf(NoSealingKey);
    await expect(sealEsimCodes(prisma, { ...mine, dryRun: true })).rejects.toBeInstanceOf(NoSealingKey);
    // The command itself: exit code 2, and it says nothing was read or changed.
    let exit = -1;
    const output = await capturedOutput(async () => {
      exit = await run([]);
    });
    expect(exit).toBe(2);
    expect(output).toContain('SECRETS_KEY is not set, or is not 32 bytes of base64; nothing was read or changed');
    expect({ lines: await lines(), tasks: await tasks() }).toEqual(start);
  });

  it('the command refuses an argument it does not know, and its lines carry counts only', async () => {
    let exit = -1;
    const refused = await capturedOutput(async () => {
      exit = await run(['--force']);
    });
    expect(exit).toBe(2);
    expect(refused).toContain('unknown argument: only --dry-run is accepted; nothing was read or changed');
    const done = await sealEsimCodes(prisma, { ...mine, batchSize: 3 });
    const text = sealRunLines(done).join('\n');
    expect(text).toContain('Line.esimQr: sealed 7, skipped 0 (changed while this ran), 0 left clear, 9 sealed in all');
    expectNoCode(text);
    expectNoCode(JSON.stringify(done));
  });
});
