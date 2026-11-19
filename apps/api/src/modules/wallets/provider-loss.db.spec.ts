import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { WalletEntry } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFailure } from '../platform/api-failure';
import { PROVIDER_RELEASED_NOTE } from '../platform/stored-text';
import { ProviderAccountsService } from '../providers/account/provider-accounts.service';
import { ProvidersRepository } from '../providers/providers.repository';
import { ApiFacade } from '../testing/api-facade';
import type { ServiceGraph } from '../testing/service-graph';
import { backfillProviderLedger } from '../../cli/provider-ledger-backfill';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-17-scale-speed-cleanup, "Paid at the provider, not charged to the
// point of sale (DB.5 P.7)": an operation the provider was paid for while the point of sale was charged nothing is a
// purchase (its provider and its cost stored), the branch's loss (`branchMargin` = − cost), and marked with why. Each
// path is driven as the office runs it; the approval of a release after the provider's success is driven in
// `postpaid/sales/settlement/provider-decisions.db.spec.ts` (item 21), and its old cases by the backfill here.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const START = 1_000_000;
// Package Z is sold to the point of sale at 0 (both prices); package P at a price. Both are provider A's.
const Z = { branchCost: 2000, mainPrice: 0, agentPrice: 0, posPrice: 0, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 0, renewalAgentPrice: 0, renewalPosPrice: 0, renewalSubscriberPrice: 3500 };
const P = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };

