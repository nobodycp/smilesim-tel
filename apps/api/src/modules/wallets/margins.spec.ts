import { WalletsRepository } from './wallets.repository';
import { ServiceGraph } from '../testing/service-graph';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import type { Actor } from '../access/types';
import { WalletsService } from './wallets.service';
import { chainIdsOf, lossMargins, marginColumns, marginViewOf, marginWhere, storedMarginOf, storedPricesOf } from './stored-margins';

// Each account reads what it earned on a sale (roadmap N4) from the margins stored on the entry (ADR 0026): its own
// layer's column, over the sales whose chain held it at the time of the sale (the owner's answer 1); the branch, the
// owner and its staff, the branch's margin of every sale. The sums run in the database (wallets/profit-reads.db.spec.ts).
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'staff', loginName: 'staff', nickname: 's', layer: 'branch', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];
const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });
const ladder = { kind: 'renewal' as const, chain: ['pos', 'agent', 'main', 'branch'], costs: { pos: 3500, agent: 3100, main: 2700, branch: 2200 }, posSell: 4000 };
const path = [{ id: 'pos', layer: 'pos' }, { id: 'agent', layer: 'agent' }, { id: 'main', layer: 'main_agent' }, { id: 'branch', layer: 'branch' }];

describe('the margins stored on an entry (ADR 0026)', () => {
  it('stores each layer\'s marginOf the ladder, by the chain\'s layers', () => {
    expect(marginColumns(ladder, chainIdsOf(path))).toEqual({ chainPosId: 'pos', chainAgentId: 'agent', chainMainAgentId: 'main', posMargin: 500, agentMargin: 400, mainAgentMargin: 400, branchMargin: 500 });
    // A refund of a third: JavaScript's Math.round of each share (ties toward +∞).
    expect(marginColumns({ ...ladder, share: -1 / 3 }, chainIdsOf(path))).toMatchObject({ posMargin: -167, agentMargin: -133, mainAgentMargin: -133, branchMargin: -167 });
    // A chain with no agent (a point of sale under a main agent, as some specs build it).
    expect(chainIdsOf([path[0], path[2], path[3]])).toEqual({ chainPosId: 'pos', chainAgentId: null, chainMainAgentId: 'main' });
  });

  it('refuses a path with two accounts of one layer', () => {
    expect(() => chainIdsOf([path[0], path[1], { id: 'agent2', layer: 'agent' }, path[3]])).toThrow(expect.objectContaining({ status: 409, code: 'DUPLICATE_REQUEST' }));
  });

  it('reads each viewer\'s own column, and the branch\'s for the owner and its staff', () => {
    const row = marginColumns(ladder, chainIdsOf(path));
    expect(storedMarginOf(marginViewOf(actor('pos', 'pos')), row)).toBe(500);
    expect(storedMarginOf(marginViewOf(actor('agent', 'agent')), row)).toBe(400);
    expect(storedMarginOf(marginViewOf(actor('main', 'main_agent')), row)).toBe(400);
    expect(storedMarginOf(marginViewOf(actor('staff', 'branch')), row)).toBe(500);
    expect(storedMarginOf(marginViewOf(actor('agent2', 'agent')), row)).toBeNull();
    expect(storedMarginOf(marginViewOf(actor('pos', 'pos')), { ...row, chainPosId: null, posMargin: null, branchMargin: null })).toBeNull();
    expect(marginWhere(marginViewOf(actor('agent', 'agent')))).toEqual({ chainAgentId: 'agent' });
    expect(marginWhere(marginViewOf(actor('staff', 'branch')))).toEqual({});
  });

  // FL.1: each viewer's own cost and sell price on the entry, from its ladder; `sell − cost` is the stored margin.
  it('reads each viewer\'s own cost and sell from the ladder, the branch\'s for the owner and its staff', () => {
    const row = { ladder, ...marginColumns(ladder, chainIdsOf(path)) };
    const prices = (id: string, layer: string) => storedPricesOf(marginViewOf(actor(id, layer)), row);
    // The point of sale paid 3500 and sold at its 4000; the agent paid 3100 and sold to the point of sale at 3500; …
    expect(prices('pos', 'pos')).toEqual({ cost: 3500, sell: 4000 });
    expect(prices('agent', 'agent')).toEqual({ cost: 3100, sell: 3500 });
    expect(prices('main', 'main_agent')).toEqual({ cost: 2700, sell: 3100 });
    // … the branch paid the provider 2200 and sold to the main agent at 2700.
    expect(prices('branch', 'branch')).toEqual({ cost: 2200, sell: 2700 });
    expect(prices('staff', 'branch')).toEqual({ cost: 2200, sell: 2700 });
    expect(prices('agent2', 'agent')).toBeNull();
    // No ladder (a fund, a switch): nothing.
    expect(storedPricesOf(marginViewOf(actor('branch', 'branch')), { ladder: null, ...marginColumns(ladder, chainIdsOf(path)), chainPosId: null, chainAgentId: null, chainMainAgentId: null, posMargin: null, agentMargin: null, mainAgentMargin: null, branchMargin: null })).toBeNull();
  });

  it('scales a refund\'s cost and sell by its share, so sell − cost is its stored margin to the agora', () => {
    for (const share of [-1 / 3, -0.5, -2 / 7, -1]) {
      const refund = { ...ladder, share };
      const row = { ladder: refund, ...marginColumns(refund, chainIdsOf(path)) };
      for (const [id, layer] of [['pos', 'pos'], ['agent', 'agent'], ['main', 'main_agent'], ['branch', 'branch']]) {
        const view = marginViewOf(actor(id, layer));
        const prices = storedPricesOf(view, row);
        expect(prices).not.toBeNull();
        expect((prices?.sell ?? 0) - (prices?.cost ?? 0)).toBe(storedMarginOf(view, row));
        expect(prices?.cost).toBe(Math.round(refund.costs[id as keyof typeof refund.costs] * share));
      }
    }
  });

  it('reads an operation marked as the branch\'s loss as the provider\'s cost sold at 0, for the branch only', () => {
    const row = { ladder: null, providerLoss: 'given_back', providerCost: 1800, ...lossMargins(1800) };
    expect(storedPricesOf(marginViewOf(actor('branch', 'branch')), row)).toEqual({ cost: 1800, sell: 0 });
    expect(storedPricesOf(marginViewOf(actor('pos', 'pos')), row)).toBeNull();
  });
});

