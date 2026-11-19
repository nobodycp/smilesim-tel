import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-16-package-page, P.5: a number is activated on a package by
// porting it from another company, or by turning a prepaid card into a bill, when the branch turned that on for
// the package. Both take the number and the serial and open a branch task that holds the package's activation price.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('activation by porting and by card-to-bill (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `kind-${tag}`;
  const PRICE = 3000;
  const START = 100_000;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } });
  const ask = (body: Record<string, unknown>) => service.activate(pos, { packageCode: code, posLoginName: `kind-${tag}-pos`, outcome: 'success', ...body }) as Promise<{ applied: boolean; taskId?: string }>;
  const modes = (data: { portMode?: string; convertMode?: string }) => prisma.postpaidPackage.update({ where: { id: ids.pkg }, data });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `kind-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: START, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'kind' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'kind' } });
    await prisma.postpaidPackage.create({
      data: {
        id: ids.pkg, code, name: code, providerId: ids.provider, companyId: ids.company,
        // Activations run by themselves on this package: a porting still goes to the branch.
        autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
        branchCost: 1800, mainPrice: 2100, agentPrice: 2400, posPrice: PRICE, subscriberPrice: 3300,
        renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2400, renewalPosPrice: PRICE, renewalSubscriberPrice: 3300,
      },
    });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
  });

  afterEach(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.task.deleteMany({ where: { posId: ids.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: ids.pos } });
    await prisma.wallet.update({ where: { userId: ids.pos }, data: { balance: START, held: 0 } });
    await modes({ portMode: 'off', convertMode: 'off' });
  });

  afterAll(async () => {
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('is off for a package until the branch turns it on, each of the two by itself', async () => {
    expect(await prisma.postpaidPackage.findUniqueOrThrow({ where: { id: ids.pkg } })).toMatchObject({ portMode: 'off', convertMode: 'off' });
    for (const kind of ['port', 'convert']) {
      await expect(ask({ kind, msisdn: number(), iccid: serial() })).rejects.toMatchObject({ status: 400, code: 'OPERATION_DISABLED' });
    }
    await service.setPackageMode(owner, code, { portMode: 'manual' });
    await expect(ask({ kind: 'convert', msisdn: number(), iccid: serial() })).rejects.toMatchObject({ status: 400, code: 'OPERATION_DISABLED' });
    expect(await prisma.task.count({ where: { posId: ids.pos } })).toBe(0);
    const sheet = (await service.packageSheet(owner, code)) as { portMode: string; convertMode: string };
    expect(sheet).toMatchObject({ portMode: 'manual', convertMode: 'off' });
    await expect(service.setPackageMode(owner, code, { portMode: 'sometimes' })).rejects.toMatchObject({ status: 400 });
  });

  it('takes the number and the serial, and no eSIM', async () => {
    await modes({ portMode: 'manual' });
    await expect(ask({ kind: 'port', iccid: serial() })).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    await expect(ask({ kind: 'port', msisdn: number() })).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    await expect(ask({ kind: 'port', msisdn: number(), iccid: serial(), esim: true })).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    expect(await prisma.task.count({ where: { posId: ids.pos } })).toBe(0);
    expect(await wallet()).toMatchObject({ balance: START, held: 0 });
  });

  it('opens a branch task that holds the activation price, also on a package that activates by itself, and in either mode', async () => {
    for (const [kind, mode] of [['port', 'manual'], ['convert', 'auto']] as const) {
      await modes(kind === 'port' ? { portMode: mode } : { convertMode: mode });
      const msisdn = number();
      const iccid = serial();
      const answer = await ask({ kind, msisdn, iccid, outcome: 'success' });
      expect(answer.applied).toBe(false);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: answer.taskId } });
      expect(task).toMatchObject({ action: 'activate', activationKind: kind, status: 'working', msisdn, iccid, esim: false, posDelta: -PRICE, held: PRICE, unitPrice: PRICE });
      expect(await prisma.postpaidLine.count({ where: { msisdn } })).toBe(0);
    }
    expect(await wallet()).toMatchObject({ balance: START, held: 2 * PRICE });
  });

  it('creates the number at the package price when the branch completes the task, with nothing more charged', async () => {
    await modes({ portMode: 'manual' });
    const msisdn = number();
    const iccid = serial();
    const { taskId } = await ask({ kind: 'port', msisdn, iccid });
    await service.completeTask(owner, taskId as string, {});
    const line = await prisma.postpaidLine.findUniqueOrThrow({ where: { msisdn } });
    expect(line).toMatchObject({ status: 'active', iccid, esim: false, packageId: ids.pkg, posId: ids.pos });
    expect(await wallet()).toMatchObject({ balance: START - PRICE, held: 0 });
    const debits = await prisma.walletEntry.findMany({ where: { userId: ids.pos, kind: 'activate', amount: { lt: 0 } } });
    expect(debits.map((row) => row.amount)).toEqual([-PRICE]);
    // The task keeps what it was: the branch's list names it a porting.
    const listed = (await service.task(owner, taskId as string)) as { task: { activationKind: string | null; status: string } };
    expect(listed.task).toMatchObject({ activationKind: 'port', status: 'done' });
  });

  it('leaves an ordinary activation as it was: it runs by itself and its task, when one opens, has no kind', async () => {
    const made = (await service.activate(pos, { packageCode: code, posLoginName: `kind-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { applied: boolean };
    expect(made.applied).toBe(true);
    const opened = (await service.activate(pos, { packageCode: code, posLoginName: `kind-${tag}-pos`, iccid: serial(), outcome: 'fail' })) as { taskId: string };
    expect(await prisma.task.findUniqueOrThrow({ where: { id: opened.taskId } })).toMatchObject({ action: 'activate', activationKind: null });
  });

  it('refuses a kind it does not know, and a kind the database does not know', async () => {
    await expect(ask({ kind: 'steal', msisdn: number(), iccid: serial() })).rejects.toMatchObject({ status: 400 });
    await expect(prisma.postpaidPackage.update({ where: { id: ids.pkg }, data: { portMode: 'sometimes' } })).rejects.toThrow();
  });
});
