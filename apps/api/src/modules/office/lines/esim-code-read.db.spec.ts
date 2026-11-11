import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import { seal } from '../../shared/secret-box';
import { capturedOutput } from '../../shared/testing/captured-output';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';
import { LinesRepository } from './lines.repository';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0019, D17; plan slice S.5a: an eSIM code is read whether it is stored
// as it was written or sealed, through the services that answer it. Nothing is sealed on write yet; the sealed
// rows here are written straight to the tables, as the later backfill will leave them.
//
// A sealed code that does not open: a row of the line list answers `null` (the page still answers); the detail
// of a line or a task refuses the request with ESIM_CODE_UNREADABLE, never «no code»; the answer of an
// activation made at once does not read the stored value at all.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const KEY = Buffer.alloc(32, 21).toString('base64');
const QR = { clear: 'data:image/png;base64,Q0xFQVItUVItQ09ERS1PTkU=', secret: 'data:image/png;base64,U0VDUkVULVFSLUNPREUtVFdP', taskSecret: 'data:image/png;base64,VEFTSy1RUi1DT0RFLVRIUkVF' };

suite('reading eSIM codes stored clear or sealed (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), stranger: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const line = { clear: randomUUID(), sealed: randomUUID(), damaged: randomUUID(), none: randomUUID() };
  const task = { clear: randomUUID(), sealed: randomUUID(), onLine: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  let stranger: { sessionId: string };
  let sealedQr = '';
  let sealedTaskQr = '';
  let damagedQr = '';

  /** Every stored code, exactly as the database holds it. */
  const stored = async () => ({
    lines: await prisma.line.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true }, orderBy: { id: 'asc' } }),
    tasks: await prisma.officeTask.findMany({ where: { posId: ids.pos }, select: { id: true, esimQr: true, updatedAt: true }, orderBy: { id: 'asc' } }),
  });
  const listed = async () => Object.fromEntries((await service.lines(pos)).items.map((row) => [row.id, row.esimQr]));
  const REFUSED = '500 ESIM_CODE_UNREADABLE';
  /** The code a detail answers, or `<status> <code>` when the request is refused. Anything else thrown is a crash. */
  const answered = async (read: () => Promise<string | null>) => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof OfficeFailure) return `${error.status} ${error.code}`;
      throw error;
    }
  };
  const detailOf = (id: string) => answered(async () => (await service.line(pos, id)).line.esimQr);
  const taskOf = (id: string) => answered(async () => (await service.task(owner, id)).task.esimQr);
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
    // Another point of sale under the same branch: it has no part in the first one's lines or tasks.
    await prisma.user.create({ data: { ...user(ids.stranger, 'pos', ids.owner, false), loginName: `esim-${tag}-other`, wallet: { create: { balance: 0, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false), { ...user(ids.stranger, 'pos', ids.owner, false), loginName: `esim-${tag}-other` }]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    stranger = { sessionId: await auth.saveSession({ userId: ids.stranger, scope: 'full', userAgent: '', ip: '' }) };
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
        // A task on a line that does not replace its code: the line's code is the one shown.
        taskRow(task.onLine, { action: 'freeze', lineId: line.sealed, esimQr: null }),
      ],
    });
    service = new OfficeFacade(auth, { write: async () => [], publish: async () => undefined } as unknown as NoticeService);
  });

  afterEach(() => {
    process.env.SECRETS_KEY = KEY;
  });

  afterAll(async () => {
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos, ids.stranger] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.pos, ids.stranger] } } });
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

  it('a sealed code that is damaged: null in its row of the list, a refusal in its detail, everything else answered', async () => {
    let read: Awaited<ReturnType<typeof everyRead>> | null = null;
    const output = await capturedOutput(async () => {
      read = await everyRead();
    });
    const answers = read as unknown as Awaited<ReturnType<typeof everyRead>>;
    expect(answers.list[line.damaged]).toBeNull();
    // The detail does not call it «no code»: a line that truly has none answers null, this one is refused.
    expect(answers.details).toEqual({ clear: QR.clear, sealed: QR.secret, damaged: REFUSED, none: null });
    // The other records on the same page are answered as usual.
    expect(answers.list).toMatchObject({ [line.clear]: QR.clear, [line.sealed]: QR.secret, [line.none]: null });
    expect(answers.tasks).toEqual({ clear: QR.clear, sealed: QR.taskSecret, onLine: QR.secret });
    expect(output).toContain(`line ${line.damaged}: its eSIM code is stored sealed and could not be opened (unreadable); it is not shown`);
    expect(output).toContain(`line ${line.damaged}: its eSIM code is stored sealed and could not be opened (unreadable); the request is refused`);
    // The refusal itself carries the catalog message and nothing else.
    let refusal: unknown = null;
    await capturedOutput(async () => {
      refusal = await service.line(pos, line.damaged).catch((error: unknown) => error);
    });
    expect(refusal).toBeInstanceOf(OfficeFailure);
    expect([(refusal as OfficeFailure).status, (refusal as OfficeFailure).code, (refusal as OfficeFailure).message]).toEqual([500, 'ESIM_CODE_UNREADABLE', 'تعذّرت قراءة رمز eSIM المحفوظ. تواصل مع الدعم']);
    expectNoCode(`${(refusal as Error).message} ${(refusal as Error).stack ?? ''} ${JSON.stringify(refusal)}`);
    expectNoCode(output);
    expect((await stored()).lines.find((row) => row.id === line.damaged)?.esimQr).toBe(damagedQr);
  });

  it.each([
    ['there is no key', undefined, 'no-key'],
    ['the key is not the one it was sealed with', Buffer.alloc(32, 22).toString('base64'), 'unreadable'],
  ] as const)('when %s: sealed codes are null in the list and refused in the details, and the ones stored clear are still shown', async (_name, key, reason) => {
    if (key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = key;
    const first = await stored();
    let read: Awaited<ReturnType<typeof everyRead>> | null = null;
    const output = await capturedOutput(async () => {
      read = await everyRead();
    });
    const answers = read as unknown as Awaited<ReturnType<typeof everyRead>>;
    expect(answers.list).toMatchObject({ [line.clear]: QR.clear, [line.sealed]: null, [line.damaged]: null, [line.none]: null });
    expect(answers.details).toEqual({ clear: QR.clear, sealed: REFUSED, damaged: REFUSED, none: null });
    // A task with its own sealed code, and a task on a line whose code is sealed: both refused.
    expect(answers.tasks).toEqual({ clear: QR.clear, sealed: REFUSED, onLine: REFUSED });
    expect(output).toContain(`line ${line.sealed}: its eSIM code is stored sealed and could not be opened (${reason}); it is not shown`);
    expect(output).toContain(`line ${line.sealed}: its eSIM code is stored sealed and could not be opened (${reason}); the request is refused`);
    expect(output).toContain(`task ${task.sealed}: its eSIM code is stored sealed and could not be opened (${reason}); the request is refused`);
    expectNoCode(output);
    expect(await stored()).toEqual(first);

    // With the right key back, the same rows read again: nothing was lost by the failed reads.
    process.env.SECRETS_KEY = KEY;
    expect(await capturedOutput(async () => undefined).then(() => detailOf(line.sealed))).toBe(QR.secret);
  });

  it('an activation made at once answers the code it issued, takes the money once, and does not depend on reading the stored value', async () => {
    const wallet = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } })).balance;
    const sell = () => service.activate(pos, { packageCode: `esim-${tag}`, posLoginName: `esim-${tag}-pos`, esim: true, outcome: 'success' }) as Promise<{ applied: boolean; debited: boolean; line: { id: string; esimQr: string | null } }>;
    const entriesOf = (lineId: string) => prisma.walletEntry.findMany({ where: { lineId, kind: 'activate' } });

    // As things are written today: the code is stored as issued, and the answer is that code.
    const start = await wallet();
    const plain = await sell();
    expect(plain).toMatchObject({ applied: true, debited: true });
    expect(plain.line.esimQr).toMatch(/^data:image\//);
    expect((await prisma.line.findUniqueOrThrow({ where: { id: plain.line.id } })).esimQr).toBe(plain.line.esimQr);
    const price = start - (await wallet());
    expect(price).toBeGreaterThan(0);
    expect(await entriesOf(plain.line.id)).toHaveLength(1);

    // The worst case once codes are sealed on write: what was stored does not open. The sale still answers as a
    // sale, with the code, so nobody sends it again; the money is taken once; the fault shows on the line's detail.
    const create = jest.spyOn(LinesRepository.prototype, 'createLine').mockImplementationOnce(function (this: LinesRepository, db, data) {
      create.mockRestore();
      return this.createLine(db, { ...data, esimQr: damagedQr });
    });
    const before = await wallet();
    let sold: Awaited<ReturnType<typeof sell>> | null = null;
    const output = await capturedOutput(async () => {
      sold = await sell();
    });
    const answer = sold as unknown as Awaited<ReturnType<typeof sell>>;
    expect(answer).toMatchObject({ applied: true, debited: true });
    expect(answer.line.esimQr).toMatch(/^data:image\//);
    expect(answer.line.esimQr).not.toBe(plain.line.esimQr);
    expect(before - (await wallet())).toBe(price);
    expect(await entriesOf(answer.line.id)).toHaveLength(1);
    expect((await prisma.line.findUniqueOrThrow({ where: { id: answer.line.id } })).esimQr).toBe(damagedQr);
    expect(output).not.toContain('could not be opened');
    expectNoCode(output);
    // Reading it afterwards is where the fault is seen, and it is not called «no code».
    await capturedOutput(async () => {
      expect(await detailOf(answer.line.id)).toBe(REFUSED);
      expect((await listed())[answer.line.id]).toBeNull();
    });
  });

  it('the SIM / eSIM filter narrows in the database, inside what the caller sees, and never answers a sealed text', async () => {
    const card = randomUUID();
    await prisma.line.create({ data: { id: card, msisdn: `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, iccid: `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`, esim: false, esimQr: null, status: 'frozen', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
    await capturedOutput(async () => {
      const all = await service.lines(pos);
      const esims = await service.lines(pos, { sim: 'esim' });
      const cards = await service.lines(pos, { sim: 'sim' });
      // The totals are counted with the filter, so the pages are cut after it.
      expect(esims.total + cards.total).toBe(all.total);
      expect(esims.items.length).toBe(esims.total);
      expect(esims.items.every((row) => row.esim)).toBe(true);
      expect(cards.items.map((row) => row.id)).toEqual([card]);
      // With another filter, and with one that leaves nothing.
      expect((await service.lines(pos, { sim: 'sim', status: 'frozen' })).items.map((row) => row.id)).toEqual([card]);
      expect(await service.lines(pos, { sim: 'sim', status: 'active' })).toMatchObject({ total: 0, items: [] });
      // The same filter for an account that sees none of these lines, and through a login name it may not see.
      expect(await service.lines(stranger, { sim: 'esim' })).toMatchObject({ total: 0, items: [] });
      expect(await service.lines(stranger, { sim: 'esim', loginName: `esim-${tag}-pos` })).toMatchObject({ total: 0, items: [] });
      // A code that does not open is null in a filtered page too.
      expect(esims.items.find((row) => row.id === line.damaged)?.esimQr).toBeNull();
      expect(JSON.stringify(esims)).not.toContain('v1:');
      // A kind that is not one of the two is refused, not read as «all».
      await expect(service.lines(pos, { sim: 'card' })).rejects.toMatchObject({ status: 400 });
    });
    await prisma.line.delete({ where: { id: card } });
  });

  // Owner's correction, 2026-11-11: an open task that replaces a line's code still opens when the old code does
  // not, because completing it is the repair.
  describe('an open task that replaces a code that no longer opens', () => {
    const NEW_QR = 'data:image/png;base64,TkVXLVFSLUNPREUtRklWRQ==';
    const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
    const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
    /** An active eSIM line whose stored code is sealed and does not open. */
    const damagedLine = async () => {
      const id = randomUUID();
      await prisma.line.create({ data: { id, msisdn: number(), iccid: serial(), esim: true, esimQr: damagedQr, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
      return id;
    };
    const money = async (lineId: string) => {
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
      const entries = await prisma.walletEntry.findMany({ where: { lineId } });
      return { balance: wallet.balance, held: wallet.held, moved: entries.filter((entry) => entry.amount !== 0).map((entry) => entry.amount), entries: entries.length };
    };
    const refusalOf = async (run: Promise<unknown>) => run.then(() => 'done', (error: unknown) => (error instanceof OfficeFailure ? `${error.status} ${error.code}` : Promise.reject(error)));
    const taskAs = (gate: { sessionId: string }, id: string) => answered(async () => (await service.task(gate, id)).task.esimQr);
    const lineCode = async (id: string) => (await prisma.line.findUniqueOrThrow({ where: { id } })).esimQr;

    it('a SIM change: its detail opens for the same readers only, shows the new code and never the old one, and completing it repairs the line with no money moved', async () => {
      const lineId = await damagedLine();
      const before = await money(lineId);
      let taskId = '';
      const output = await capturedOutput(async () => {
        const opened = (await service.swapSim(pos, lineId, { iccid: serial(), esim: true, qr: NEW_QR, outcome: 'fail' })) as { applied: boolean; taskId: string };
        expect(opened.applied).toBe(false);
        taskId = opened.taskId;
        // The handler and the submitter read it; the code shown is the one the task hands over.
        expect(await taskAs(owner, taskId)).toBe(NEW_QR);
        expect(await taskAs(pos, taskId)).toBe(NEW_QR);
        // The permission checks are what they were: an account outside the task does not see it.
        expect(await taskAs(stranger, taskId)).toBe('404 NOT_FOUND');
        // The line's own detail is still a fault.
        expect(await detailOf(lineId)).toBe(REFUSED);
        const whole = JSON.stringify(await service.task(owner, taskId));
        expect(whole).not.toContain('v1:');
        expectNoCode(whole.split(NEW_QR).join(''));
      });
      // The old code is not read for the task at all: the only fault logged is the line's own detail, asked above.
      expect(output.split('could not be opened').length - 1).toBe(1);
      expectNoCode(output);
      expect(await lineCode(lineId)).toBe(damagedQr);

      expect(await service.completeTask(owner, taskId, {})).toEqual({ ok: true });
      expect(await lineCode(lineId)).toBe(NEW_QR);
      expect(await detailOf(lineId)).toBe(NEW_QR);
      expect(await taskAs(owner, taskId)).toBe(NEW_QR);
      const after = await money(lineId);
      expect({ balance: after.balance, held: after.held, moved: after.moved }).toEqual({ balance: before.balance, held: before.held, moved: [] });
      // A second completion is refused and writes nothing.
      expect(await refusalOf(service.completeTask(owner, taskId, {}))).toBe('400 INVALID');
      expect(await money(lineId)).toEqual(after);
    });

    it('a new eSIM: its detail opens with no code yet, and completing it charges the held price exactly once', async () => {
      const lineId = await damagedLine();
      const before = await money(lineId);
      let taskId = '';
      const output = await capturedOutput(async () => {
        taskId = ((await service.requestEsim(pos, lineId)) as { taskId: string }).taskId;
        expect(await taskAs(owner, taskId)).toBeNull();
        expect(await taskAs(pos, taskId)).toBeNull();
        expect(await taskAs(stranger, taskId)).toBe('404 NOT_FOUND');
      });
      expectNoCode(output);
      const held = await money(lineId);
      const price = held.held - before.held;
      expect(price).toBeGreaterThan(0);
      expect(held.balance).toBe(before.balance);

      expect(await service.completeTask(owner, taskId, { iccid: serial(), qr: NEW_QR })).toEqual({ ok: true });
      const after = await money(lineId);
      expect({ balance: after.balance, held: after.held, moved: after.moved }).toEqual({ balance: before.balance - price, held: before.held, moved: [-price] });
      expect(await lineCode(lineId)).toBe(NEW_QR);
      expect(await detailOf(lineId)).toBe(NEW_QR);
      expect(await refusalOf(service.completeTask(owner, taskId, { iccid: serial(), qr: NEW_QR }))).toBe('400 INVALID');
      expect(await money(lineId)).toEqual(after);
    });

    it('a new code that does not open either is never passed over: the detail and the completion are refused, nothing is written, and a code given at completion repairs it', async () => {
      const lineId = await damagedLine();
      const healthyLine = randomUUID();
      await prisma.line.create({ data: { id: healthyLine, msisdn: number(), iccid: serial(), esim: true, esimQr: QR.clear, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
      const open = async (line: string) => ((await service.swapSim(pos, line, { iccid: serial(), esim: true, qr: NEW_QR, outcome: 'fail' })) as { taskId: string }).taskId;
      const onDamaged = await open(lineId);
      const onHealthy = await open(healthyLine);
      // As a sealed code that does not open would sit on the task once codes are sealed on write.
      await prisma.officeTask.updateMany({ where: { id: { in: [onDamaged, onHealthy] } }, data: { esimQr: damagedQr } });
      const before = { damaged: await money(lineId), healthy: await money(healthyLine) };

      const output = await capturedOutput(async () => {
        for (const taskId of [onDamaged, onHealthy]) {
          expect(await taskAs(owner, taskId)).toBe(REFUSED);
          expect(await refusalOf(service.completeTask(owner, taskId, {}))).toBe(REFUSED);
          expect((await prisma.officeTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('working');
        }
      });
      expect(output).toContain(`task ${onDamaged}: its eSIM code is stored sealed and could not be opened (unreadable); the request is refused`);
      expect(output).toContain(`task ${onHealthy}: its eSIM code is stored sealed and could not be opened (unreadable); the request is refused`);
      expectNoCode(output);
      expect(await lineCode(lineId)).toBe(damagedQr);
      expect(await lineCode(healthyLine)).toBe(QR.clear);
      expect({ damaged: await money(lineId), healthy: await money(healthyLine) }).toEqual(before);

      // The handler attaches a code that reads: the task closes and the line is repaired.
      await capturedOutput(async () => {
        expect(await service.completeTask(owner, onDamaged, { qr: NEW_QR })).toEqual({ ok: true });
      });
      expect(await lineCode(lineId)).toBe(NEW_QR);
      expect((await money(lineId)).moved).toEqual([]);
    });

    // Owner's rule, 2026-11-12: an open task that replaces a SIM shows the new SIM, never the one it replaces.
    it('a SIM change on a line whose code reads: the open task shows the new serial, kind and code, never the old ones; closed, it shows the line again', async () => {
      const simOf = async (gate: { sessionId: string }, id: string) => {
        const { task: read } = await service.task(gate, id);
        return { iccid: read.iccid, esim: read.esim, esimQr: read.esimQr };
      };
      const healthy = async (over: { esim: boolean; esimQr: string | null }) => {
        const id = randomUUID();
        const iccid = serial();
        await prisma.line.create({ data: { id, msisdn: number(), iccid, ...over, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
        return { id, iccid };
      };
      const open = async (lineId: string, body: Record<string, unknown>) => ((await service.swapSim(pos, lineId, { outcome: 'fail', ...body })) as { taskId: string }).taskId;

      // eSIM to eSIM: the new code, not the old one.
      const esimLine = await healthy({ esim: true, esimQr: QR.clear });
      const newSerial = serial();
      const toEsim = await open(esimLine.id, { iccid: newSerial, esim: true, qr: NEW_QR });
      for (const gate of [owner, pos]) expect(await simOf(gate, toEsim)).toEqual({ iccid: newSerial, esim: true, esimQr: NEW_QR });
      expect(JSON.stringify(await service.task(owner, toEsim))).not.toContain(QR.clear);
      expect(await taskAs(stranger, toEsim)).toBe('404 NOT_FOUND');
      // The line itself still shows what it holds until the task is done.
      expect(await detailOf(esimLine.id)).toBe(QR.clear);

      // eSIM to a card: the task carries no code, and the old one is not shown as the replacement.
      const cardLine = await healthy({ esim: true, esimQr: QR.clear });
      const cardSerial = serial();
      const toCard = await open(cardLine.id, { iccid: cardSerial });
      expect(await simOf(owner, toCard)).toEqual({ iccid: cardSerial, esim: false, esimQr: null });

      // A card to an eSIM: the task is shown as the eSIM it hands over.
      const plastic = await healthy({ esim: false, esimQr: null });
      const fromCardSerial = serial();
      const fromCard = await open(plastic.id, { iccid: fromCardSerial, esim: true, qr: NEW_QR });
      expect(await simOf(owner, fromCard)).toEqual({ iccid: fromCardSerial, esim: true, esimQr: NEW_QR });

      // Completed: the line holds the new SIM and the closed task shows the line. No money moved; once only.
      const before = await money(esimLine.id);
      expect(await service.completeTask(owner, toEsim, {})).toEqual({ ok: true });
      expect(await simOf(owner, toEsim)).toEqual({ iccid: newSerial, esim: true, esimQr: NEW_QR });
      expect(await detailOf(esimLine.id)).toBe(NEW_QR);
      const after = await money(esimLine.id);
      expect({ balance: after.balance, held: after.held, moved: after.moved }).toEqual({ balance: before.balance, held: before.held, moved: [] });
      expect(await refusalOf(service.completeTask(owner, toEsim, {}))).toBe('400 INVALID');
      expect(await money(esimLine.id)).toEqual(after);

      // Cancelled and rejected: the line was not changed, and the closed task shows the line's SIM as it is.
      expect(await service.cancelTask(pos, toCard)).toBeTruthy();
      expect(await simOf(owner, toCard)).toEqual({ iccid: cardLine.iccid, esim: true, esimQr: QR.clear });
      expect(await service.rejectTask(owner, fromCard, { reason: 'not this card' })).toBeTruthy();
      expect(await simOf(owner, fromCard)).toEqual({ iccid: plastic.iccid, esim: false, esimQr: null });
      expect(await lineCode(cardLine.id)).toBe(QR.clear);
    });

    it('a new eSIM on a line whose code reads: the open task shows no code, and cancelling it gives the hold back once', async () => {
      const id = randomUUID();
      await prisma.line.create({ data: { id, msisdn: number(), iccid: serial(), esim: true, esimQr: QR.clear, status: 'active', packageId: ids.pkg, posId: ids.pos, endsAt: new Date(Date.now() + 20 * 86_400_000), terms: {} } });
      const before = await money(id);
      const taskId = ((await service.requestEsim(pos, id)) as { taskId: string }).taskId;
      expect(await taskAs(owner, taskId)).toBeNull();
      expect((await money(id)).held).toBeGreaterThan(before.held);
      await service.cancelTask(pos, taskId);
      // Closed without a change: the line's own code is shown again, and the money is where it was.
      expect(await taskAs(owner, taskId)).toBe(QR.clear);
      const after = await money(id);
      expect({ balance: after.balance, held: after.held, moved: after.moved }).toEqual({ balance: before.balance, held: before.held, moved: [] });
      expect(await refusalOf(service.cancelTask(pos, taskId))).toBe('400 INVALID');
      expect(await money(id)).toEqual(after);
    });

    it('every other task on such a line, and a replacing task once it is closed, still refuse', async () => {
      const lineId = await damagedLine();
      const row = (action: string, status: string) => ({ id: randomUUID(), action, status, posId: ids.pos, packageId: ids.pkg, submitterId: ids.pos, posDelta: 0, esim: true, lineId, esimQr: null });
      const rows = { freeze: row('freeze', 'working'), rename: row('rename', 'working'), simDone: row('sim', 'done'), simRejected: row('sim', 'rejected'), esimClosed: row('esim', 'cancelled') };
      await prisma.officeTask.createMany({ data: Object.values(rows) });
      const output = await capturedOutput(async () => {
        for (const task of Object.values(rows)) expect([task.action, task.status, await taskAs(owner, task.id)]).toEqual([task.action, task.status, REFUSED]);
        expect(await detailOf(lineId)).toBe(REFUSED);
      });
      expectNoCode(output);
    });
  });
});