describe('WalletsService.profitReport', () => {
  function service(seen: { where?: unknown; sum?: unknown }) {
    const kernel = new ServiceGraph(new MemoryAuthStore());
    const at = (day: number) => ({ createdAt: new Date(`2026-11-0${day}T00:00:00.000Z`) });
    kernel.prismaClient = {
      user: { findMany: async () => accounts },
      walletEntry: {
        groupBy: async ({ where, _sum }: { where: unknown; _sum: unknown }) => {
          seen.where = where;
          seen.sum = _sum;
          return [
            { companyName: 'وي', packageName: '150 جيجا', kind: 'activate', _count: { _all: 2 }, _sum: { agentMargin: 600 }, _max: at(2) },
            { companyName: 'وي', packageName: '150 جيجا', kind: 'disconnect', _count: { _all: 1 }, _sum: { agentMargin: -150 }, _max: at(5) },
            { companyName: 'سلكوم', packageName: '400 جيجا', kind: 'charge', _count: { _all: 1 }, _sum: { agentMargin: 400 }, _max: at(7) },
          ];
        },
      },
    } as unknown as ServiceGraph['prismaClient'];
    return new WalletsService(kernel.uow, kernel.tree, kernel.ledger, new WalletsRepository(kernel.uow));
  }

  it('adds sales, refunds and the viewer\'s stored margin up by package, newest first, with totals and a CSV', async () => {
    const seen: { where?: unknown; sum?: unknown } = {};
    const wallets = service(seen);
    const report = await wallets.profitReport(actor('agent', 'agent'));
    expect(report).toEqual({
      packages: [
        { packageName: '400 جيجا', companyName: 'سلكوم', sales: 1, refunds: 0, profit: 400, losses: 0, lossAmount: 0 },
        { packageName: '150 جيجا', companyName: 'وي', sales: 2, refunds: 1, profit: 450, losses: 0, lossAmount: 0 },
      ],
      totals: { sales: 3, refunds: 1, profit: 850, losses: 0, lossAmount: 0 },
    });
    // The agent's own column, over the chains it was in at the time: no list of the accounts under it now.
    expect(seen.sum).toEqual({ agentMargin: true });
    expect(JSON.stringify(seen.where)).toContain('"chainAgentId":"agent"');
    expect(JSON.stringify(seen.where)).not.toContain('"userId"');
    const csv = await wallets.profitCsv(actor('agent', 'agent'));
    expect(csv.split('\r\n')[2]).toBe('وي,150 جيجا,2,1,4.50');
  });
});
