import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { marginOf, type Ladder } from '../postpaid/pricing';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';
import type { Sale } from './sale';
import { marginBreaks } from './stored-margins';
import type { WalletLedger } from './wallet-ledger';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0026, slice M.1: every sale and refund entry stores its chain by layer and
// each layer's margin, written by `WalletLedger.post` in the entry's own INSERT from the ladder it keeps, and equal to
// `marginOf(ladder, account)`; a refund's are its sale's scaled by its share (negative) for the same accounts; an
// entry without a ladder stores none. The figures of an entry never move after it was written: a point of sale moved
// to another agent leaves its earlier sales' margins with the agent of the time (the owner's answer 1).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('each sale\'s margins stored on its entry (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), agent2: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `sm-${tag}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let ledger: WalletLedger;
  let runTx: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const sell = (outcome: string) => service.activate(pos, { packageCode: code, posLoginName: `sm-${tag}-pos`, iccid: serial(), outcome });
  const entryOf = (lineId: string, kind: string) => prisma.walletEntry.findFirstOrThrow({ where: { lineId, kind }, orderBy: { createdAt: 'desc' } });
  const columns = (row: { chainPosId: string | null; chainAgentId: string | null; chainMainAgentId: string | null; posMargin: number | null; agentMargin: number | null; mainAgentMargin: number | null; branchMargin: number | null }) => ({
    chainPosId: row.chainPosId, chainAgentId: row.chainAgentId, chainMainAgentId: row.chainMainAgentId,
    posMargin: row.posMargin, agentMargin: row.agentMargin, mainAgentMargin: row.mainAgentMargin, branchMargin: row.branchMargin,
  });
  /** The invariant (ADR 0026, rule 6): the stored margins are `marginOf` of the kept ladder for the stored accounts. */
  const projected = (row: { ladder: Prisma.JsonValue; chainPosId: string | null; chainAgentId: string | null; chainMainAgentId: string | null }) => {
    const ladder = row.ladder as unknown as Ladder;
    const of = (id: string | null) => (id === null ? null : marginOf(ladder, id));
    return {
      chainPosId: ladder.chain[0], chainAgentId: row.chainAgentId, chainMainAgentId: row.chainMainAgentId,
      posMargin: of(row.chainPosId), agentMargin: of(row.chainAgentId), mainAgentMargin: of(row.chainMainAgentId), branchMargin: of(ladder.chain[ladder.chain.length - 1]),
    };
  };
  const bare = (amount: number): Sale => ({ msisdn: '', lineId: '', companyName: '', packageName: '', packagePrice: -amount, providerId: ids.provider, providerCost: 0 });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: `sm-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.agent2, 'agent2', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? 1_000_000 : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: u.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'sm' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'sm' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    // Each layer earns a different amount, so a margin stored in the wrong column shows.
    const prices = {
      branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'sm', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // The point of sale sells to its customers at 4000 (its own sell price), renewals at the subscriber price.
    await prisma.postpaidSellPrice.create({ data: { packageId: ids.pkg, ownerId: u.pos, price: 4000 } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    const graph = (service as unknown as { graph: { ledger: WalletLedger; uow: { runTx: typeof runTx } } }).graph;
    ledger = graph.ledger;
    runTx = (run) => graph.uow.runTx(run);
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.task.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidSellPrice.deleteMany({ where: { packageId: ids.pkg } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent2, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const chain = { chainPosId: u.pos, chainAgentId: u.agent, chainMainAgentId: u.main };

  it('an activation stores its chain and each layer\'s margin, equal to marginOf its ladder', async () => {
    const sold = (await sell('success')) as { line: { id: string } };
    const entry = await entryOf(sold.line.id, 'activate');
    // pos 4000 − 3500, agent 3500 − 2900, main 2900 − 2400, branch 2400 − 2000.
    expect(columns(entry)).toEqual({ ...chain, posMargin: 500, agentMargin: 600, mainAgentMargin: 500, branchMargin: 400 });
    expect(columns(entry)).toEqual(projected(entry));
  });

  it('an extension stores the renewal margins; the disconnect stores minus its share of the last sale\'s, for the same accounts; a charge after it the renewal\'s again', async () => {
    const sold = (await sell('success')) as { line: { id: string } };
    await service.extend(pos, sold.line.id, { outcome: 'success' });
    const extend = await entryOf(sold.line.id, 'extend');
    // The renewal: pos at the subscriber price 3500 − 3200, agent 3200 − 2700, main 2700 − 2100, branch 2100 − 1800.
    expect(columns(extend)).toEqual({ ...chain, posMargin: 300, agentMargin: 500, mainAgentMargin: 600, branchMargin: 300 });
    expect(columns(extend)).toEqual(projected(extend));

    await service.operate(pos, sold.line.id, 'disconnect', { outcome: 'success' });
    const refund = await entryOf(sold.line.id, 'disconnect');
    expect(refund.amount).toBeGreaterThan(0);
    const share = (refund.ladder as unknown as Ladder).share as number;
    expect(share).toBeLessThan(0);
    expect(columns(refund)).toEqual({
      ...chain,
      posMargin: Math.round(300 * share), agentMargin: Math.round(500 * share), mainAgentMargin: Math.round(600 * share), branchMargin: Math.round(300 * share),
    });
    expect(columns(refund)).toEqual(projected(refund));

    // A disconnected line charged again (a restart) is a renewal sale, at the price the restart charged.
    await service.operate(pos, sold.line.id, 'charge', { outcome: 'success' });
    const charge = await entryOf(sold.line.id, 'charge');
    expect(columns(charge)).toMatchObject(chain);
    expect(columns(charge)).toEqual(projected(charge));
  });

  it('a task\'s capture stores the margins of the sale it completes', async () => {
    const opened = (await sell('fail')) as { taskId: string };
    await service.completeTask(owner, opened.taskId, {});
    const line = await prisma.postpaidLine.findFirstOrThrow({ where: { posId: u.pos }, orderBy: { createdAt: 'desc' } });
    const entry = await entryOf(line.id, 'activate');
    expect(columns(entry)).toEqual({ ...chain, posMargin: 500, agentMargin: 600, mainAgentMargin: 500, branchMargin: 400 });
    const renewal = (await service.extend(pos, line.id, { outcome: 'fail' })) as { taskId: string };
    await service.completeTask(owner, renewal.taskId, {});
    expect(columns(await entryOf(line.id, 'extend'))).toEqual({ ...chain, posMargin: 300, agentMargin: 500, mainAgentMargin: 600, branchMargin: 300 });
  });

  it('a switch, a fund and a hold store none', async () => {
    await runTx((tx) => ledger.move(tx, u.pos, -100, u.owner, 'switch', '', bare(-100)));
    await runTx((tx) => ledger.move(tx, u.pos, 100, u.owner, 'fund', 'back'));
    const rows = await prisma.walletEntry.findMany({ where: { userId: u.pos, kind: { in: ['switch', 'fund', 'hold', 'release'] } } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect([row.ladder, ...Object.values(columns(row))].every((value) => value === null)).toBe(true);
  });

  it('a point of sale moved to another agent leaves its earlier sales\' margins with the agent of the time', async () => {
    const before = (await sell('success')) as { line: { id: string } };
    await prisma.user.update({ where: { id: u.pos }, data: { parentId: u.agent2 } });
    try {
      const after = (await sell('success')) as { line: { id: string } };
      expect(columns(await entryOf(before.line.id, 'activate'))).toMatchObject({ chainAgentId: u.agent, agentMargin: 600 });
      expect(columns(await entryOf(after.line.id, 'activate'))).toMatchObject({ chainAgentId: u.agent2, agentMargin: 600, chainMainAgentId: u.main });
      // A refund of the earlier sale goes back to the accounts of that sale, not to the agent of today.
      await service.operate(pos, before.line.id, 'disconnect', { outcome: 'success' });
      expect(columns(await entryOf(before.line.id, 'disconnect'))).toMatchObject({ chainAgentId: u.agent });
    } finally {
      await prisma.user.update({ where: { id: u.pos }, data: { parentId: u.agent } });
    }
  });

  it('every entry this spec wrote holds the invariant, checked in Node (ADR 0026, rule 6)', async () => {
    const rows = await prisma.walletEntry.findMany({ where: { userId: u.pos } });
    const layers = new Map((await prisma.user.findMany({ where: { id: { in: Object.values(u) } }, select: { id: true, layer: true } })).map((row) => [row.id, row.layer]));
    expect(rows.filter((row) => row.ladder).length).toBeGreaterThanOrEqual(8);
    expect(marginBreaks(rows, (id) => layers.get(id) ?? '')).toEqual([]);
    // It catches a margin that is not marginOf its ladder.
    const sale = rows.find((row) => row.kind === 'activate' && row.ladder) as (typeof rows)[number];
    expect(marginBreaks([{ ...sale, agentMargin: (sale.agentMargin ?? 0) + 1 }], (id) => layers.get(id) ?? '')).toEqual([{ id: sale.id, reason: `agentMargin ${(sale.agentMargin ?? 0) + 1} (expected ${sale.agentMargin})` }]);
  });

  it('the database refuses an entry that keeps a ladder without its point of sale and branch margin', async () => {
    const ladder = { kind: 'subscription', chain: [u.pos, u.owner], costs: { [u.pos]: 3500, [u.owner]: 2000 }, posSell: 4000 };
    await expect(prisma.walletEntry.create({ data: { userId: u.pos, actorId: u.owner, amount: 0, balanceAfter: 0, kind: 'fund', ladder } })).rejects.toThrow(/WalletEntry_sale_margins/);
  });
});
