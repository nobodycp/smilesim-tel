import { OfficeKernel } from '../kernel/office-kernel';
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
  const kernel = Object.create(OfficeKernel.prototype) as OfficeKernel;
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    line: { findMany: async () => [{ id: 'l1', terms: { packageCode: 'we-150' } }] },
    package: { findMany: async ({ select }: { select: Record<string, boolean> }) => [select.subscriberPrice ? pkg : pkg] },
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [{ packageId: 'pk', ownerId: 'pos', price: 5000, renewalPrice: null }] },
  } as unknown as OfficeKernel['prismaClient'];
  return new WalletsService(kernel);
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
});
