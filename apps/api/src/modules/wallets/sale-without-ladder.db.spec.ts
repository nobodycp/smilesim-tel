import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';
import type { Sale } from './sale';
import type { WalletLedger } from './wallet-ledger';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-19 business-lines foundation, F.3 (ADR 0028, decision 4): a sale
// is never written without its margins. `WalletLedger.post` refuses an entry of a sale kind that moves money out when
// its ladder cannot be built — the line's terms name no package, the package they name does not exist, there is no
// line — before the INSERT: the transaction rolls back, the balance does not move, nothing is written. The CHECK
// `WalletEntry_sale_has_ladder` refuses the same row written past the ledger. A refund, an operation moving 0 and a
// sale with its ladder are not touched.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('a sale is never written without its margins (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `nl-${tag}`;
  const START = 1_000_000;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  let ledger: WalletLedger;
  let runTx: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  let pos: { sessionId: string };
  let lineId: string;

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;
  const saleOn = (line: string): Sale => ({ msisdn: '', lineId: line, companyName: 'nl', packageName: 'nl', packagePrice: 3200, providerId: ids.provider, providerCost: 1800 });
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: u.pos } })).balance;
  const entries = () => prisma.walletEntry.count({ where: { userId: u.pos } });

  /** Tries a sale of `kind` on `sale` and answers what it threw, after checking that nothing moved. */
  async function refused(kind: string, sale: Sale): Promise<string> {
    const [before, written] = [await balance(), await entries()];
    const error = await runTx((tx) => ledger.move(tx, u.pos, -3200, u.owner, kind, '', sale)).then(() => null, (thrown: unknown) => thrown as Error);
    expect(error).not.toBeNull();
    expect(await balance()).toBe(before);
    expect(await entries()).toBe(written);
    return (error as Error).message;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: `nl-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? START : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    pos = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'nl' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'nl' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'nl', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    const graph = (service as unknown as { graph: { ledger: WalletLedger; uow: { runTx: typeof runTx } } }).graph;
    ledger = graph.ledger;
    runTx = (run) => graph.uow.runTx(run);
    const sold = (await service.activate(pos, { packageCode: code, posLoginName: `nl-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { line: { id: string } };
    lineId = sold.line.id;
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.task.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidLine.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('writes a sale with its ladder, as before', async () => {
    const before = await balance();
    await runTx((tx) => ledger.move(tx, u.pos, -3200, u.owner, 'charge', '', saleOn(lineId)));
    expect(await balance()).toBe(before - 3200);
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { lineId, kind: 'charge' }, orderBy: { createdAt: 'desc' } });
    expect(entry.ladder).not.toBeNull();
    expect(entry.branchMargin).not.toBeNull();
  });

  it('refuses a sale with no line (and no charged operation to name a package)', async () => {
    for (const kind of ['activate', 'charge', 'extend', 'reactivate']) {
      expect(await refused(kind, saleOn(''))).toBe(`a ${kind} sale is written without its ladder (ADR 0028, decision 4)`);
    }
  });

  it('refuses a sale on a line whose terms name no package', async () => {
    const kept = await prisma.postpaidLine.findUniqueOrThrow({ where: { id: lineId }, select: { terms: true } });
    await prisma.postpaidLine.update({ where: { id: lineId }, data: { terms: { months: 1 } } });
    try {
      expect(await refused('extend', saleOn(lineId))).toMatch(/extend sale is written without its ladder/);
    } finally {
      await prisma.postpaidLine.update({ where: { id: lineId }, data: { terms: kept.terms as Prisma.InputJsonValue } });
    }
  });

  it('refuses a sale on a line whose terms name a package that does not exist', async () => {
    const kept = await prisma.postpaidLine.findUniqueOrThrow({ where: { id: lineId }, select: { terms: true } });
    await prisma.postpaidLine.update({ where: { id: lineId }, data: { terms: { ...(kept.terms as Record<string, unknown>), packageCode: `${code}-gone` } } });
    try {
      expect(await refused('charge', saleOn(lineId))).toMatch(/charge sale is written without its ladder/);
    } finally {
      await prisma.postpaidLine.update({ where: { id: lineId }, data: { terms: kept.terms as Prisma.InputJsonValue } });
    }
  });

  it('leaves alone an operation of a sale kind that moves 0, and a refund', async () => {
    const before = await entries();
    // A sale priced 0 (the loss mark, P.7) is recorded with no ladder: it moves no money.
    await runTx((tx) => ledger.recordOp(tx, u.pos, u.owner, 'activate', { ...saleOn(''), packagePrice: 0 }));
    // A refund on the line keeps its sale's ladder scaled; refunds are not refused (spec F.3: listed, decided there).
    await runTx((tx) => ledger.move(tx, u.pos, 500, u.owner, 'disconnect', '', saleOn(lineId)));
    expect(await entries()).toBe(before + 2);
  });

  it('the database refuses a sale that moves money with no ladder, written past the ledger', async () => {
    const row = { userId: u.pos, actorId: u.owner, balanceAfter: 0, providerId: ids.provider, providerCost: 0 };
    await expect(prisma.walletEntry.create({ data: { ...row, amount: -100, kind: 'activate' } })).rejects.toThrow(/WalletEntry_sale_has_ladder/);
    // Neither a refund, nor 0, nor a kind that is not a sale is concerned.
    const passed = await prisma.$transaction(async (tx) => [
      await tx.walletEntry.create({ data: { ...row, amount: 100, kind: 'disconnect' }, select: { id: true } }),
      await tx.walletEntry.create({ data: { ...row, amount: 0, kind: 'charge' }, select: { id: true } }),
      await tx.walletEntry.create({ data: { ...row, amount: -100, kind: 'addon', providerId: null, providerCost: null }, select: { id: true } }),
    ]);
    expect((await prisma.walletEntry.deleteMany({ where: { id: { in: passed.map((entry) => entry.id) } } })).count).toBe(3);
    const [state] = await prisma.$queryRaw<{ convalidated: boolean }[]>`SELECT convalidated FROM pg_constraint WHERE conname = 'WalletEntry_sale_has_ladder'`;
    expect(state?.convalidated).toBe(true);
  });
});
