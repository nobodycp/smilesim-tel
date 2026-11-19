import { WalletsRepository } from './wallets.repository';
import { ServiceGraph } from '../testing/service-graph';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { Actor } from '../access/types';
import { WalletsService } from './wallets.service';

// «المالية» (owner 2026-11-09: «شامله كل العمليات للاب والابناء الي تحته»): every entry of the viewer and the
// accounts below it, the money by default and every operation with `scope=all` (point 7 of 2026-11-19); the branch also reads what every
// account in a sale's chain earned on it, as stored on the entry (ADR 0026).
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];
const ladder = { kind: 'subscription', chain: ['pos', 'agent', 'main', 'branch'], costs: { pos: 3800, agent: 3500, main: 3000, branch: 2500 }, posSell: 4500 };
const at = new Date('2026-11-02T00:00:00.000Z');
// What `post` stores beside the ladder: marginOf it for each layer's account.
const margins = { chainPosId: 'pos', chainAgentId: 'agent', chainMainAgentId: 'main', posMargin: 700, agentMargin: 300, mainAgentMargin: 500, branchMargin: 500 };
const none = { chainPosId: null, chainAgentId: null, chainMainAgentId: null, posMargin: null, agentMargin: null, mainAgentMargin: null, branchMargin: null };
const base = { balanceAfter: 0, reason: null, held: null, msisdn: '0500', companyName: 'c', packageName: 'p', packagePrice: 3800, esimPrice: null, note: null, createdAt: at };
const entries = [
  { ...base, id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', amount: -3800, ladder, ...margins },
  { ...base, id: 'e2', userId: 'pos', kind: 'rename', lineId: 'l1', amount: 0, ladder: null, ...none },
  { ...base, id: 'e3', userId: 'agent', kind: 'fund', lineId: null, amount: 10000, ladder: null, ...none },
];

function service(seen: { where?: Record<string, unknown> }) {
  const kernel = new ServiceGraph(new MemoryAuthStore());
  const user = (id: string) => accounts.find((account) => account.id === id);
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    walletEntry: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        seen.where = where;
        return entries.map((row) => ({ ...row, user: user(row.userId), actor: user(row.userId) }));
      },
      count: async () => entries.length,
    },
  } as unknown as ServiceGraph['prismaClient'];
  return new WalletsService(kernel.uow, kernel.tree, kernel.ledger, new WalletsRepository(kernel.uow));
}

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });

