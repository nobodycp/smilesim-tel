import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { WalletsService } from './wallets.service';

// «العمليات» reads every line operation in the viewer's tree (spec 2026-11-08-overview-and-reports-nav, B): a sale
// debits only the point of sale's wallet, so the layers above see their chain's operations, with their own margin.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
  { id: 'agent2', loginName: 'agent2', nickname: 'a2', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos2', loginName: 'pos2', nickname: 'p2', layer: 'pos', parentId: 'agent2', deniedOps: '', disabledAt: null },
];
const ladder = { kind: 'activation', chain: ['pos', 'agent', 'main', 'branch'], costs: { pos: 3800, agent: 3500, main: 3000, branch: 2500 }, posSell: 4500 };
const entries = [
  { id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', packagePrice: 3800, amount: -3800, balanceAfter: 6200, ladder, createdAt: new Date('2026-11-02T00:00:00.000Z') },
  { id: 'e2', userId: 'pos2', kind: 'charge', lineId: 'l2', packagePrice: 3800, amount: -3800, balanceAfter: 1200, ladder: { ...ladder, chain: ['pos2', 'agent2', 'main', 'branch'] }, createdAt: new Date('2026-11-01T00:00:00.000Z') },
];
const userOf = (id: string) => accounts.find((account) => account.id === id);

function service(seen: { where?: unknown }) {
  const kernel = Object.create(OfficeKernel.prototype) as OfficeKernel;
  const inScope = (where: { userId?: { in: string[] } | string }) =>
    entries.filter((row) => !where.userId || (typeof where.userId === 'string' ? row.userId === where.userId : where.userId.in.includes(row.userId)));
  kernel.prismaClient = {
    user: { findMany: async () => accounts },
    walletEntry: {
      findMany: async ({ where }: { where: { userId?: { in: string[] } | string } }) => {
        seen.where = where;
        return inScope(where).map((row) => ({ ...row, note: null, packageName: '400', msisdn: '0500', actor: userOf(row.userId), user: userOf(row.userId) }));
      },
      count: async ({ where }: { where: { userId?: { in: string[] } | string } }) => inScope(where).length,
    },
  } as unknown as OfficeKernel['prismaClient'];
  return new WalletsService(kernel);
}

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });

describe('WalletsService.ledger operations', () => {
  it('shows the branch every operation in the tree, with the account and the branch margin', async () => {
    const result = await service({}).ledger(actor('branch', 'branch'), 'operations', {});
    expect(result.entries.map((row) => [row.id, row.loginName, row.layer, row.margin])).toEqual([['e1', 'pos', 'pos', 500], ['e2', 'pos2', 'pos', 500]]);
    expect(result.total).toBe(2);
  });

  it('shows an agent only its own chain, with its own margin', async () => {
    const result = await service({}).ledger(actor('agent', 'agent'), 'operations', {});
    expect(result.entries.map((row) => [row.id, row.margin])).toEqual([['e1', 300]]);
  });

  it('shows a main agent both of its agents\' chains', async () => {
    const result = await service({}).ledger(actor('main', 'main_agent'), 'operations', {});
    expect(result.entries.map((row) => row.id)).toEqual(['e1', 'e2']);
  });

  it('keeps a point of sale on its own operations, as before', async () => {
    const result = await service({}).ledger(actor('pos', 'pos'), 'operations', {});
    expect(result.entries.map((row) => [row.id, row.balanceBefore, row.balanceAfter])).toEqual([['e1', 10000, 6200]]);
  });

  it('keeps the audit scope on the viewer\'s own wallet', async () => {
    const seen: { where?: { userId?: unknown } } = {};
    await service(seen).ledger(actor('main', 'main_agent'), 'audit', {});
    expect(seen.where?.userId).toBe('main');
  });
});
