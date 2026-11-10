import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { WalletsService } from './wallets.service';

// Each account sees what it earned on a sale (roadmap N4): from the chain kept on the entry, or, for an older sale,
// from today's prices with what the point of sale paid.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'staff', loginName: 'staff', nickname: 's', layer: 'branch', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];
const pkg = {
  id: 'pk', code: 'we-150', branchCost: 2500, mainPrice: 3000, agentPrice: 3500, posPrice: 3800,
  renewalBranchCost: 2200, renewalMainPrice: 2700, renewalAgentPrice: 3200, renewalPosPrice: 3500,
  subscriberPrice: 4500, renewalSubscriberPrice: 4000,
};

function service() {
  const kernel = new OfficeGraph(new MemoryAuthStore());
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    line: { findMany: async () => [{ id: 'l1', terms: { packageCode: 'we-150' } }] },
    package: { findMany: async ({ select }: { select: Record<string, boolean> }) => [select.subscriberPrice ? pkg : pkg] },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [{ packageId: 'pk', ownerId: 'pos', price: 5000, renewalPrice: null }] },
    walletEntry: { findMany: async () => [{ id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, ladder: null, createdAt: new Date('2026-11-01T00:00:00.000Z') }] },
  } as unknown as OfficeGraph['prismaClient'];
  return new WalletsService(kernel.uow, kernel.tree, kernel.ledger, kernel.ladder);
}

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });

describe('WalletsService.marginsFor', () => {
  const old = { id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, amount: -3800, ladder: null };
  const kept = {
    id: 'e2', userId: 'pos', kind: 'charge', lineId: 'l1', packagePrice: 3500, amount: -3500,
    ladder: { kind: 'renewal', chain: ['pos', 'agent', 'main', 'branch'], costs: { pos: 3500, agent: 3100, main: 2700, branch: 2200 }, posSell: 4000 },
  };
  const fund = { id: 'e3', userId: 'pos', kind: 'fund', lineId: null, packagePrice: null, amount: 10000, ladder: null };

  it('gives each layer its own margin, and the branch staff the branch margin', async () => {
    const wallets = service();
    const rows = [old, kept, fund];
    expect([...(await wallets.marginsFor(actor('pos', 'pos'), rows)).entries()]).toEqual([['e2', 500], ['e1', 1200]]);
    expect((await wallets.marginsFor(actor('agent', 'agent'), rows)).get('e2')).toBe(400);
    expect((await wallets.marginsFor(actor('agent', 'agent'), rows)).get('e1')).toBe(300);
    expect((await wallets.marginsFor(actor('main', 'main_agent'), rows)).get('e1')).toBe(500);
    expect((await wallets.marginsFor(actor('branch', 'branch'), rows)).get('e1')).toBe(500);
    expect((await wallets.marginsFor(actor('staff', 'branch'), rows)).get('e2')).toBe(500);
    expect((await wallets.marginsFor(actor('pos', 'pos'), rows)).has('e3')).toBe(false);
  });

  it('takes back the refunded share of the last sale of the line', async () => {
    const refund = { id: 'r1', userId: 'pos', kind: 'disconnect', lineId: 'l1', packagePrice: 3800, amount: 1900, ladder: null, createdAt: new Date('2026-11-05T00:00:00.000Z') };
    const wallets = service();
    expect((await wallets.marginsFor(actor('pos', 'pos'), [refund])).get('r1')).toBe(-600);
    expect((await wallets.marginsFor(actor('agent', 'agent'), [refund])).get('r1')).toBe(-150);
    expect((await wallets.marginsFor(actor('branch', 'branch'), [refund])).get('r1')).toBe(-250);
  });

  it('reports profit by package: sales, refunds and net, with totals and a CSV', async () => {
    const wallets = service();
    const rows = [
      { id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, amount: -3800, ladder: null, createdAt: new Date('2026-11-01T00:00:00.000Z'), packageName: '150 جيجا', companyName: 'وي' },
      { id: 'e2', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, amount: -3800, ladder: null, createdAt: new Date('2026-11-02T00:00:00.000Z'), packageName: '150 جيجا', companyName: 'وي' },
      { id: 'r1', userId: 'pos', kind: 'disconnect', lineId: 'l1', packagePrice: 3800, amount: 1900, ladder: null, createdAt: new Date('2026-11-05T00:00:00.000Z'), packageName: '150 جيجا', companyName: 'وي' },
    ];
    (wallets as unknown as { uow: { prismaClient: { walletEntry: { findMany: () => Promise<unknown[]> } } } }).uow.prismaClient.walletEntry.findMany = async () => rows;
    const report = await wallets.profitReport(actor('agent', 'agent'));
    expect(report.packages).toEqual([{ packageName: '150 جيجا', companyName: 'وي', sales: 2, refunds: 1, profit: 450 }]);
    expect(report.totals).toEqual({ sales: 2, refunds: 1, profit: 450 });
    const csv = await wallets.profitCsv(actor('agent', 'agent'));
    expect(csv.split('\r\n')[1]).toBe('وي,150 جيجا,2,1,4.50');
  });
});
