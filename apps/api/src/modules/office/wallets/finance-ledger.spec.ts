import { WalletsRepository } from './wallets.repository';
import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { WalletsService } from './wallets.service';

// «المالية» (owner 2026-11-09: «شامله كل العمليات للاب والابناء الي تحته»): every entry of the viewer and the
// accounts below it, operations that move no money included unless `scope=money`; the branch also reads what every
// account in a sale's chain earned on it.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'm', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'a', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'p', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];
const ladder = { kind: 'subscription', chain: ['pos', 'agent', 'main', 'branch'], costs: { pos: 3800, agent: 3500, main: 3000, branch: 2500 }, posSell: 4500 };
const at = new Date('2026-11-02T00:00:00.000Z');
const base = { balanceAfter: 0, reason: null, held: null, msisdn: '0500', companyName: 'c', packageName: 'p', packagePrice: 3800, esimPrice: null, note: null, createdAt: at };
const entries = [
  { ...base, id: 'e1', userId: 'pos', kind: 'activate', lineId: 'l1', amount: -3800, ladder },
  { ...base, id: 'e2', userId: 'pos', kind: 'rename', lineId: 'l1', amount: 0, ladder: null },
  { ...base, id: 'e3', userId: 'agent', kind: 'fund', lineId: null, amount: 10000, ladder: null },
];

function service(seen: { where?: Record<string, unknown> }) {
  const kernel = new OfficeGraph(new MemoryAuthStore());
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
  } as unknown as OfficeGraph['prismaClient'];
  return new WalletsService(kernel.uow, kernel.tree, kernel.ledger, kernel.ladder, new WalletsRepository(kernel.uow));
}

const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });

describe('WalletsService.finance', () => {
  it('reads every entry by default, and only money movements with scope=money', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    await wallets.finance(actor('agent', 'agent'), {});
    expect(seen.where?.AND).toBeUndefined();
    expect(seen.where?.userId).toEqual({ in: expect.arrayContaining(['agent', 'pos']) });
    expect((seen.where?.userId as { in: string[] }).in).not.toContain('main');
    await wallets.finance(actor('agent', 'agent'), { scope: 'money' });
    expect(seen.where?.AND).toEqual([{ OR: [{ amount: { not: 0 } }, { kind: { in: ['hold', 'release'] } }] }]);
  });

  it('keeps the line operations only with scope=operations, and still narrows by kind', async () => {
    const seen: { where?: Record<string, unknown> } = {};
    const wallets = service(seen);
    await wallets.finance(actor('agent', 'agent'), { scope: 'operations' });
    expect(seen.where?.AND).toEqual([{ kind: { in: expect.arrayContaining(['activate', 'charge', 'rename', 'disconnect']) } }]);
    expect(((seen.where?.AND as { kind: { in: string[] } }[])[0]).kind.in).not.toContain('fund');
    await wallets.finance(actor('agent', 'agent'), { scope: 'operations', kind: 'charge' });
    expect(seen.where?.kind).toBe('charge');
    expect(seen.where?.AND).toEqual([{ kind: { in: expect.arrayContaining(['charge']) } }]);
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
});
