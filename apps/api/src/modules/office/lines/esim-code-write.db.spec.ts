import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import * as secretBox from '../../shared/secret-box';
import { capturedOutput } from '../../shared/testing/captured-output';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';
import * as esimCode from './esim-code';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; plan slice S.5b: an eSIM code is stored sealed on every
// path that writes one, sealed and read back before the transaction, and never stored as written.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 31).toString('base64');
const QR_A = 'data:image/png;base64,V1JJVEUtUVItQ09ERS1BQUFBQUFBQQ==';
const QR_B = 'data:image/png;base64,V1JJVEUtUVItQ09ERS1CQkJCQkJCQg==';
const QR_OLD = 'data:image/png;base64,T0xELUNMRUFSLVFSLUNPREUtT0xE';

suite('storing eSIM codes sealed (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const lineOf = (id: string) => prisma.line.findUniqueOrThrow({ where: { id } });
  const taskOf = (id: string) => prisma.officeTask.findUniqueOrThrow({ where: { id } });
  /** A line as it stands, with the code it holds. */
  const newLine = async (over: { esim?: boolean; esimQr?: string | null } = {}) => {
    const id = randomUUID();
    await prisma.line.create({ data: { id, msisdn: number(), iccid: serial(), esim: over.esim ?? false, esimQr: over.esimQr ?? null, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
    return id;
  };
  /** Everything money and records: the wallet, the lines, the tasks and the entries of this point of sale. */
  const state = async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
    return {
      balance: wallet.balance,
      held: wallet.held,
      lines: await prisma.line.findMany({ where: { posId: ids.pos }, orderBy: { id: 'asc' } }),
      tasks: await prisma.officeTask.findMany({ where: { posId: ids.pos }, orderBy: { id: 'asc' } }),
      entries: await prisma.walletEntry.count({ where: { userId: ids.pos } }),
    };
  };
  const refusalOf = (run: Promise<unknown>) => run.then(() => 'done', (error: unknown) => (error instanceof OfficeFailure ? `${error.status} ${error.code}` : `threw ${(error as Error).message}`));
  /** A stored value is sealed, and opens to the code. */
  const expectSealed = (stored: string | null, code: string) => {
    expect(stored?.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(code.slice(code.indexOf(',') + 1));
    expect(secretBox.open(stored ?? '')).toBe(code);
  };
  /** No part of a code longer than a few characters. */
  const expectNoCode = (text: string, codes: string[] = [QR_A, QR_B, QR_OLD]) => {
    for (const whole of codes) {
      const payload = whole.slice(whole.indexOf(',') + 1);
      for (let start = 0; start + 12 <= payload.length; start += 6) expect(text).not.toContain(payload.slice(start, start + 12));
    }
    for (const word of ['Unsupported state', 'unable to authenticate', 'auth tag', KEY]) expect(text).not.toContain(word);
  };
  const activateEsim = () => service.activate(pos, { packageCode: `wr-${tag}`, posLoginName: `wr-${tag}-pos`, esim: true, outcome: 'success' }) as Promise<{ applied: boolean; line: { id: string; esimQr: string } }>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = KEY;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({ id, loginName: `wr-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: 1_000_000, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `wr-${tag}`, name: 'wr' } });
    await prisma.company.create({ data: { id: ids.company, code: `wr-${tag}`, name: 'wr' } });
    const prices = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoSim: true };
    await prisma.package.create({ data: { id: ids.pkg, code: `wr-${tag}`, name: 'wr', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    service = new OfficeFacade(auth, { write: async () => [], publish: async () => undefined } as unknown as NoticeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.SECRETS_KEY = KEY;
  });

  afterAll(async () => {
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
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

  it('an activation made at once stores the code sealed and answers the code itself, charged once', async () => {
    const start = await state();
    const sold = await activateEsim();
    expect(sold.applied).toBe(true);
    expect(sold.line.esimQr).toMatch(/^data:image\/png;base64,/);
    expectSealed((await lineOf(sold.line.id)).esimQr, sold.line.esimQr);
    const end = await state();
    expect(end.entries - start.entries).toBe(1);
    expect(start.balance - end.balance).toBeGreaterThan(0);
    // Read back through the services, it is the same code (S.5a).
    expect((await service.line(pos, sold.line.id)).line.esimQr).toBe(sold.line.esimQr);
  });

  it('a SIM change stores the code sealed: on the task when it waits for the branch, on the line when it is made at once', async () => {
    const waiting = await newLine();
    const opened = (await service.swapSim(pos, waiting, { iccid: serial(), esim: true, qr: QR_A, outcome: 'fail' })) as { taskId: string };
    expectSealed((await taskOf(opened.taskId)).esimQr, QR_A);
    expect((await lineOf(waiting)).esimQr).toBeNull();

    const atOnce = await newLine();
    expect(await service.swapSim(pos, atOnce, { iccid: serial(), esim: true, qr: QR_B, outcome: 'success' })).toMatchObject({ applied: true });
    expectSealed((await lineOf(atOnce)).esimQr, QR_B);
  });

  it('completing a task that carries a sealed code hands it to the line as it is: the same stored value, sealed once', async () => {
    const lineId = await newLine();
    const { taskId } = (await service.swapSim(pos, lineId, { iccid: serial(), esim: true, qr: QR_A, outcome: 'fail' })) as { taskId: string };
    const carried = (await taskOf(taskId)).esimQr ?? '';
    const start = await state();
    expect(await service.completeTask(owner, taskId, {})).toEqual({ ok: true });
    const stored = (await lineOf(lineId)).esimQr ?? '';
    expect(stored).toBe(carried);
    expectSealed(stored, QR_A);
    // The task keeps what it carried, and a second completion is refused and writes nothing.
    expect((await taskOf(taskId)).esimQr).toBe(carried);
    const end = await state();
    expect([end.balance, end.held, end.entries - start.entries]).toEqual([start.balance, start.held, 1]);
    expect(await refusalOf(service.completeTask(owner, taskId, {}))).toBe('400 INVALID');
    expect((await state()).entries).toBe(end.entries);
    expect((await lineOf(lineId)).esimQr).toBe(carried);
  });

  it('a task opened before sealing, with its code stored as written, is sealed when it is completed', async () => {
    const lineId = await newLine();
    const taskId = randomUUID();
    const iccid = serial();
    await prisma.officeTask.create({ data: { id: taskId, action: 'sim', status: 'working', posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: 0, esim: true, lineId, iccid, esimQr: QR_OLD } });
    expect(await service.completeTask(owner, taskId, {})).toEqual({ ok: true });
    expectSealed((await lineOf(lineId)).esimQr, QR_OLD);
    expect((await lineOf(lineId)).iccid).toBe(iccid);
  });

  it('a new eSIM: the code attached at completion is stored sealed, and the held price is charged exactly once', async () => {
    const lineId = await newLine();
    const start = await state();
    const { taskId } = (await service.requestEsim(pos, lineId)) as { taskId: string };
    const price = (await state()).held - start.held;
    expect(price).toBeGreaterThan(0);
    expect(await service.completeTask(owner, taskId, { iccid: serial(), qr: QR_B })).toEqual({ ok: true });
    expectSealed((await lineOf(lineId)).esimQr, QR_B);
    const end = await state();
    expect([start.balance - end.balance, end.held]).toEqual([price, start.held]);
    expect(await refusalOf(service.completeTask(owner, taskId, { iccid: serial(), qr: QR_A }))).toBe('400 INVALID');
    const again = await state();
    expect([again.balance, again.held, again.entries]).toEqual([end.balance, end.held, end.entries]);
    expectSealed((await lineOf(lineId)).esimQr, QR_B);
  });

  it('codes stored before sealing and after it are read side by side', async () => {
    const old = await newLine({ esim: true, esimQr: QR_OLD });
    const sold = await activateEsim();
    // Both are in the list (without their codes, S.5c), and each detail reads its own.
    const ids = (await service.lines(pos, { sim: 'esim' })).items.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([old, sold.line.id]));
    expect((await service.line(pos, old)).line.esimQr).toBe(QR_OLD);
    expect((await service.line(pos, sold.line.id)).line.esimQr).toBe(sold.line.esimQr);
    expect((await lineOf(old)).esimQr).toBe(QR_OLD);
  });

  describe.each([
    ['there is no key', undefined],
    ['the key is not 32 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['the key is not base64 of a key at all', 'not-a-key'],
  ] as const)('when %s', (_name, key) => {
    const REFUSED = '500 ESIM_CODE_UNSEALABLE';
    beforeEach(() => {
      if (key === undefined) delete process.env.SECRETS_KEY;
      else process.env.SECRETS_KEY = key;
    });

    it('nothing is stored as written and nothing moves: no sale, no SIM change, no task, no completion', async () => {
      const cardLine = await newLine();
      const esimWaiting = await newLine();
      process.env.SECRETS_KEY = KEY;
      const { taskId } = (await service.requestEsim(pos, esimWaiting)) as { taskId: string };
      if (key === undefined) delete process.env.SECRETS_KEY;
      else process.env.SECRETS_KEY = key;
      const start = await state();

      const output = await capturedOutput(async () => {
        expect(await refusalOf(activateEsim())).toBe(REFUSED);
        expect(await refusalOf(service.swapSim(pos, cardLine, { iccid: serial(), esim: true, qr: QR_A, outcome: 'success' }))).toBe(REFUSED);
        expect(await refusalOf(service.swapSim(pos, cardLine, { iccid: serial(), esim: true, qr: QR_A, outcome: 'fail' }))).toBe(REFUSED);
        expect(await refusalOf(service.completeTask(owner, taskId, { iccid: serial(), qr: QR_B }))).toBe(REFUSED);
      });
      // The wallet, every line, every task and the ledger are exactly what they were.
      expect(await state()).toEqual(start);
      expect(output).toContain('there is no valid SECRETS_KEY to seal it with; the request is refused');
      expectNoCode(output);

      // Paths that store no code go on as before.
      expect(await service.swapSim(pos, cardLine, { iccid: serial(), outcome: 'success' })).toMatchObject({ applied: true });

      // With the key back, the waiting task completes once and the price is charged once.
      process.env.SECRETS_KEY = KEY;
      expect(await service.completeTask(owner, taskId, { iccid: serial(), qr: QR_B })).toEqual({ ok: true });
      expectSealed((await lineOf(esimWaiting)).esimQr, QR_B);
      expect(await refusalOf(service.completeTask(owner, taskId, { iccid: serial(), qr: QR_B }))).toBe('400 INVALID');
    });
  });

  it.each([
    ['does not open again', () => 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAA'],
    ['comes back as it was written', (plain: string) => plain],
    ['throws', () => { throw new Error('cipher failure with a secret detail'); }],
  ] as const)('a sealing that %s is refused before the transaction: no line, no charge', async (_name, broken) => {
    jest.spyOn(secretBox, 'seal').mockImplementation(broken as (plain: string) => string);
    const cardLine = await newLine();
    const start = await state();
    const output = await capturedOutput(async () => {
      expect(await refusalOf(activateEsim())).toBe('500 ESIM_CODE_UNSEALABLE');
      expect(await refusalOf(service.swapSim(pos, cardLine, { iccid: serial(), esim: true, qr: QR_A, outcome: 'success' }))).toBe('500 ESIM_CODE_UNSEALABLE');
    });
    expect(await state()).toEqual(start);
    expect(output).toContain('could not be sealed and read back; nothing is stored and the request is refused');
    expect(output).not.toContain('secret detail');
    expectNoCode(output);
  });

  it('a task whose sealed code no longer opens is not handed on, not replaced and not charged', async () => {
    const lineId = await newLine();
    const { taskId } = (await service.swapSim(pos, lineId, { iccid: serial(), esim: true, qr: QR_A, outcome: 'fail' })) as { taskId: string };
    const carried = (await taskOf(taskId)).esimQr ?? '';
    const damaged = `${carried.slice(0, -4)}AAAA`;
    await prisma.$executeRaw`UPDATE "OfficeTask" SET "esimQr" = ${damaged} WHERE "id" = ${taskId}`;
    const start = await state();
    const output = await capturedOutput(async () => {
      expect(await refusalOf(service.completeTask(owner, taskId, {}))).toBe('500 ESIM_CODE_UNREADABLE');
    });
    expect(await state()).toEqual(start);
    expect((await taskOf(taskId)).esimQr).toBe(damaged);
    expectNoCode(output, [QR_A, `x,${carried.slice(3)}`, `x,${damaged.slice(3)}`]);
  });

  it('the repositories refuse a code that is not sealed, whatever path reached them, and the transaction leaves nothing', async () => {
    // As if a new path forgot to seal: the service is handed the code as written.
    jest.spyOn(esimCode, 'storableEsimCode').mockImplementation((code) => code ?? null);
    const cardLine = await newLine();
    const start = await state();
    for (const run of [
      () => activateEsim(),
      () => service.swapSim(pos, cardLine, { iccid: serial(), esim: true, qr: QR_A, outcome: 'success' }),
      () => service.swapSim(pos, cardLine, { iccid: serial(), esim: true, qr: QR_A, outcome: 'fail' }),
    ]) {
      expect(await refusalOf(run())).toBe('threw An eSIM code must be sealed before it is stored');
    }
    expect(await state()).toEqual(start);
    const clear = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Line" WHERE "posId" = ${ids.pos} AND "esimQr" IS NOT NULL AND "esimQr" NOT LIKE 'v1:%' AND "esimQr" <> ${QR_OLD}`;
    expect(Number(clear[0].n)).toBe(0);
  });
});
