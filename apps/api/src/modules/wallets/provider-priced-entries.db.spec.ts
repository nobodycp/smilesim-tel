import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type IORedis from 'ioredis';
import { createPrismaClient } from '../../db';
import type { WalletEntry } from '../../generated/prisma/client';
import { buildActivationSettlement, buildProviderDispatch } from '../../worker/provider-dispatch';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { DISCONNECT_FEE } from '../pricing';
import { ProviderOperationsRepository } from '../providers/integration/operations/provider-operations.repository';
import { ProviderOperationsService } from '../providers/integration/operations/provider-operations.service';
import { openGate } from '../providers/testing/open-gate';
import { ScriptedGateway } from '../providers/testing/scripted-gateway';
import { operationKey } from '../sales/settlement/activation-settlement.rules';
import { ApiFacade } from '../testing/api-facade';
import type { ServiceGraph } from '../testing/service-graph';
import { PROVIDER_OPERATION_KINDS } from './provider-cost';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0025, slice P.1: every writer of an operation's wallet entry stores the
// provider of the package the operation was carried out on and its provider cost, in the entry's own INSERT. Each
// writer is driven through the service as the office runs it (now, by a branch task, by the provider's
// confirmation), and each entry is checked twice: against the figure worked out by hand from the package's prices,
// and against the provider and cost today's books give the same row (`WalletsService.pricedOperations`), so the
// stored figures are the figures the screens show on the day.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const DAY = 86_400_000;
const START = 1_000_000;
// Package 1 (provider A); package 2 (provider B), dearer, a renewal target of package 1. A switch stays with the
// provider and the company (`switchOnto`): package 4 (provider A) is priced as package 2, package 5 as package 1.
const P1 = { branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500 };
const P2 = { branchCost: 3000, mainPrice: 3500, agentPrice: 4000, posPrice: 4500, subscriberPrice: 4800, renewalBranchCost: 2500, renewalMainPrice: 2900, renewalAgentPrice: 3400, renewalPosPrice: 3900, renewalSubscriberPrice: 4200 };
const ESIM_FEE = 500;
const QR = `data:image/png;base64,${'A'.repeat(64)}`;

