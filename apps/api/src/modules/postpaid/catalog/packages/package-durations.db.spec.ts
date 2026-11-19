import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../../db';
import { MemoryAuthStore } from '../../../auth/testing/memory-auth.store';
import type { NoticeService } from '../../../notifications/notice.service';
import { ApiFacade } from '../../../testing/api-facade';
import { mirroredDuration } from '../rules/package-prices';

// PostgreSQL only (TEST_DATABASE_URL). Package plan D.2: while a package still holds a duration and a renewal
// ladder in its own columns, its one duration row says the same, because both are written in one statement.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('a package and its mirrored duration row (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `dur-${tag}`;
  const renewal = { branchCost: 6000, mainPrice: 6500, agentPrice: 7000, posPrice: 8000, subscriberPrice: 9000 };
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let owner: { sessionId: string };

  const rows = () => prisma.postpaidPackageDuration.findMany({ where: { packageId: ids.pkg } });
  const columns = async () => {
    const pkg = await prisma.postpaidPackage.findUniqueOrThrow({ where: { id: ids.pkg } });
    return {
      branchCost: pkg.renewalBranchCost,
      mainPrice: pkg.renewalMainPrice,
      agentPrice: pkg.renewalAgentPrice,
      posPrice: pkg.renewalPosPrice,
      subscriberPrice: pkg.renewalSubscriberPrice,
    };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = { id: ids.owner, loginName: `dur-${tag}-branch`, nickname: 'branch', passwordHash: 'x', layer: 'branch', parentId: null, isBranchOwner: true };
    await prisma.user.create({ data: { ...user, wallet: { create: { balance: 0, ceiling: 0 } } } });
    auth.addUser({ ...user, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'dur' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'dur' } });
    await prisma.postpaidPackage.create({
      data: {
        id: ids.pkg, code, name: code, providerId: ids.provider, companyId: ids.company, months: 3,
        autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
        branchCost: 5000, mainPrice: 5500, agentPrice: 6000, posPrice: 7000, subscriberPrice: 8000,
        renewalBranchCost: renewal.branchCost, renewalMainPrice: renewal.mainPrice, renewalAgentPrice: renewal.agentPrice,
        renewalPosPrice: renewal.posPrice, renewalSubscriberPrice: renewal.subscriberPrice,
        durations: { create: mirroredDuration(3, renewal) },
      },
    });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
  });

  afterAll(async () => {
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: ids.owner } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('shows the duration on the package sheet with its days and prices', async () => {
    const sheet = (await service.packageSheet(owner, code)) as { durations: Record<string, unknown>[] };
    expect(sheet.durations).toHaveLength(1);
    expect(sheet.durations[0]).toMatchObject({ unit: 'month', count: 3, days: 90, ...renewal, noDisconnect: false, forSale: true, enabled: true });
  });

  it('moves the duration row with the renewal prices, and leaves it alone when only the subscription prices move', async () => {
    await service.setChain(owner, code, { renewalPosPrice: 8200, renewalSubscriberPrice: 9100 });
    expect(await rows()).toMatchObject([{ unit: 'month', count: 3, ...(await columns()) }]);
    expect((await rows())[0]).toMatchObject({ posPrice: 8200, subscriberPrice: 9100, agentPrice: 7000 });
    await service.setChain(owner, code, { posPrice: 7100 });
    expect(await rows()).toMatchObject([{ ...(await columns()), posPrice: 8200 }]);
  });

  it('refuses a renewal ladder that breaks the chain and writes neither the columns nor the row', async () => {
    const before = await rows();
    await expect(service.setChain(owner, code, { renewalAgentPrice: 9999 })).rejects.toMatchObject({ status: 400, code: 'PRICE_BELOW_FLOOR' });
    expect(await rows()).toEqual(before);
    expect(await columns()).toMatchObject({ agentPrice: 7000 });
  });

  // Package plan D.3: the branch adds, reprices and removes durations.
  it('adds a duration, replaces its prices when the same unit and count come again, and removes it', async () => {
    const month = { unit: 'month', count: 1, branchCost: 2500, mainPrice: 2700, agentPrice: 2900, posPrice: 3000, subscriberPrice: 3500 };
    await service.saveDuration(owner, code, month);
    await service.saveDuration(owner, code, { unit: 'day', count: 5, branchCost: 400, mainPrice: 450, agentPrice: 480, posPrice: 500, subscriberPrice: 600, forSale: false });
    await service.saveDuration(owner, code, { ...month, posPrice: 3100 });
    const sheet = (await service.packageSheet(owner, code)) as { durations: { id: string; unit: string; count: number; days: number; posPrice: number; forSale: boolean }[] };
    expect(sheet.durations.map((row) => [row.unit, row.count, row.days, row.posPrice, row.forSale])).toEqual([
      ['day', 5, 5, 500, false],
      ['month', 1, 30, 3100, true],
      ['month', 3, 90, 8200, true],
    ]);
    // The package's own renewal columns are those of its own months only.
    expect(await columns()).toMatchObject({ posPrice: 8200 });
    for (const row of sheet.durations.filter((item) => item.count !== 3)) await service.removeDuration(owner, code, row.id);
    expect(await rows()).toHaveLength(1);
  });

  it('writes the package\'s own duration and its renewal columns together, and never turns it off or removes it', async () => {
    await service.saveDuration(owner, code, { unit: 'month', count: 3, ...renewal, posPrice: 8300 });
    expect(await columns()).toMatchObject({ posPrice: 8300 });
    expect(await rows()).toMatchObject([{ ...(await columns()) }]);
    const [own] = await rows();
    await expect(service.saveDuration(owner, code, { unit: 'month', count: 3, ...renewal, enabled: false })).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    await expect(service.removeDuration(owner, code, own.id)).rejects.toMatchObject({ status: 400, code: 'INVALID' });
    await service.setChain(owner, code, { renewalPosPrice: 8200 });
  });

  it('refuses a ladder that breaks the chain, a month count past ten years, and a duration of another package', async () => {
    await expect(service.saveDuration(owner, code, { unit: 'month', count: 2, ...renewal, agentPrice: 9999 })).rejects.toMatchObject({ status: 400, code: 'PRICE_BELOW_FLOOR' });
    await expect(service.saveDuration(owner, code, { unit: 'month', count: 121, ...renewal })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveDuration(owner, code, { unit: 'week', count: 1, ...renewal })).rejects.toMatchObject({ status: 400 });
    await expect(service.removeDuration(owner, code, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await rows()).toHaveLength(1);
  });

  it('refuses a second row of the same length, a unit it does not know, and a count below one', async () => {
    const row = { packageId: ids.pkg, ...renewal };
    await expect(prisma.postpaidPackageDuration.create({ data: { ...row, unit: 'month', count: 3 } })).rejects.toThrow();
    await expect(prisma.postpaidPackageDuration.create({ data: { ...row, unit: 'week', count: 1 } })).rejects.toThrow();
    await expect(prisma.postpaidPackageDuration.create({ data: { ...row, unit: 'day', count: 0 } })).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
  });

  it('goes with its package when the package is removed', async () => {
    const other = randomUUID();
    await prisma.postpaidPackage.create({
      data: {
        id: other, code: `${code}-x`, name: 'x', providerId: ids.provider, companyId: ids.company,
        autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
        branchCost: 1, mainPrice: 1, agentPrice: 1, posPrice: 1, subscriberPrice: 1,
        renewalBranchCost: 1, renewalMainPrice: 1, renewalAgentPrice: 1, renewalPosPrice: 1, renewalSubscriberPrice: 1,
        durations: { create: mirroredDuration(1, { branchCost: 1, mainPrice: 1, agentPrice: 1, posPrice: 1, subscriberPrice: 1 }) },
      },
    });
    await prisma.postpaidPackage.delete({ where: { id: other } });
    expect(await prisma.postpaidPackageDuration.count({ where: { packageId: other } })).toBe(0);
  });
});
