import { OfficeKernel } from '../kernel/office-kernel';
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
  const kernel = Object.create(OfficeKernel.prototype) as OfficeKernel;
  kernel.prismaClient = { user: { findMany: async () => accounts }, ...tables } as unknown as OfficeKernel['prismaClient'];
  const wallets = {
    financeWhere: async () => ({}),
    marginsFor: async (_actor: Actor, rows: { id: string }[]) => new Map(rows.map((row) => [row.id, 300])),
  } as unknown as WalletsService;
  return new InsightsService(kernel, wallets);
}

describe('InsightsService', () => {
  it('lists sales with what was paid and my margin, and totals them', async () => {
    const report = await insights({
      walletEntry: { findMany: async () => [{ id: 'e1', createdAt: new Date('2026-11-06T10:00:00Z'), user: { loginName: 'pos1' }, kind: 'activate', msisdn: '055', companyName: 'وي', packageName: '150', amount: -3800 }] },
    }).sales(actor);
    expect(report.rows[0]).toMatchObject({ loginName: 'pos1', amount: 3800, margin: 300 });
    expect(report.totals).toEqual({ count: 1, amount: 3800, profit: 300 });
  });

  it('merges done operations with open and cancelled tasks, newest first', async () => {
    const report = await insights({
      walletEntry: { findMany: async () => [{ id: 'e1', createdAt: new Date('2026-11-06T10:00:00Z'), user: { loginName: 'pos1' }, kind: 'charge', msisdn: '055', companyName: 'وي', packageName: '150', amount: -3500 }] },
      officeTask: { findMany: async () => [
        { id: 't1', createdAt: new Date('2026-11-07T10:00:00Z'), posId: 'pos1', action: 'switch', msisdn: '056', packageId: 'pk', status: 'pending', posDelta: -500 },
        { id: 't2', createdAt: new Date('2026-11-05T10:00:00Z'), posId: 'pos2', action: 'sim', msisdn: '057', packageId: 'pk', status: 'cancelled', posDelta: 0 },
      ] },
      package: { findMany: async () => [{ id: 'pk', name: '150 جيجا', company: { name: 'وي' } }] },
    }).orders(actor);
    expect(report.rows.map((row) => [row.id, row.status])).toEqual([['t1', 'open'], ['e1', 'done'], ['t2', 'cancelled']]);
    expect(report.totals).toEqual({ count: 3, done: 1, open: 1, cancelled: 1 });
    expect(report.rows[0]).toMatchObject({ loginName: 'pos1', packageName: '150 جيجا' });
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
