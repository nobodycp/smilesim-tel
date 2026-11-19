import { useSealingKey } from '../platform/testing/sealing-key';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { Ladder } from '../postpaid/pricing';
import type { NoticeService } from '../notifications/notice.service';
import { ApiFacade } from '../testing/api-facade';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-19-finance-ledger-columns, FL.1: each row of «المالية» carries
// the viewer's own cost and sell price on a sale or refund, read from the ladder the entry stored, so `sell − cost` is
// the margin the entry stored for it (ADR 0026) on every row; and no row tells a layer the price of a layer above it.
// Real sales: an activation, a renewal and a refund (a disconnect), read by the point of sale, its agent, its main
// agent and the branch.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Item = { id: string; kind: string; margin: number | null; cost: number | null; sell: number | null };
type Gate = { sessionId: string };

suite('the viewer\'s own cost and sell on the finance list (PostgreSQL)', () => {
  useSealingKey();
  jest.setTimeout(90_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const ids = { provider: randomUUID(), company: randomUUID(), pkg: randomUUID() };
  const code = `fp-${tag}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ApiFacade;
  const gates = {} as Record<'pos' | 'agent' | 'main' | 'owner', Gate>;
  // Each layer pays a different price, so a figure read from the wrong account shows.
  const prices = {
    branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 3800,
    renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
  };
  let entries: { id: string; kind: string; ladder: Ladder }[] = [];

  const serial = () => `89${Math.floor(Math.random() * 1e17).toString().padStart(17, '0')}`;

  /** The finance rows of this spec's sales, as `gate` reads them, page after page. */
  async function rowsOf(gate: Gate): Promise<Map<string, Item & Record<string, unknown>>> {
    const wanted = new Set(entries.map((entry) => entry.id));
    const found = new Map<string, Item & Record<string, unknown>>();
    let cursor: string | undefined;
    do {
      const read = await service.finance(gate, { cursor });
      for (const item of read.items as (Item & Record<string, unknown>)[]) if (wanted.has(item.id)) found.set(item.id, item);
      cursor = read.nextCursor ?? undefined;
    } while (cursor && found.size < wanted.size);
    return found;
  }

  /** Every number anywhere in `value`. */
  const numbersIn = (value: unknown): number[] => {
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) return value.flatMap(numbersIn);
    if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
    return [];
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const auth = new MemoryAuthStore();
    const row = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: `fp-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const account of [row(u.owner, 'owner', 'branch', null), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, wallet: { create: { balance: account.id === u.pos ? 1_000_000 : 0, ceiling: 0 } } } });
      auth.addUser({ ...account, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    }
    for (const [name, id] of [['pos', u.pos], ['agent', u.agent], ['main', u.main], ['owner', u.owner]] as const) {
      gates[name] = { sessionId: await auth.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' }) };
    }
    await prisma.provider.create({ data: { id: ids.provider, code, name: 'fp' } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code, name: 'fp' } });
    const auto = { autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true };
    await prisma.postpaidPackage.create({ data: { id: ids.pkg, code, name: 'fp', providerId: ids.provider, companyId: ids.company, ...prices, ...auto } });
    // The point of sale sells to its customers at 4000 (its own sell price), renewals at the subscriber price.
    await prisma.postpaidSellPrice.create({ data: { packageId: ids.pkg, ownerId: u.pos, price: 4000 } });
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new ApiFacade(auth, notice);

    // An activation, a renewal of it, and its disconnect (a refund of part of the renewal).
    const sold = (await service.activate(gates.pos, { packageCode: code, posLoginName: `fp-${tag}-pos`, iccid: serial(), outcome: 'success' })) as { line: { id: string } };
    await service.extend(gates.pos, sold.line.id, { outcome: 'success' });
    await service.operate(gates.pos, sold.line.id, 'disconnect', { outcome: 'success' });
    const written = await prisma.walletEntry.findMany({ where: { userId: u.pos, kind: { in: ['activate', 'extend', 'disconnect'] } } });
    entries = written.filter((entry) => entry.ladder).map((entry) => ({ id: entry.id, kind: entry.kind, ladder: entry.ladder as unknown as Ladder }));
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
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('wrote an activation, a renewal and a refund, each with its ladder', () => {
    expect(entries.map((entry) => entry.kind).sort()).toEqual(['activate', 'disconnect', 'extend']);
    expect(entries.find((entry) => entry.kind === 'disconnect')?.ladder.share).toBeLessThan(0);
  });

  it('gives each viewer its own cost and sell, and sell − cost is the margin the entry stored for it, on every row', async () => {
    const share = entries.find((entry) => entry.kind === 'disconnect')?.ladder.share as number;
    // What each account paid (cost) and what the next one paid (sell): the activation, then the renewal.
    const own = {
      pos: { activate: [3500, 4000], extend: [3200, 3500] },
      agent: { activate: [2900, 3500], extend: [2700, 3200] },
      main: { activate: [2400, 2900], extend: [2100, 2700] },
      owner: { activate: [2000, 2400], extend: [1800, 2100] },
    } as const;
    for (const viewer of ['pos', 'agent', 'main', 'owner'] as const) {
      const rows = await rowsOf(gates[viewer]);
      expect({ viewer, rows: rows.size }).toEqual({ viewer, rows: 3 });
      for (const row of rows.values()) {
        expect(row.margin).not.toBeNull();
        expect({ viewer, kind: row.kind, gap: (row.sell ?? 0) - (row.cost ?? 0) }).toEqual({ viewer, kind: row.kind, gap: row.margin });
        if (row.kind === 'disconnect') {
          // The refund gives back the renewal's share: its cost scaled as its margin is.
          const [cost, sell] = own[viewer].extend;
          expect(row.cost).toBe(Math.round(cost * share));
          expect(row.margin).toBe(Math.round((sell - cost) * share));
        } else {
          const [cost, sell] = own[viewer][row.kind as 'activate' | 'extend'];
          expect({ viewer, kind: row.kind, cost: row.cost, sell: row.sell }).toEqual({ viewer, kind: row.kind, cost, sell });
        }
      }
    }
  });

  it('tells a point of sale and an agent no price of a layer above them, and sends no ladder', async () => {
    const share = entries.find((entry) => entry.kind === 'disconnect')?.ladder.share as number;
    const scaled = (values: number[]) => [...values, ...values.map((value) => Math.round(value * share))];
    // What the agent, the main agent and the branch paid; what the main agent and the branch paid.
    const above = {
      pos: scaled([prices.agentPrice, prices.mainPrice, prices.branchCost, prices.renewalAgentPrice, prices.renewalMainPrice, prices.renewalBranchCost]),
      agent: scaled([prices.mainPrice, prices.branchCost, prices.renewalMainPrice, prices.renewalBranchCost]),
    };
    for (const viewer of ['pos', 'agent'] as const) {
      const rows = [...(await rowsOf(gates[viewer])).values()];
      expect(rows.length).toBe(3);
      for (const row of rows) {
        expect(row).not.toHaveProperty('ladder');
        expect(row.shares).toBeNull();
        expect({ viewer, kind: row.kind, leaked: numbersIn(row).filter((value) => above[viewer].includes(value)) }).toEqual({ viewer, kind: row.kind, leaked: [] });
      }
    }
  });

  it('the point of sale\'s own statement carries the same cost and sell', async () => {
    const finance = await rowsOf(gates.pos);
    const statement = (await service.ledger(gates.pos, {})).items.filter((item) => finance.has(item.id));
    expect(statement.length).toBe(3);
    for (const item of statement) expect({ cost: item.cost, sell: item.sell }).toEqual({ cost: finance.get(item.id)?.cost, sell: finance.get(item.id)?.sell });
  });
});
