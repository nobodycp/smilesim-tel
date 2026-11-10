import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import type { WalletsService } from '../wallets/wallets.service';
import { InsightsService } from './insights.service';
import { csvOf } from './report-csv';

const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'فرع', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'وكيل', layer: 'agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'pos1', loginName: 'pos1', nickname: 'نقطة ١', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
  { id: 'pos2', loginName: 'pos2', nickname: 'نقطة ٢', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: new Date() },
];
const actor: Actor = { id: 'agent', loginName: 'agent', nickname: 'وكيل', layer: 'agent', isBranchOwner: false, grants: [], operatorId: 'agent', impersonating: false };

function insights(tables: Record<string, unknown>) {
  const kernel = new OfficeGraph(new MemoryAuthStore());
  kernel.prismaClient = { user: { findMany: async () => accounts }, ...tables } as unknown as OfficeGraph['prismaClient'];
  const wallets = {
    financeWhere: async () => ({}),
    marginsFor: async (_actor: Actor, rows: { id: string }[]) => new Map(rows.map((row) => [row.id, 300])),
  } as unknown as WalletsService;
  return new InsightsService(kernel.uow, kernel.tree, wallets);
}

describe('InsightsService', () => {
  it('has no sales or orders report any more (spec 2026-11-09-admin-review, 1)', async () => {
    const service = insights({}) as unknown as Record<string, unknown>;
    expect(service.sales).toBeUndefined();
    expect(service.orders).toBeUndefined();
    await expect(insights({}).csv(actor, 'sales', {})).rejects.toMatchObject({ status: 404 });
  });

  it('lists the wallets under me with used and available, and keeps only the negative ones on demand', async () => {
    const service = insights({
      wallet: { findMany: async () => [{ userId: 'pos1', balance: -2000, ceiling: 5000 }, { userId: 'pos2', balance: 1000, ceiling: 0 }] },
      walletEntry: { groupBy: async () => [{ userId: 'pos1', _max: { createdAt: new Date('2026-11-06T10:00:00Z') } }] },
    });
    const all = await service.balances(actor);
    expect(all.rows.map((row) => row.loginName)).toEqual(['pos1', 'pos2']);
    expect(all.rows[0]).toMatchObject({ used: 2000, available: 3000, parentLogin: 'agent', lastAt: '2026-11-06T10:00:00.000Z' });
    expect(all.rows[1]).toMatchObject({ frozen: true, lastAt: null });
    expect(all.totals).toEqual({ count: 2, balance: -1000, used: 2000 });
    expect((await service.balances(actor, { negative: '1' })).rows.map((row) => row.loginName)).toEqual(['pos1']);
  });

  it('keeps the providers report for the branch with the reports grant', async () => {
    await expect(insights({}).supply(actor)).rejects.toMatchObject({ status: 403, code: 'REPORTS_BRANCH_ONLY' });
  });

  it('writes a CSV with shekels', () => {
    expect(csvOf(['a', 'b'], [['x', { money: -1898 }]]).split('\r\n')[1]).toBe('x,-18.98');
  });
});
