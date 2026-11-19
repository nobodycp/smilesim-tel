import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { ApiFailure } from '../platform/api-failure';
import type { NoticeService } from '../notifications/notice.service';
import { LinePricing } from './line-pricing';
import { ApiFacade } from '../testing/api-facade';

// PostgreSQL only (TEST_DATABASE_URL). A sale reads no account tree under the wallet lock: it is priced on the path
// read before its transaction, and that path is confirmed under the lock by its accounts' rows alone (database plan
// DB.9, ADR 0023). Counted from Prisma's own query log, as `access/sign-in-cost.db.spec.ts` counts a request.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the tree out of the wallet lock (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), agent2: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `tree-${tag}`;
  const statements: string[] = [];
  let prisma: PrismaClient;
  let service: ApiFacade;
  let gate: { sessionId: string };

  const serial = () => `89${Date.now()}${Math.floor(Math.random() * 1e4)}`.padEnd(19, '0').slice(0, 19);
  const activate = () => service.activate(gate, { packageCode: code, posLoginName: `tree-${tag}-pos`, iccid: serial(), outcome: 'success' }) as Promise<{ applied: boolean; line: { id: string } }>;
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: u.pos } })).balance;

  /** The statements sent after the seller's wallet was locked, to the end of that transaction. */
  const underLock = (sent: string[]) => {
    const at = sent.findIndex((sql) => /FROM "Wallet" WHERE "userId" = \$1 FOR UPDATE/.test(sql));
    expect(at).toBeGreaterThanOrEqual(0);
    const end = sent.findIndex((sql, index) => index > at && /^COMMIT/.test(sql));
    return sent.slice(at, end < 0 ? undefined : end);
  };
  const wholeTree = (sent: string[]) => sent.filter((sql) => /FROM "public"\."User" WHERE 1=1 ORDER BY "public"\."User"\."loginName"/.test(sql));
  const pathRows = (sent: string[]) => sent.filter((sql) => /FROM "public"\."User" WHERE "public"\."User"\."id" IN/.test(sql));

  /** Runs `change` between the sale's reads (its path and its price) and its transaction. */
  const beforeTheLock = (change: () => Promise<unknown>) => {
    const stamp = LinePricing.prototype.stampFor;
    return jest.spyOn(LinePricing.prototype, 'stampFor').mockImplementationOnce(async function (this: LinePricing, ...args) {
      const stamped = await stamp.apply(this, args);
      await change();
      return stamped;
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaClient({ adapter: new PrismaPg(url!), log: [{ emit: 'event', level: 'query' }] });
    (prisma as unknown as { $on(event: 'query', listen: (query: { query: string }) => void): void }).$on('query', (event) => void statements.push(event.query));
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null, isBranchOwner = false) => ({ id, loginName: `tree-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner });
    const accounts = [
      row(u.owner, 'owner', 'branch', null, true),
      row(u.main, 'main', 'main_agent', u.owner),
      row(u.agent, 'agent', 'agent', u.main),
      row(u.agent2, 'agent2', 'agent', u.main),
      row(u.pos, 'pos', 'pos', u.agent),
    ];
    for (const account of accounts) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? 1_000_000 : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    gate = { sessionId: await auth.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }) };
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'tree' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'tree' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    const prices = {
      branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
      renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
    };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'tree', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);
    service.prismaClient = prisma;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // The tree as it was set up, for the next case.
    await prisma.user.update({ where: { id: u.pos }, data: { parentId: u.agent } });
    await prisma.user.update({ where: { id: u.agent }, data: { parentId: u.main, disabledAt: null } });
    await prisma.postpaidSellPrice.deleteMany({ where: { packageId: ids.pkg } });
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.postpaidLine.deleteMany({ where: { posId: u.pos } });
    await prisma.postpaidSellPrice.deleteMany({ where: { packageId: ids.pkg } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    for (const id of [u.pos, u.agent2, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  // Before DB.9 (measured on ff8b62d1): an activation sent 11 statements from the wallet's lock to the end of its
  // transaction and an extension 12, in each one the whole tree (every account, ordered by login). After: the same
  // 11 and 12, the tree replaced by the path's four rows read by id.
  it('an activation reads no tree under the wallet lock: the path it was priced on is confirmed by its rows', async () => {
    statements.length = 0;
    const sold = await activate();
    expect(sold.applied).toBe(true);
    const locked = underLock([...statements]);
    expect(wholeTree(locked)).toEqual([]);
    expect(pathRows(locked)).toHaveLength(1);
    expect(locked).toHaveLength(11);
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { lineId: sold.line.id, kind: 'activate' } });
    expect(entry.amount).toBe(-3500);
    expect((entry.ladder as { chain: string[] }).chain).toEqual([u.pos, u.agent, u.main, u.owner]);
  });

  it('an extension reads no tree under the wallet lock', async () => {
    const sold = await activate();
    statements.length = 0;
    expect(await service.extend(gate, sold.line.id, { outcome: 'success' })).toEqual({ applied: true, debited: true });
    const locked = underLock([...statements]);
    expect(wholeTree(locked)).toEqual([]);
    expect(pathRows(locked)).toHaveLength(1);
    expect(locked).toHaveLength(12);
  });

  it('refuses the sale, and changes nothing, when the point of sale was moved after its path was read', async () => {
    const before = await balance();
    const lines = await prisma.postpaidLine.count({ where: { posId: u.pos } });
    beforeTheLock(() => prisma.user.update({ where: { id: u.pos }, data: { parentId: u.agent2 } }));
    await expect(activate()).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await balance()).toBe(before);
    expect(await prisma.postpaidLine.count({ where: { posId: u.pos } })).toBe(lines);
    // Asked again, the sale reads the new path and goes through on it.
    const sold = await activate();
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { lineId: sold.line.id, kind: 'activate' } });
    expect((entry.ladder as { chain: string[] }).chain).toEqual([u.pos, u.agent2, u.main, u.owner]);
  });

  it('refuses the sale when an account above it was moved after the path was read', async () => {
    const before = await balance();
    beforeTheLock(() => prisma.user.update({ where: { id: u.agent }, data: { parentId: u.owner } }));
    const refused = await activate().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiFailure);
    expect(refused).toMatchObject({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await balance()).toBe(before);
  });

  it('sells, as before DB.9, when an account above was frozen after the path was read: a freeze prices nothing', async () => {
    const before = await balance();
    beforeTheLock(() => prisma.user.update({ where: { id: u.agent }, data: { disabledAt: new Date() } }));
    const sold = await activate();
    expect(sold.applied).toBe(true);
    expect(await balance()).toBe(before - 3500);
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { lineId: sold.line.id, kind: 'activate' } });
    expect((entry.ladder as { chain: string[] }).chain).toEqual([u.pos, u.agent, u.main, u.owner]);
  });

  it('charges the price it quoted when a price above changed after the read; the ladder reads the price rows under the lock, as before', async () => {
    const before = await balance();
    // The main agent now sells to its agents at 3100 instead of the agent column's 3000.
    beforeTheLock(() => prisma.postpaidSellPrice.create({ data: { packageId: ids.pkg, ownerId: u.main, price: 3100 } }));
    const sold = await activate();
    expect(await balance()).toBe(before - 3500);
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { lineId: sold.line.id, kind: 'activate' } });
    expect(entry.amount).toBe(-3500);
    expect((entry.ladder as { costs: Record<string, number> }).costs).toMatchObject({ [u.pos]: 3500, [u.agent]: 3100, [u.main]: 2500 });
  });
});
