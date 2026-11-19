import { useSealingKey } from '../../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import type { WalletEntry } from '../../../generated/prisma/client';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Ladder } from '../pricing';
import type { NoticeService } from '../../notifications/notice.service';
import { ApiFacade } from '../../testing/api-facade';

// PostgreSQL only (TEST_DATABASE_URL). A renewal that moves a number onto another package (`renewOnto`) is a sale of
// that package: its entry's price ladder and the margins stored from it (ADR 0026) are built from the target's price
// rows, the same on the immediate path (`LinesService.extend`, which debits before it moves the line) as on the task
// path (`task-completion.ts` `renew`, which moves the line first). A debit the ceiling refuses leaves the line as it was.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

// Each layer earns a different amount on each package, so a ladder read from the wrong package shows.
const A = { branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
const B = { branchCost: 3000, mainPrice: 3400, agentPrice: 4000, posPrice: 4600, subscriberPrice: 5000, renewalBranchCost: 2500, renewalMainPrice: 2900, renewalAgentPrice: 3600, renewalPosPrice: 4300, renewalSubscriberPrice: 5000 };

suite('a renewal onto another package is priced on that package (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), a: randomUUID(), b: randomUUID() };
  const code = (name: string) => `rt-${tag}-${name}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const lineOnA = async () => ((await service.activate(pos, { packageCode: code('a'), posLoginName: code('pos'), iccid: serial(), outcome: 'success' })) as { line: { id: string } }).line.id;
  const extendOf = (lineId: string) => prisma.walletEntry.findFirstOrThrow({ where: { lineId, kind: 'extend' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const stored = (row: WalletEntry) => ({
    packageName: row.packageName, amount: row.amount, providerCost: row.providerCost, ladder: row.ladder as unknown as Ladder,
    chainPosId: row.chainPosId, chainAgentId: row.chainAgentId, chainMainAgentId: row.chainMainAgentId,
    posMargin: row.posMargin, agentMargin: row.agentMargin, mainAgentMargin: row.mainAgentMargin, branchMargin: row.branchMargin,
  });

  // Package B's renewal, worked out by hand: the point of sale pays B's renewal price and sells at B's renewal
  // subscriber price; each layer above buys at its B renewal column.
  const onB = {
    packageName: code('b'),
    amount: -B.renewalPosPrice,
    providerCost: B.renewalBranchCost,
    ladder: {
      kind: 'renewal',
      chain: [u.pos, u.agent, u.main, u.owner],
      costs: { [u.pos]: B.renewalPosPrice, [u.agent]: B.renewalAgentPrice, [u.main]: B.renewalMainPrice, [u.owner]: B.renewalBranchCost },
      posSell: B.renewalSubscriberPrice,
    },
    chainPosId: u.pos, chainAgentId: u.agent, chainMainAgentId: u.main,
    posMargin: B.renewalSubscriberPrice - B.renewalPosPrice, // 700
    agentMargin: B.renewalPosPrice - B.renewalAgentPrice, // 700
    mainAgentMargin: B.renewalAgentPrice - B.renewalMainPrice, // 700
    branchMargin: B.renewalMainPrice - B.renewalBranchCost, // 400
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: code(name), nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? 1_000_000 : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: u.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: code('p'), name: code('p') } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code: code('c'), name: code('c') } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    await prisma.postpaidPackage.create({ data: { id: ids.a, code: code('a'), name: code('a'), providerId: ids.provider, companyId: ids.company, ...A, ...auto } });
    await prisma.postpaidPackage.create({ data: { id: ids.b, code: code('b'), name: code('b'), providerId: ids.provider, companyId: ids.company, ...B, ...auto } });
    await prisma.postpaidPackageRenewal.create({ data: { packageId: ids.a, targetPackageId: ids.b } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.task.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidPackageRenewal.deleteMany({ where: { packageId: ids.a } });
    await prisma.postpaidPackage.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('the immediate renewal stores the target\'s ladder and margins, as the task path does', async () => {
    const now = await lineOnA();
    expect(await service.extend(pos, now, { outcome: 'success', targetCode: code('b') })).toEqual({ applied: true, debited: true });
    expect(await prisma.postpaidLine.findUniqueOrThrow({ where: { id: now } })).toMatchObject({ packageId: ids.b });
    const immediate = stored(await extendOf(now));

    const byTask = await lineOnA();
    const opened = (await service.extend(pos, byTask, { outcome: 'fail', targetCode: code('b') })) as { taskId: string };
    await service.completeTask(owner, opened.taskId, {});
    const completed = stored(await extendOf(byTask));

    expect(completed).toEqual(onB);
    expect(immediate).toEqual(onB);
  });

  it('a renewal onto the target that the ceiling refuses leaves the line\'s package, terms and end date as they were', async () => {
    const lineId = await lineOnA();
    const before = await prisma.postpaidLine.findUniqueOrThrow({ where: { id: lineId } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.pos } });
    await prisma.wallet.update({ where: { userId: u.pos }, data: { balance: B.renewalPosPrice - 1 } });
    try {
      await expect(service.extend(pos, lineId, { outcome: 'success', targetCode: code('b') })).rejects.toMatchObject({ status: 400, code: 'BALANCE_CEILING' });
    } finally {
      await prisma.wallet.update({ where: { userId: u.pos }, data: { balance: wallet.balance } });
    }
    const after = await prisma.postpaidLine.findUniqueOrThrow({ where: { id: lineId } });
    expect({ packageId: after.packageId, terms: after.terms, endsAt: after.endsAt }).toEqual({ packageId: ids.a, terms: before.terms, endsAt: before.endsAt });
    expect(await prisma.walletEntry.count({ where: { lineId, kind: 'extend' } })).toBe(0);
  });
});
