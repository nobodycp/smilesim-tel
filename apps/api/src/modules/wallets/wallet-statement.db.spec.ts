import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';
import { OFF_THE_STATEMENT } from './entry-kinds';
import type { Sale } from './sale';
import type { WalletLedger } from './wallet-ledger';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-19 business-lines foundation, F.2: an account's own wallet page
// («المحفظة», `GET /v1/ledger`) is a statement and lists by exclusion. Every entry that moved the account's balance is
// on it, an add-on included (missing before), so its rows explain every change of `balanceAfter` from the first to the
// last; a task's hold and release (`OFF_THE_STATEMENT`) stay off it.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Row = { id: string; kind: string; amount: number; balanceBefore: number; balanceAfter: number };

suite('an account\'s wallet page lists everything that moved its balance (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID(), addon: randomUUID() };
  const code = `ws-${tag}`;
  const START = 1_000_000;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let ledger: WalletLedger;
  let runTx: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  let pos: { sessionId: string };
  let owner: { sessionId: string };

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const bare = (): Sale => ({ msisdn: '', lineId: '', companyName: 'ws', packageName: 'ws', packagePrice: 0, providerId: ids.provider, providerCost: 0 });

  /** Every row of the page, newest first, page after page. */
  async function statement(query: { kind?: string } = {}): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: string | undefined;
    do {
      const read = await service.ledger(pos, { ...query, cursor });
      rows.push(...read.items);
      cursor = read.nextCursor ?? undefined;
    } while (cursor);
    return rows;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: `ws-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    owner = { sessionId: await auth.saveSession({ userId: u.owner, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'ws' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'ws' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'ws', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    await prisma.postpaidPackageAddon.create({ data: { id: ids.addon, packageId: ids.pkg, name: 'ws add-on', price: 1500 } });
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
    await prisma.postpaidPackageAddon.deleteMany({ where: { id: ids.addon } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('writes every kind of today on one account', async () => {
    // The money movements (amounts chosen so the balance never comes back to a value it had).
    await runTx((tx) => ledger.move(tx, u.pos, 1_111, u.owner, 'fund', 'in'));
    await runTx((tx) => ledger.move(tx, u.pos, 2_222, u.owner, 'self_fund', 'own'));
    await runTx((tx) => ledger.move(tx, u.pos, -333, u.owner, 'deduct', 'back'));
    await runTx((tx) => ledger.move(tx, u.pos, 444, u.owner, 'deduct_in', 'from a child'));
    // A sale, an add-on (a task's hold, then its release and the add-on's charge), a renewal, a refund and a restart.
    const sold = (await service.activate(pos, { packageCode: code, posLoginName: `ws-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { line: { id: string } };
    const lineId = sold.line.id;
    const asked = (await service.requestAddon(pos, lineId, { addonId: ids.addon })) as { taskId: string };
    await service.completeTask(owner, asked.taskId, {});
    await service.extend(pos, lineId, { outcome: 'success' });
    await service.operate(pos, lineId, 'disconnect', { outcome: 'success' });
    await service.operate(pos, lineId, 'charge', { outcome: 'success' });
    // The operations that move no money.
    for (const kind of ['reactivate', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer']) {
      await runTx((tx) => ledger.recordOp(tx, u.pos, u.owner, kind, bare()));
    }
    const kinds = new Set((await prisma.walletEntry.findMany({ where: { userId: u.pos }, select: { kind: true } })).map((row) => row.kind));
    for (const kind of ['fund', 'self_fund', 'deduct', 'deduct_in', 'hold', 'release', 'addon', 'activate', 'extend', 'disconnect', 'charge']) expect(kinds).toContain(kind);
  });

  it('shows the add-on on its owner\'s wallet page, and leaves the hold and the release off it', async () => {
    const rows = await statement();
    const addon = rows.filter((row) => row.kind === 'addon');
    expect(addon).toHaveLength(1);
    expect(addon[0].amount).toBe(-1500);
    expect(rows.some((row) => OFF_THE_STATEMENT.includes(row.kind))).toBe(false);
    // Every entry of the account but those is on the page.
    expect(rows).toHaveLength(await prisma.walletEntry.count({ where: { userId: u.pos, kind: { notIn: [...OFF_THE_STATEMENT] } } }));
  });

  it('explains every change of the balance from its first row to its last: no gap', async () => {
    const rows = await statement();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.pos } });
    // Walk from the starting balance: at each step a row starts where the last one ended. A row that moves nothing
    // starts and ends there; every row is used once and the walk ends at the wallet's balance.
    const left = [...rows];
    let at = START;
    while (left.length) {
      const still = left.findIndex((row) => row.amount === 0 && row.balanceBefore === at);
      const next = still >= 0 ? still : left.findIndex((row) => row.balanceBefore === at);
      if (next < 0) throw new Error(`no row of the page starts at ${at}: ${left.length} rows left (${left.map((row) => row.kind).join(', ')})`);
      const [row] = left.splice(next, 1);
      expect(row.balanceAfter - row.amount).toBe(row.balanceBefore);
      at = row.balanceAfter;
    }
    expect(at).toBe(wallet.balance);
  });

  it('filters on any kind on the page, an add-on included; a kind off it is ignored, as before', async () => {
    const addon = await statement({ kind: 'addon' });
    expect(addon.map((row) => row.kind)).toEqual(['addon']);
    const all = await statement();
    expect(await statement({ kind: 'hold' })).toHaveLength(all.length);
  });
});
