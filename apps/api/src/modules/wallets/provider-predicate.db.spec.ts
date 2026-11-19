import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';
import { PROVIDER_OPERATION_KINDS } from './provider-cost';
import type { Sale } from './sale';
import type { WalletLedger } from './wallet-ledger';
import type { WalletsService } from './wallets.service';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-19 business-lines foundation, F.5: a provider's operation is an
// entry that stored a provider (`providerId IS NOT NULL`), the predicate of the partial index
// `WalletEntry_provider_createdAt_id`. The books summed it already; the lists and the providers report read
// `kind IN PROVIDER_OPERATION_KINDS`. On rows of every kind of today the two predicates keep the same rows, so
// moving the lists to the stored fact changes nothing today. The comparison is on this spec's own accounts: other
// specs' rows in the shared test database are not assumed away.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('one definition of a provider\'s operation (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), other: randomUUID(), company: randomUUID(), pkg: randomUUID(), addon: randomUUID() };
  const code = `pp-${tag}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let ledger: WalletLedger;
  let wallets: WalletsService;
  let runTx: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const bare = (cost: number): Sale => ({ msisdn: '', lineId: '', companyName: 'pp', packageName: 'pp', packagePrice: 0, providerId: ids.provider, providerCost: cost });
  const mine = { userId: { in: [u.pos, u.agent, u.main, u.owner] } };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: `pp-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? 1_000_000 : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: u.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'pp' } });
    await prisma.provider.create({ data: { id: ids.other, code: `${code}-o`, name: 'pp other' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'pp' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'pp', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    await prisma.postpaidPackageAddon.create({ data: { id: ids.addon, packageId: ids.pkg, name: 'pp add-on', price: 700 } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    const graph = (service as unknown as { graph: { ledger: WalletLedger; uow: { runTx: typeof runTx } } }).graph;
    ledger = graph.ledger;
    runTx = (run) => graph.uow.runTx(run);
    wallets = (service as unknown as { walletDesk: WalletsService }).walletDesk;

    // Every kind of today on this spec's accounts: money movements, a sale, an add-on, a renewal, a refund, a restart
    // and the operations that move no money.
    await runTx((tx) => ledger.move(tx, u.pos, 1_000, u.owner, 'fund', 'in'));
    await runTx((tx) => ledger.move(tx, u.pos, -300, u.owner, 'deduct', 'back'));
    await runTx((tx) => ledger.move(tx, u.agent, 300, u.owner, 'deduct_in', 'from a child'));
    await runTx((tx) => ledger.move(tx, u.owner, 5_000, u.owner, 'self_fund', 'own'));
    const sold = (await service.activate(pos, { packageCode: code, posLoginName: `pp-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { line: { id: string } };
    const asked = (await service.requestAddon(pos, sold.line.id, { addonId: ids.addon })) as { taskId: string };
    await service.completeTask(owner, asked.taskId, {});
    await service.extend(pos, sold.line.id, { outcome: 'success' });
    await service.operate(pos, sold.line.id, 'disconnect', { outcome: 'success' });
    await service.operate(pos, sold.line.id, 'charge', { outcome: 'success' });
    for (const kind of ['reactivate', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer']) {
      await runTx((tx) => ledger.recordOp(tx, u.pos, u.owner, kind, bare(kind === 'switch' ? 150 : 0)));
    }
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.task.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidPackageAddon.deleteMany({ where: { id: ids.addon } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.provider, ids.other] } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

  it('keeps the same rows by the stored provider as by the operation kinds, on every kind of today', async () => {
    const byKind = await prisma.walletEntry.findMany({ where: { ...mine, kind: { in: PROVIDER_OPERATION_KINDS } }, select: { id: true } });
    const byProvider = await prisma.walletEntry.findMany({ where: { ...mine, providerId: { not: null } }, select: { id: true } });
    expect(byKind.length).toBeGreaterThanOrEqual(13);
    expect(idsOf(byProvider)).toEqual(idsOf(byKind));
    // The kinds that are no provider's operation are present and stored none.
    const others = await prisma.walletEntry.findMany({ where: { ...mine, kind: { notIn: PROVIDER_OPERATION_KINDS } }, select: { kind: true, providerId: true } });
    expect(new Set(others.map((row) => row.kind))).toEqual(new Set(['fund', 'deduct', 'deduct_in', 'self_fund', 'hold', 'release', 'addon']));
    expect(others.every((row) => row.providerId === null)).toBe(true);
  });

  it('lists a provider\'s operations as the kinds did, and its books sum the same rows', async () => {
    const listed = await wallets.providerOperations({ providerId: ids.provider });
    const byKind = await prisma.walletEntry.findMany({ where: { ...mine, kind: { in: PROVIDER_OPERATION_KINDS } }, select: { id: true, providerCost: true } });
    expect(idsOf(listed)).toEqual(idsOf(byKind));
    // The kind stays a filter of the screen.
    const charges = await wallets.providerOperations({ providerId: ids.provider, kind: 'charge' });
    expect(charges.length).toBeGreaterThanOrEqual(1);
    expect(charges.every((row) => row.kind === 'charge')).toBe(true);
    const purchases = await wallets.providerPurchases();
    expect(purchases.get(ids.provider)).toBe(byKind.reduce((sum, row) => sum + (row.providerCost ?? 0), 0));
    expect(await wallets.providerCostUpTo(ids.provider, null)).toBe(purchases.get(ids.provider));
  });

  it('reads one provider\'s operations, and every provider\'s newest first, from the partial indexes', async () => {
    const rollback = new Error('rollback');
    let plans: string[] = [];
    await prisma.$transaction(async (tx) => {
      // Many operations of another provider, so the planner has a reason to choose.
      await tx.$executeRawUnsafe(`
        INSERT INTO "WalletEntry" ("id", "userId", "actorId", "amount", "balanceAfter", "kind", "providerId", "providerCost", "createdAt")
        SELECT '${tag}-x' || n, '${u.pos}', '${u.owner}', 0, 0, 'freeze', '${ids.other}', 0, now() - n * interval '1 minute'
        FROM generate_series(1, 3000) AS n`);
      // And many more entries that are no provider's operation (money movements), newer than all of them.
      await tx.$executeRawUnsafe(`
        INSERT INTO "WalletEntry" ("id", "userId", "actorId", "amount", "balanceAfter", "kind", "createdAt")
        SELECT '${tag}-y' || n, '${u.pos}', '${u.owner}', 0, 0, 'fund', now() + n * interval '1 second'
        FROM generate_series(1, 30000) AS n`);
      await tx.$executeRawUnsafe('ANALYZE "WalletEntry"');
      const plan = async (sql: string) => (await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN (COSTS OFF) ${sql}`)).map((row) => row['QUERY PLAN']).join('\n');
      plans = [
        await plan(`SELECT "id" FROM "WalletEntry" WHERE "providerId" = '${ids.provider}' ORDER BY "createdAt" DESC, "id" DESC LIMIT 81`),
        await plan(`SELECT "id" FROM "WalletEntry" WHERE "providerId" = '${ids.provider}' AND "kind" = 'charge' ORDER BY "createdAt" DESC, "id" DESC LIMIT 81`),
        // Every provider's operations newest first (F.6: the index built CONCURRENTLY for this read).
        await plan(`SELECT "id" FROM "WalletEntry" WHERE "providerId" IS NOT NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT 81`),
      ];
      throw rollback;
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
    expect(plans).toHaveLength(3);
    expect(plans[0]).toContain('WalletEntry_provider_createdAt_id');
    expect(plans[2]).toContain('WalletEntry_operation_createdAt_id');
    // With the screen's kind filter the planner may take the kind's own index instead (a rare kind): an index still.
    expect(plans[1]).toMatch(/Index (Only )?Scan/);
    expect(plans[1]).not.toContain('Seq Scan');
    expect(await prisma.walletEntry.count({ where: { OR: [{ id: { startsWith: `${tag}-x` } }, { id: { startsWith: `${tag}-y` } }] } })).toBe(0);
  });
});