suite('an operation\'s wallet entry stores its provider and its cost (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(120_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: randomUUID(), pos: randomUUID(), pos2: randomUUID(), providerA: randomUUID(), providerB: randomUUID(), company: randomUUID(),
    p1: randomUUID(), p2: randomUUID(), p4: randomUUID(), p5: randomUUID(),
  };
  const code = (name: string) => `pp-${tag}-${name}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let books: WalletsService;
  let dispatch: ReturnType<typeof buildProviderDispatch>;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const number = () => `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  const activate = async (outcome: 'success' | 'fail', over: Record<string, unknown> = {}) =>
    (await service.activate(pos, { packageCode: code('p1'), posLoginName: code('pos'), outcome, ...(over.esim ? {} : { iccid: serial() }), ...over })) as { taskId?: string; line?: { id: string } };
  const lineNow = async (over: Record<string, unknown> = {}) => (await activate('success', over)).line!.id;
  const taskOf = async (run: Promise<unknown>) => ((await run) as { taskId: string }).taskId;
  const done = (taskId: string, body: Record<string, unknown> = {}) => service.completeTask(owner, taskId, body);
  /** The newest entry of `kind` on the point of sale's wallets (both points of sale: a transfer is written on the first). */
  const last = (kind: string) => prisma.walletEntry.findFirstOrThrow({ where: { userId: { in: [ids.pos, ids.pos2] }, kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });

  /**
   * The entry carries `provider` and `cost`, and today's books, reading the same row, give the same: the provider
   * found from the entry's package name (or the line's package) and the cost the entry stores.
   */
  const expectPriced = async (entry: WalletEntry, provider: 'A' | 'B', cost: number) => {
    expect({ kind: entry.kind, providerId: entry.providerId, providerCost: entry.providerCost }).toEqual({ kind: entry.kind, providerId: provider === 'A' ? ids.providerA : ids.providerB, providerCost: cost });
    const read = (await books.pricedOperations({ kind: entry.kind, msisdn: entry.msisdn ?? undefined })).find((row) => row.id === entry.id);
    expect(read && { providerCode: read.providerCode, cost: read.cost }).toEqual({ providerCode: provider === 'A' ? code('A') : code('B'), cost });
  };
  /** Puts a line's paid period back by `days`, as if it had been sold that many days ago. */
  const aged = async (lineId: string, days: number) => {
    const line = await prisma.line.findUniqueOrThrow({ where: { id: lineId } });
    await prisma.line.update({ where: { id: lineId }, data: { endsAt: new Date(line.endsAt.getTime() - days * DAY) } });
    for (const row of await prisma.walletEntry.findMany({ where: { lineId, periodEndsAt: { not: null } } })) {
      await prisma.walletEntry.update({ where: { id: row.id }, data: { periodEndsAt: new Date(row.periodEndsAt!.getTime() - days * DAY), createdAt: new Date(row.createdAt.getTime() - days * DAY) } });
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const user = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: code(name), nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const row of [user(ids.owner, 'owner', 'branch', null), user(ids.pos, 'pos', 'pos', ids.owner), user(ids.pos2, 'pos2', 'pos', ids.owner)]) {
      await prisma.user.create({ data: { ...row, wallet: { create: { balance: row.layer === 'pos' ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: ids.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: ids.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.providerA, code: code('A'), name: code('A') } });
    await prisma.provider.create({ data: { id: ids.providerB, code: code('B'), name: code('B') } });
    await prisma.company.create({ data: { id: ids.company, code: code('co'), name: code('co'), esimPrice: ESIM_FEE } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true };
    const pkg = (id: string, name: string, providerId: string, prices: typeof P1) => ({ id, code: code(name), name: code(name), providerId, companyId: ids.company, ...prices, ...auto });
    await prisma.package.create({ data: pkg(ids.p1, 'p1', ids.providerA, P1) });
    await prisma.package.create({ data: pkg(ids.p2, 'p2', ids.providerB, P2) });
    await prisma.package.create({ data: pkg(ids.p4, 'p4', ids.providerA, P2) });
    await prisma.package.create({ data: pkg(ids.p5, 'p5', ids.providerA, P1) });
    await prisma.packageRenewal.create({ data: { packageId: ids.p1, targetPackageId: ids.p2 } });
    for (const [from, to] of [[ids.p1, ids.p4], [ids.p4, ids.p1], [ids.p1, ids.p5]]) await prisma.packageSwitch.create({ data: { packageId: from, targetPackageId: to } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    const graph = (service as unknown as { graph: ServiceGraph }).graph;
    books = new WalletsService(graph.uow, graph.tree, graph.ledger, graph.ladder, new WalletsRepository(graph.uow));
    dispatch = buildProviderDispatch(prisma, {} as IORedis, openGate(new ScriptedGateway()), `pp-${tag}`, notice);
  });

  afterAll(async () => {
    await dispatch.publisher.close();
    const operations = await prisma.providerOperation.findMany({ where: { providerId: ids.providerA }, select: { id: true } });
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: operations.map((row) => row.id) } } });
    await prisma.providerOperation.deleteMany({ where: { providerId: ids.providerA } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: [ids.pos, ids.pos2, ids.owner] } } });
    await prisma.task.deleteMany({ where: { posId: { in: [ids.pos, ids.pos2] } } });
    await prisma.line.deleteMany({ where: { posId: { in: [ids.pos, ids.pos2] } } });
    await prisma.packageSwitch.deleteMany({ where: { packageId: { in: [ids.p1, ids.p2, ids.p4, ids.p5] } } });
    await prisma.packageRenewal.deleteMany({ where: { packageId: { in: [ids.p1, ids.p2, ids.p4, ids.p5] } } });
    await prisma.package.deleteMany({ where: { id: { in: [ids.p1, ids.p2, ids.p4, ids.p5] } } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.providerA, ids.providerB] } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [ids.owner, ids.pos, ids.pos2] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.pos, ids.pos2] } } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('an immediate sale: a plain activation stores the subscription\'s branch cost, an eSIM one adds its fee', async () => {
    await lineNow();
    await expectPriced(await last('activate'), 'A', P1.branchCost);
    await lineNow({ esim: true });
    const esim = await last('activate');
    expect(esim.esimPrice).toBe(ESIM_FEE);
    await expectPriced(esim, 'A', P1.branchCost + ESIM_FEE);
  });

  it('an activation completed by the branch, and one the provider confirmed (the provider settlement)', async () => {
    await done((await activate('fail')).taskId!);
    await expectPriced(await last('activate'), 'A', P1.branchCost);

    const taskId = (await activate('fail')).taskId!;
    const operation = await prisma.providerOperation.create({
      data: {
        idempotencyKey: operationKey(taskId), requestHash: 'h', action: 'activate', providerId: ids.providerA, packageCode: code('p1'), taskId,
        status: 'pending', attempts: 1, lastAttemptAt: new Date(), leaseUntil: new Date(Date.now() + 60_000), sentAt: new Date(),
      },
    });
    expect(await dispatch.operations.settle(operation.id, 1, { kind: 'confirmed', providerRef: 'REF-1', result: null })).toBe('succeeded');
    const settlement = buildActivationSettlement(dispatch.uow, new ProviderOperationsService(dispatch.uow, new ProviderOperationsRepository()));
    expect(await settlement.apply(operation.id)).toBe('applied');
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: 'done' });
    await expectPriced(await last('activate'), 'A', P1.branchCost);
  });

  it('renewals: an extension on the line\'s package and onto a target, now and by task; a charge; a reactivation task', async () => {
    const line = await lineNow();
    await service.extend(pos, line, { outcome: 'success' });
    await expectPriced(await last('extend'), 'A', P1.renewalBranchCost);
    await done(await taskOf(service.extend(pos, line, { outcome: 'fail' })));
    await expectPriced(await last('extend'), 'A', P1.renewalBranchCost);
    await service.extend(pos, line, { outcome: 'success', targetCode: code('p2') });
    await expectPriced(await last('extend'), 'B', P2.renewalBranchCost);

    const other = await lineNow();
    await service.operate(pos, other, 'disconnect', { outcome: 'success' });
    await service.operate(pos, other, 'charge', { outcome: 'success' });
    await expectPriced(await last('charge'), 'A', P1.renewalBranchCost);
    await service.operate(pos, other, 'disconnect', { outcome: 'success' });
    await done(await taskOf(service.operate(pos, other, 'charge', { outcome: 'fail' })));
    await expectPriced(await last('charge'), 'A', P1.renewalBranchCost);

    // No route of the office opens a reactivation task today (a reactivation is deferred as a charge); its handler
    // is kept, so a task of that action is written here as one would be.
    await service.operate(pos, other, 'disconnect', { outcome: 'success' });
    const reactivation = await prisma.task.create({ data: { action: 'reactivate', status: 'working', posId: ids.pos, packageId: ids.p1, submitterId: ids.pos, lineId: other, posDelta: -P1.renewalPosPrice, msisdn: (await prisma.line.findUniqueOrThrow({ where: { id: other } })).msisdn } });
    await done(reactivation.id);
    await expectPriced(await last('reactivate'), 'A', P1.renewalBranchCost);
  });

  it('a switch stores the quoted difference, on the new package\'s provider: dearer, cheaper, even; now and by task', async () => {
    // The days left of the period, valued at each package's branch cost (`LinePricing.switchQuote`): on a line sold
    // today, 29 whole days of 30 are left.
    const difference = Math.round((P2.branchCost * 29) / 30) - Math.round((P1.branchCost * 29) / 30);
    const line = await lineNow();
    await service.switchPackage(pos, line, { packageCode: code('p4'), outcome: 'success' });
    const dearer = await last('switch');
    expect(dearer.amount).toBeLessThan(0);
    await expectPriced(dearer, 'A', difference);
    await service.switchPackage(pos, line, { packageCode: code('p1'), outcome: 'success' });
    const cheaper = await last('switch');
    expect(cheaper.amount).toBeGreaterThan(0);
    await expectPriced(cheaper, 'A', -difference);
    await service.switchPackage(pos, line, { packageCode: code('p5'), outcome: 'success' });
    const even = await last('switch');
    expect(even.amount).toBe(0);
    await expectPriced(even, 'A', 0);

    const byTask = await lineNow();
    await done(await taskOf(service.switchPackage(pos, byTask, { packageCode: code('p4'), outcome: 'fail' })));
    await expectPriced(await last('switch'), 'A', difference);
    await done(await taskOf(service.switchPackage(pos, byTask, { packageCode: code('p1'), outcome: 'fail' })));
    await expectPriced(await last('switch'), 'A', -difference);
  });

  it('a disconnect stores the used share and the 0.5 shekel fee, as the books count it today; now and by task', async () => {
    // Sold ten days ago, part of an eleventh begun: 19 whole days of 30 left, so 11 used. The used share, 2000 × 11 / 30,
    // and the fee (ADR 0025, owner's answer 3: today's rule, corrected in slice P.6).
    const used = Math.round((P1.branchCost * 11) / 30) + DISCONNECT_FEE;
    const line = await lineNow();
    await aged(line, 10);
    await service.operate(pos, line, 'disconnect', { outcome: 'success' });
    const now = await last('disconnect');
    expect(now.amount).toBeGreaterThan(0);
    await expectPriced(now, 'A', used);

    const byTask = await lineNow();
    await aged(byTask, 10);
    await done(await taskOf(service.operate(pos, byTask, 'disconnect', { outcome: 'fail' })));
    await expectPriced(await last('disconnect'), 'A', used);
  });

  it('the operations that cost nothing store 0 on the line\'s provider: freeze, unfreeze, refresh, rename, SIM, transfer; an eSIM issue its fee', async () => {
    const line = await lineNow();
    await service.operate(pos, line, 'freeze', { outcome: 'success' });
    await expectPriced(await last('freeze'), 'A', 0);
    await service.operate(pos, line, 'unfreeze', { outcome: 'success' });
    await expectPriced(await last('unfreeze'), 'A', 0);
    await done(await taskOf(service.operate(pos, line, 'freeze', { outcome: 'fail' })));
    await expectPriced(await last('freeze'), 'A', 0);
    await done(await taskOf(service.operate(pos, line, 'unfreeze', { outcome: 'fail' })));
    await expectPriced(await last('unfreeze'), 'A', 0);
    await service.refreshLine(pos, line, { outcome: 'success' });
    await expectPriced(await last('refresh'), 'A', 0);
    await done(await taskOf(service.refreshLine(pos, line, { outcome: 'fail' })));
    await expectPriced(await last('refresh'), 'A', 0);
    await service.renameLine(pos, line, { msisdn: number(), outcome: 'success' });
    await expectPriced(await last('rename'), 'A', 0);
    await done(await taskOf(service.renameLine(pos, line, { msisdn: '', outcome: 'fail' })), { msisdn: number() });
    await expectPriced(await last('rename'), 'A', 0);
    await service.swapSim(pos, line, { iccid: serial(), outcome: 'success' });
    await expectPriced(await last('sim'), 'A', 0);
    await done(await taskOf(service.swapSim(pos, line, { iccid: serial(), outcome: 'fail' })));
    await expectPriced(await last('sim'), 'A', 0);
    await done(await taskOf(service.requestEsim(pos, line)), { iccid: serial(), qr: QR });
    await expectPriced(await last('esim'), 'A', ESIM_FEE);
    await service.transferLine(owner, line, { posLoginName: code('pos2'), linePrices: 'keep' });
    await expectPriced(await last('transfer'), 'A', 0);
  });

  it('an entry that is not an operation carries no provider: a hold, its release, an add-on', async () => {
    const line = await lineNow();
    await prisma.packageAddon.create({ data: { packageId: ids.p1, name: code('addon'), price: 700 } });
    const addon = await prisma.packageAddon.findFirstOrThrow({ where: { packageId: ids.p1 } });
    await done(await taskOf(service.requestAddon(pos, line, { addonId: addon.id })));
    for (const kind of ['hold', 'release', 'addon']) expect(await last(kind)).toMatchObject({ providerId: null });
    await prisma.packageAddon.deleteMany({ where: { packageId: ids.p1 } });
  });

  it('every operation entry written above carries both; the CHECK lists the same kinds and refuses one without them', async () => {
    const written = await prisma.walletEntry.findMany({ where: { userId: { in: [ids.pos, ids.pos2] }, kind: { in: PROVIDER_OPERATION_KINDS } } });
    expect(written.length).toBeGreaterThan(30);
    expect(written.filter((row) => row.providerId === null || row.providerCost === null)).toEqual([]);

    const sql = readFileSync(join(__dirname, '../../../prisma/migrations/20261117210000_provider_ledger_stored/migration.sql'), 'utf8');
    const listed = /"kind" NOT IN \(([^)]*)\)/.exec(sql)?.[1].match(/'([a-z]+)'/g)?.map((item) => item.slice(1, -1));
    expect(listed).toEqual(PROVIDER_OPERATION_KINDS);
    const refused = prisma.walletEntry.create({ data: { userId: ids.pos, actorId: ids.pos, amount: 0, balanceAfter: 0, kind: 'freeze', providerCost: 0 } });
    await expect(refused).rejects.toThrow(/WalletEntry_operation_priced/);
  });
});