suite('paid at the provider, not charged to the point of sale (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(120_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), provider: randomUUID(), company: randomUUID(), z: randomUUID(), p: randomUUID() };
  const code = (name: string) => `pl-${tag}-${name}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let books: WalletsService;
  let accounts: ProviderAccountsService;
  let pos: { sessionId: string };
  let owner: { sessionId: string };
  let ownerActor: Parameters<ProviderAccountsService['list']>[0];

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const activate = (pkg: 'z' | 'p', outcome: 'success' | 'fail') =>
    service.activate(pos, { packageCode: code(pkg), posLoginName: code('pos'), outcome, iccid: serial() }) as Promise<{ taskId?: string; line?: { id: string } }>;
  const done = (taskId: string) => service.completeTask(owner, taskId, {});
  const last = (kind: string) => prisma.walletEntry.findFirstOrThrow({ where: { userId: ids.pos, kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.pos } })).balance;
  /** The point of sale's money: its balance, and every entry that moved money (the marked rows move none). */
  const money = async () => ({ balance: await balance(), moved: (await prisma.walletEntry.findMany({ where: { userId: ids.pos, amount: { not: 0 } }, orderBy: { id: 'asc' } })).map((row) => [row.id, row.amount, row.balanceAfter]) });

  /** A marked operation: moved 0, its provider and cost, the mark, the branch's loss as its only margin. */
  const expectMarked = (entry: WalletEntry, loss: 'priced_zero' | 'given_back', cost: number) =>
    expect(entry).toMatchObject({
      amount: 0, providerId: ids.provider, providerCost: cost, providerLoss: loss, branchMargin: -cost,
      ladder: null, chainPosId: null, chainAgentId: null, chainMainAgentId: null, posMargin: null, agentMargin: null, mainAgentMargin: null,
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: code(name), nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const row of [user(ids.owner, 'owner', 'branch', null), user(ids.pos, 'pos', 'pos', ids.owner)]) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.layer === 'pos' ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code: code('A'), name: code('A') } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code: code('co'), name: code('co') } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true };
    await prisma.postpaidPackage.create({ data: { id: ids.z, code: code('z'), name: code('z'), providerId: ids.provider, companyId: ids.company, ...Z, ...auto } });
    await prisma.postpaidPackage.create({ data: { id: ids.p, code: code('p'), name: code('p'), providerId: ids.provider, companyId: ids.company, ...P, ...auto } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    const graph = (service as unknown as { graph: ServiceGraph }).graph;
    books = new WalletsService(graph.uow, graph.tree, graph.ledger, new WalletsRepository(graph.uow));
    accounts = new ProviderAccountsService(graph.uow, books, new ProvidersRepository(graph.uow));
    ownerActor = await graph.actors.actor(owner);
  });

  afterAll(async () => {
    const operations = await prisma.providerOperation.findMany({ where: { providerId: ids.provider }, select: { id: true } });
    // This spec's own decision events, which nothing in the product removes: the table's triggers off for one
    // transaction, as provider-decisions.db.spec.ts does.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "ProviderDecisionEvent" DISABLE TRIGGER USER');
      await tx.$executeRaw`DELETE FROM "ProviderDecisionEvent" WHERE "operationId" = ANY(${operations.map((row) => row.id)})`;
      await tx.$executeRawUnsafe('ALTER TABLE "ProviderDecisionEvent" ENABLE TRIGGER USER');
    });
    await prisma.providerOperation.deleteMany({ where: { providerId: ids.provider } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.pos, ids.owner] } } });
    await prisma.task.deleteMany({ where: { posId: ids.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: ids.pos } });
    await prisma.postpaidPackage.deleteMany({ where: { id: { in: [ids.z, ids.p] } } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos] } } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('an immediate activation sold at 0: marked priced_zero with the package\'s cost; the point of sale\'s money unchanged', async () => {
    const before = await money();
    await activate('z', 'success');
    expectMarked(await last('activate'), 'priced_zero', Z.branchCost);
    expect(await money()).toEqual(before);
  });

  it('an activation task sold at 0 and completed by the branch: the package\'s cost (it stored 0 before P.7), marked', async () => {
    const before = await money();
    await done((await activate('z', 'fail')).taskId!);
    expectMarked(await last('activate'), 'priced_zero', Z.branchCost);
    expect(await money()).toEqual(before);
  });

  it('a renewal sold at 0, now and by task: the renewal branch cost, marked', async () => {
    const line = (await activate('z', 'success')).line!.id;
    const before = await money();
    await service.extend(pos, line, { outcome: 'success' });
    expectMarked(await last('extend'), 'priced_zero', Z.renewalBranchCost);
    await done(((await service.extend(pos, line, { outcome: 'fail' })) as { taskId: string }).taskId);
    expectMarked(await last('extend'), 'priced_zero', Z.renewalBranchCost);
    expect(await money()).toEqual(before);
  });

  it('a priced sale and an operation the provider does not price are not marked', async () => {
    const line = (await activate('p', 'success')).line!.id;
    expect(await last('activate')).toMatchObject({ amount: -P.posPrice, providerCost: P.branchCost, providerLoss: null });
    await service.operate(pos, line, 'freeze', { outcome: 'success' });
    expect(await last('freeze')).toMatchObject({ providerCost: 0, providerLoss: null, branchMargin: null });
  });

  it('the database refuses a mark on a row that moves money, and a reason it does not know', async () => {
    const entry = await last('activate');
    await expect(prisma.walletEntry.update({ where: { id: entry.id }, data: { providerLoss: 'given_back' } })).rejects.toThrow(/WalletEntry_provider_loss/);
    const marked = (await prisma.walletEntry.findFirstOrThrow({ where: { userId: ids.pos, providerLoss: 'priced_zero' } })).id;
    await expect(prisma.walletEntry.update({ where: { id: marked }, data: { providerLoss: 'lost' } })).rejects.toThrow(/WalletEntry_provider_loss/);
  });

  it('the provider\'s books: a purchase, counted in its summary, listed with its mark, filtered in SQL', async () => {
    const marked = await prisma.walletEntry.findMany({ where: { userId: ids.pos, providerLoss: { not: null } } });
    expect(marked).toHaveLength(5);
    const all = await prisma.walletEntry.aggregate({ where: { providerId: ids.provider }, _sum: { providerCost: true } });
    expect((await books.providerPurchases()).get(ids.provider)).toBe(all._sum.providerCost);
    expect(all._sum.providerCost).toBe(3 * Z.branchCost + 2 * Z.renewalBranchCost + P.branchCost);

    const list = await accounts.list(ownerActor);
    expect(list.rows.find((row) => row.code === code('A'))).toMatchObject({ losses: 5, purchases: all._sum.providerCost });
    const detail = await accounts.detail(ownerActor, code('A'));
    expect(detail.summary.losses).toBe(5);
    expect(detail.ledger.filter((row) => row.loss === 'priced_zero').map((row) => row.id).sort()).toEqual(marked.map((row) => row.id).sort());
    expect(detail.ledger.filter((row) => row.loss === null).length).toBeGreaterThan(0);

    const filtered = await service.providerOperations(owner, { provider: code('A'), loss: 'any' });
    expect(filtered.items.map((row) => row.id).sort()).toEqual(marked.map((row) => row.id).sort());
    expect(filtered.items.every((row) => row.loss === 'priced_zero')).toBe(true);
    expect(filtered.stats.losses).toBe(5);
    expect((await service.providerOperations(owner, { provider: code('A'), loss: 'given_back' })).items).toHaveLength(0);
    const unfiltered = await service.providerOperations(owner, { provider: code('A') });
    expect(unfiltered.items.length).toBeGreaterThan(5);
    expect(unfiltered.stats.losses).toBe(5);
  });

  it('the branch reads the mark and its loss on the finance list; the point of sale reads neither, and may not filter on it', async () => {
    // The branch reads every entry: searched by this spec's point of sale, so other specs' rows are not counted.
    const branch = await service.finance(owner, { loss: 'any', q: code('pos') });
    expect(branch.items).toHaveLength(5);
    expect(branch.items.every((row) => row.loss === 'priced_zero' && row.margin === -(row.kind === 'extend' ? Z.renewalBranchCost : Z.branchCost))).toBe(true);
    // Every entry (`scope=all`): the marked rows moved 0, so the point of sale's money view, the default, leaves them out
    // (point 7 of 2026-11-19), while the branch's keeps them (above).
    expect((await service.finance(pos, {})).items.some((row) => branch.items.some((marked) => marked.id === row.id))).toBe(false);
    const mine = await service.finance(pos, { scope: 'all' });
    expect(mine.items.length).toBeGreaterThan(5);
    expect(mine.items.every((row) => row.loss === null)).toBe(true);
    const ids_ = new Set(branch.items.map((row) => row.id));
    expect(mine.items.filter((row) => ids_.has(row.id)).every((row) => row.margin === null)).toBe(true);
    for (const row of mine.items) expect(Object.keys(row)).not.toContain('providerCost');
    await expect(service.finance(pos, { loss: 'any' })).rejects.toMatchObject({ status: 403 } as Partial<ApiFailure>);
  });

  it('not a sale in the counts: the branch\'s profit report counts the marked rows as losses, net of the profit (P.8)', async () => {
    const report = await books.profitReport(ownerActor, {});
    const marked = await prisma.walletEntry.findMany({ where: { packageName: code('z'), providerLoss: { not: null } }, select: { providerCost: true } });
    const cost = marked.reduce((sum, row) => sum + (row.providerCost ?? 0), 0);
    // Every Z operation was sold at 0: none is a sale; the package is a row for its losses alone (spec DB.5 P.8).
    expect(marked.length).toBeGreaterThan(0);
    expect(report.packages.find((row) => row.packageName === code('z'))).toEqual({ packageName: code('z'), companyName: code('co'), sales: 0, refunds: 0, profit: -cost, losses: marked.length, lossAmount: cost });
    expect(report.packages.find((row) => row.packageName === code('p'))).toMatchObject({ sales: 1 });
  });

  it('old rows: the backfill marks a sale at 0 stored at cost 0, writes the entry an old approved release left out, and a second run writes nothing', async () => {
    // A sale at 0 as P.1 stored it (cost 0, no mark), and an approved release after the provider's success with no entry.
    const old = await prisma.walletEntry.create({ data: { userId: ids.pos, actorId: ids.owner, amount: 0, balanceAfter: await balance(), kind: 'activate', msisdn: '0599000001', packageName: code('z'), companyName: code('co'), packagePrice: 0, providerId: ids.provider, providerCost: 0, periodCost: Z.branchCost } });
    const task = await prisma.task.create({ data: { action: 'activate', status: 'cancelled', posId: ids.pos, packageId: ids.p, submitterId: ids.pos, posDelta: -P.posPrice, unitPrice: P.posPrice, msisdn: '0599000002' } });
    const operation = await prisma.providerOperation.create({ data: { idempotencyKey: `activate:${task.id}`, requestHash: 'h', action: 'activate', providerId: ids.provider, packageCode: code('p'), taskId: task.id, status: 'succeeded', applyError: 'number-taken', attempts: 1, resultMsisdn: '0599000003' } });
    const at = new Date(Date.now() - 3_600_000);
    for (const [sequence, type] of [[1, 'proposed'], [2, 'approved']] as const) {
      await prisma.providerDecisionEvent.create({ data: { operationId: operation.id, sequence, type, decision: 'release-after-success', evidenceKind: 'provider-portal', note: 'the provider ran it; given back by two', accountId: ids.owner, accountLoginName: code('owner'), createdAt: at } });
    }
    const before = await money();

    const first = await backfillProviderLedger(prisma, { scope: { userIds: [ids.pos] } });
    expect(first.committed).toBe(true);
    expect(first.losses).toEqual([expect.objectContaining({ id: old.id, from: 0, cost: Z.branchCost })]);
    expect(first.givenBack).toEqual([expect.objectContaining({ taskId: task.id, cost: P.branchCost })]);
    expectMarked(await prisma.walletEntry.findUniqueOrThrow({ where: { id: old.id } }), 'priced_zero', Z.branchCost);
    const written = await prisma.walletEntry.findUniqueOrThrow({ where: { id: first.givenBack[0].id } });
    expectMarked(written, 'given_back', P.branchCost);
    expect(written).toMatchObject({ kind: 'activate', userId: ids.pos, msisdn: '0599000003', packageName: code('p'), createdAt: at, note: PROVIDER_RELEASED_NOTE, lineId: null });
    expect(await money()).toEqual(before);

    const second = await backfillProviderLedger(prisma, { scope: { userIds: [ids.pos] } });
    expect([second.losses, second.givenBack, second.written]).toEqual([[], [], 0]);
    expect((await accounts.list(ownerActor)).rows.find((row) => row.code === code('A'))?.losses).toBe(7);
  });
});
