import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeFailure } from '../../shared/office-failure';
import type { NoticeService } from '../notices/notice.service';
import { captureTerms } from '../rules/prices';
import { packageTermsOf, type PackagePriceRow } from '../rules/office-terms';
import { OfficeFacade } from '../testing/office-facade';

// Runs against a real PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one): in-memory
// tables cannot show two transactions racing for one line. Backend review 2026-11-10, M3.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('operations on one number at the same moment (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID(), line: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let gate: { sessionId: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, layer: string, parentId: string | null, isBranchOwner: boolean) => ({
      id, loginName: `race-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner,
    });
    await prisma.user.create({ data: { ...user(ids.owner, 'branch', null, true), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner, false), wallet: { create: { balance: 100_000, ceiling: 0 } } } });
    for (const row of [user(ids.owner, 'branch', null, true), user(ids.pos, 'pos', ids.owner, false)]) {
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    gate = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: `race-${tag}`, name: 'race' } });
    await prisma.company.create({ data: { id: ids.company, code: `race-${tag}`, name: 'race' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    const pkg = await prisma.package.create({
      data: { id: ids.pkg, code: `race-${tag}`, name: 'race', providerId: ids.provider, companyId: ids.company, ...prices, ...auto },
      include: { company: true, provider: true },
    });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new OfficeFacade(auth, notice);
    await prisma.line.create({
      data: {
        id: ids.line, msisdn: `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, status: 'active', packageId: ids.pkg, posId: ids.pos,
        endsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        terms: captureTerms(packageTermsOf(pkg as unknown as PackagePriceRow), []) as unknown as object,
      },
    });
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.officeTask.deleteMany({ where: { posId: ids.pos } });
    await prisma.line.deleteMany({ where: { id: ids.line } });
    await prisma.package.deleteMany({ where: { id: ids.pkg } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const outcomes = async (runs: Promise<unknown>[]) => {
    const settled = await Promise.allSettled(runs);
    return {
      // Applied now at the provider, not left as a task.
      applied: settled.filter((result) => result.status === 'fulfilled' && (result.value as { applied?: boolean }).applied === true).length,
      refused: settled.filter((result) => result.status === 'rejected' && result.reason instanceof OfficeFailure).map((result) => (result as PromiseRejectedResult).reason.code as string),
      crashed: settled.filter((result) => result.status === 'rejected' && !(result.reason instanceof OfficeFailure)).length,
    };
  };

  it('gives one SIM serial to one number when two activations name it at once', async () => {
    const iccid = `89${Date.now()}`.padEnd(19, '0');
    const activate = () => service.activate(gate, { packageCode: `race-${tag}`, posLoginName: `race-${tag}-pos`, iccid, outcome: 'success' });
    const result = await outcomes([activate(), activate()]);
    expect(result).toEqual({ applied: 1, refused: ['SIM_TAKEN'], crashed: 0 });
    const made = await prisma.line.findMany({ where: { iccid } });
    expect(made).toHaveLength(1);
    await prisma.walletEntry.deleteMany({ where: { lineId: made[0].id } });
    await prisma.line.deleteMany({ where: { id: made[0].id } });
  });

  it('charges one extension when two are sent at once, and the other is refused', async () => {
    const before = await prisma.line.findUniqueOrThrow({ where: { id: ids.line } });
    const result = await outcomes([service.extend(gate, ids.line, { outcome: 'success' }), service.extend(gate, ids.line, { outcome: 'success' })]);
    expect(result).toEqual({ applied: 1, refused: ['DUPLICATE_REQUEST'], crashed: 0 });
    // One period was added, not two.
    const after = await prisma.line.findUniqueOrThrow({ where: { id: ids.line } });
    expect(Math.round((after.endsAt.getTime() - before.endsAt.getTime()) / 86_400_000)).toBe(30);
    expect(await prisma.walletEntry.count({ where: { lineId: ids.line, kind: 'extend' } })).toBe(1);
  });

  it('refunds one disconnect when two are sent at once', async () => {
    const result = await outcomes([
      service.operate(gate, ids.line, 'disconnect', { outcome: 'success' }),
      service.operate(gate, ids.line, 'disconnect', { outcome: 'success' }),
    ]);
    expect(result).toEqual({ applied: 1, refused: ['DUPLICATE_REQUEST'], crashed: 0 });
    expect(await prisma.walletEntry.count({ where: { lineId: ids.line, kind: 'disconnect' } })).toBe(1);
    expect((await prisma.line.findUniqueOrThrow({ where: { id: ids.line } })).status).toBe('disconnected');
  });
});