describe('WalletsService.finance', () => {
  // The owner's point 7 (spec 2026-11-19-finance-ledger-columns): «المالية» is the movements on the wallets. By default
  // (or `scope=money`) an entry that moved money, and for the branch its loss marks; a hold and its release move no
  // balance and are read on their own (`holds`); `all` keeps every entry, the operations that moved nothing included.
  it('reads the money by default and with scope=money, and every entry with scope=all', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    const money = [{ amount: { not: 0 } }];
    await wallets.finance(actor('agent', 'agent'), {});
    expect(seen.where?.AND).toEqual(money);
    expect(seen.where?.userId).toEqual({ in: expect.arrayContaining(['agent', 'pos']) });
    expect((seen.where?.userId as { in: string[] }).in).not.toContain('main');
    await wallets.finance(actor('agent', 'agent'), { scope: 'money' });
    expect(seen.where?.AND).toEqual(money);
    await wallets.finance(actor('agent', 'agent'), { scope: 'all' });
    expect(seen.where?.AND).toBeUndefined();
    await wallets.finance(actor('agent', 'agent'), { scope: 'holds' });
    expect(seen.where?.AND).toEqual([{ kind: { in: ['hold', 'release'] } }]);
  });

  it('keeps the branch\'s loss marks, which move 0, in its money view, so its loss filter still finds them', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    await wallets.finance(actor('branch', 'branch'), {});
    expect(seen.where?.AND).toEqual([{ OR: [{ amount: { not: 0 } }, { providerLoss: { not: null } }] }]);
    await wallets.finance(actor('branch', 'branch'), { loss: 'any' });
    expect(seen.where?.providerLoss).toEqual(expect.anything());
    expect(seen.where?.AND).toEqual([{ OR: [{ amount: { not: 0 } }, { providerLoss: { not: null } }] }]);
  });

  it('writes the CSV with the same filter as the page', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    await wallets.financeCsv(actor('agent', 'agent'), {});
    expect(seen.where?.AND).toEqual([{ amount: { not: 0 } }]);
    await wallets.financeCsv(actor('agent', 'agent'), { scope: 'all' });
    expect(seen.where?.AND).toBeUndefined();
  });

  it('keeps the line operations only with scope=operations — the entries that stored a provider (F.5) — and still narrows by kind', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    await wallets.finance(actor('agent', 'agent'), { scope: 'operations' });
    expect(seen.where?.AND).toEqual([{ providerId: { not: null } }]);
    expect(seen.where?.kind).toBeUndefined();
    await wallets.finance(actor('agent', 'agent'), { scope: 'operations', kind: 'charge' });
    expect(seen.where?.kind).toBe('charge');
    expect(seen.where?.AND).toEqual([{ providerId: { not: null } }]);
  });

  it('gives the branch every account\'s share of a sale, branch first, and nothing for other entries', async () => {
    const result = await service({}).finance(actor('branch', 'branch'), {});
    const sale = result.items.find((row) => row.id === 'e1');
    expect(sale?.shares).toEqual([
      { loginName: 'branch', layer: 'branch', margin: 500 },
      { loginName: 'main', layer: 'main_agent', margin: 500 },
      { loginName: 'agent', layer: 'agent', margin: 300 },
      { loginName: 'pos', layer: 'pos', margin: 700 },
    ]);
    expect(result.items.find((row) => row.id === 'e2')?.shares).toBeNull();
    expect(result.items.find((row) => row.id === 'e3')?.shares).toBeNull();
  });

  it('keeps the shares from the layers below the branch, with their own margin only', async () => {
    const result = await service({}).finance(actor('agent', 'agent'), {});
    const sale = result.items.find((row) => row.id === 'e1');
    expect(sale?.shares).toBeNull();
    expect(sale?.margin).toBe(300);
  });

  // FL.1: each viewer's own cost and sell price on a sale (spec 2026-11-19-finance-ledger-columns), from its ladder.
  it('gives each viewer its own cost and sell on a sale, sell − cost its margin, and none on other entries', async () => {
    const expected = { pos: { cost: 3800, sell: 4500 }, agent: { cost: 3500, sell: 3800 }, main_agent: { cost: 3000, sell: 3500 }, branch: { cost: 2500, sell: 3000 } };
    for (const [id, layer] of [['pos', 'pos'], ['agent', 'agent'], ['main', 'main_agent'], ['branch', 'branch']] as const) {
      const result = await service({}).finance(actor(id, layer), {});
      const sale = result.items.find((row) => row.id === 'e1');
      expect({ layer, cost: sale?.cost, sell: sale?.sell }).toEqual({ layer, ...expected[layer] });
      expect((sale?.sell ?? 0) - (sale?.cost ?? 0)).toBe(sale?.margin);
      for (const other of result.items.filter((row) => row.id !== 'e1')) expect([other.cost, other.sell]).toEqual([null, null]);
    }
  });

  it('writes the viewer\'s cost and sell into the CSV, empty where the row has none', async () => {
    const csv = await service({}).financeCsv(actor('agent', 'agent'), {});
    const [head, ...lines] = csv.replace('\uFEFF', '').split('\r\n');
    const cost = head.split(',').indexOf('cost');
    expect(head.split(',').indexOf('sell')).toBe(cost + 1);
    expect(lines[0].split(',').slice(cost, cost + 2)).toEqual(['35.00', '38.00']);
    expect(lines[1].split(',').slice(cost, cost + 2)).toEqual(['', '']);
  });
});
