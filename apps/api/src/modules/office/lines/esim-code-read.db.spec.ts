import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { seal } from '../../shared/secret-box';
import { capturedOutput } from '../../shared/testing/captured-output';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; plan slice S.5a: an eSIM code is read whether it is stored
// as it was written or sealed, through the services that answer it. Nothing is sealed on write yet; the sealed
// rows here are written straight to the tables, as the later backfill will leave them.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 21).toString('base64');
const QR = { clear: 'data:image/png;base64,Q0xFQVItUVItQ09ERS1PTkU=', secret: 'data:image/png;base64,U0VDUkVULVFSLUNPREUtVFdP', taskSecret: 'data:image/png;base64,VEFTSy1RUi1DT0RFLVRIUkVF' };

suite('reading eSIM codes stored clear or sealed (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const line = { clear: randomUUID(), sealed: randomUUID(), damaged: randomUUID(), none: randomUUID() };
  const task = { clear: randomUUID(), sealed: randomUUID(), onLine: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  let sealedQr = '';
  let sealedTaskQr = '';
  let damagedQr = '';

  /** Every stored code, exactly as the database holds it. */
  const stored = async () => ({
    lines: await prisma.line.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true }, orderBy: { id: 'asc' } }),
    tasks: await prisma.officeTask.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true, updatedAt: true }, orderBy: { id: 'asc' } }),
  });
  const listed = async () => Object.fromEntries((await service.lines(pos)).items.map((row) => [row.id, row.esimQr]));
  const detailOf = async (id: string) => (await service.line(pos, id)).line.esimQr;
  const taskOf = async (id: string) => (await service.task(owner, id)).task.esimQr;
  /** Everything the services answer for these records. */
  const everyRead = async () => ({
    list: await listed(),
    details: Object.fromEntries(await Promise.all(Object.entries(line).map(async ([name, id]) => [name, await detailOf(id)]))),
    tasks: Object.fromEntries(await Promise.all(Object.entries(task).map(async ([name, id]) => [name, await taskOf(id)]))),
  });
  /** No part of a code, clear or sealed, longer than a few characters. */
  const expectNoCode = (text: string) => {
    for (const whole of [QR.secret, QR.taskSecret, sealedQr, sealedTaskQr, damagedQr]) {
      const payload = whole.startsWith('data:') ? whole.slice(whole.indexOf(',') + 1) : whole.slice(3);
      for (let start = 0; start + 12 <= payload.length; start += 6) expect(text).not.toContain(payload.slice(start, start + 12));
    }
    for (const word of ['Unsupported state', 'unable to authenticate', 'SECRETS_KEY is not set', 'auth tag']) expect(text).not.toContain(word);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    sealedQr = seal(QR.secret);
    sealedTaskQr = seal(QR.taskSecret);
    const [prefix, iv, tagPart, body] = seal('data:image/png;base64,REFNQUdFRC1RUi1DT0RFLUZPVVI=').split(':');
    damagedQr = `${prefix}:${iv}:${tagPart}:${body.slice(0, -4)}AAAA`;
    expect([sealedQr.startsWith('v1:'), sealedTaskQr.startsWith('v1:'), damagedQr.startsWith('v1:')]).toEqual([true, true, true]);

    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `esim-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: 100_000, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `esim-${tag}`, name: 'esim' } });
    await prisma.company.create({ data: { id: ids.company, code: `esim-${tag}`, name: 'esim' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true };
    await prisma.package.create({ data: { id: ids.pkg, code: `esim-${tag}`, name: 'esim', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
    const lineRow = (id: string, esimQr: string | null) => ({ id, msisdn: number(), iccid: `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`, esim: true, esimQr, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} });
    await prisma.line.createMany({ data: [lineRow(line.clear, QR.clear), lineRow(line.sealed, sealedQr), lineRow(line.damaged, damagedQr), lineRow(line.none, null)] });
    const taskRow = (id: string, over: Record<string, unknown>) => ({ id, action: 'sim', status: 'working', posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: 0, esim: true, ...over });
    await prisma.officeTask.createMany({
      data: [
        // Two tasks that carry a code of their own (no line yet), one clear and one sealed.
        taskRow(task.clear, { action: 'activate', esimQr: QR.clear, msisdn: number() }),
        taskRow(task.sealed, { action: 'activate', esimQr: sealedTaskQr, msisdn: number() }),
        // A task on a line: the line's code is the one shown.
        taskRow(task.onLine, { lineId: line.sealed, esimQr: null }),
      ],
    });
    service = new OfficeFacade(auth, { write: async () => [], publish: async () => undefined } as unknown as NoticeService);
  });

  afterEach(() => {
    process.env.SECRETS_KEY = KEY;
  });

  afterAll(async () => {
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
  });

  it('answers a code stored as it was written, and a sealed one opened, in the line list, the line detail and the task detail', async () => {
    const read = await capturedOutput(async () => undefined).then(everyRead);
    expect(read.list).toMatchObject({ [line.clear]: QR.clear, [line.sealed]: QR.secret, [line.none]: null });
    expect(read.details).toMatchObject({ clear: QR.clear, sealed: QR.secret, none: null });
    // A task with no line shows its own code; a task on a line shows the line's.
    expect(read.tasks).toEqual({ clear: QR.clear, sealed: QR.taskSecret, onLine: QR.secret });
    // The answers keep their shape: a string or null, never the sealed text.
    for (const value of [...Object.values(read.list), ...Object.values(read.details), ...Object.values(read.tasks)]) {
      expect(value === null || (typeof value === 'string' && !value.startsWith('v1:'))).toBe(true);
    }
  });

  it('writes nothing when it reads: every stored code is byte for byte what it was', async () => {
    const first = await stored();
    await capturedOutput(async () => {
      for (let round = 0; round < 3; round += 1) await everyRead();
    });
    expect(await stored()).toEqual(first);
    expect(first.lines.find((row) => row.id === line.sealed)?.esimQr).toBe(sealedQr);
    expect(first.lines.find((row) => row.id === line.clear)?.esimQr).toBe(QR.clear);
    expect(first.tasks.find((row) => row.id === task.sealed)?.esimQr).toBe(sealedTaskQr);
  });

  it('does not show a sealed code that is damaged, says so by a code, and keeps answering everything else', async () => {
    let read: Awaited<ReturnType<typeof everyRead>> | null = null;
    const output = await capturedOutput(async () => {
      read = await everyRead();
    });
    const answers = read as unknown as Awaited<ReturnType<typeof everyRead>>;
    expect(answers.list[line.damaged]).toBeNull();
    expect(answers.details.damaged).toBeNull();
    // The other records on the same page are answered as usual.
    expect(answers.list).toMatchObject({ [line.clear]: QR.clear, [line.sealed]: QR.secret });
    expect(output).toContain(`line ${line.damaged}: its eSIM code is stored sealed and could not be opened (unreadable); it is not shown`);
    expectNoCode(output);
    expect((await stored()).lines.find((row) => row.id === line.damaged)?.esimQr).toBe(damagedQr);
  });

  it.each([
    ['there is no key', undefined, 'no-key'],
    ['the key is not the one it was sealed with', Buffer.alloc(32, 22).toString('base64'), 'unreadable'],
  ] as const)('does not show a sealed code when %s, and still shows the ones stored clear', async (_name, key, reason) => {
    if (key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = key;
    const first = await stored();
    let read: Awaited<ReturnType<typeof everyRead>> | null = null;
    const output = await capturedOutput(async () => {
      read = await everyRead();
    });
    const answers = read as unknown as Awaited<ReturnType<typeof everyRead>>;
    expect(answers.list).toMatchObject({ [line.clear]: QR.clear, [line.sealed]: null, [line.damaged]: null, [line.none]: null });
    expect(answers.details).toEqual({ clear: QR.clear, sealed: null, damaged: null, none: null });
    expect(answers.tasks).toEqual({ clear: QR.clear, sealed: null, onLine: null });
    expect(output).toContain(`line ${line.sealed}: its eSIM code is stored sealed and could not be opened (${reason}); it is not shown`);
    expect(output).toContain(`task ${task.sealed}: its eSIM code is stored sealed and could not be opened (${reason}); it is not shown`);
    expectNoCode(output);
    expect(await stored()).toEqual(first);

    // With the right key back, the same rows read again: nothing was lost by the failed reads.
    process.env.SECRETS_KEY = KEY;
    expect(await capturedOutput(async () => undefined).then(() => detailOf(line.sealed))).toBe(QR.secret);
  });
});
