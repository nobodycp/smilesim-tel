import type { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { WalletsService } from './wallets.service';

// Taking money back (roadmap N6): from a child to its parent, with a reason and a note; no transfers sideways.
const accounts = [
  { id: 'branch', loginName: 'branch', nickname: 'فرع', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'main', loginName: 'main', nickname: 'رئيسي', layer: 'main_agent', parentId: 'branch', deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'وكيل', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'agent2', loginName: 'agent2', nickname: 'وكيل ٢', layer: 'agent', parentId: 'main', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'نقطة', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];
const actor = (id: string, layer: string): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: id === 'branch', grants: [], operatorId: id, impersonating: false });

function service() {
  const moves: unknown[][] = [];
  const kernel = {
    accounts: async () => accounts,
    runTx: async (work: (tx: unknown) => Promise<unknown>) => work({}),
    move: async (...args: unknown[]) => void moves.push(args.slice(1)),
    notice: { write: async () => [] },
    queueNotices: () => undefined,
  } as unknown as OfficeKernel;
  return { wallets: new WalletsService(kernel), moves };
}

describe('WalletsService.deduct', () => {
  it('takes money from a direct child back to its parent, with the reason and the note on both entries', async () => {
    const { wallets, moves } = service();
    await wallets.deduct(actor('agent', 'agent'), 'pos', { amount: 2500, reason: 'correction', note: 'تصحيح شحنة مكررة' });
    expect(moves).toEqual([
      ['pos', -2500, 'agent', 'deduct', 'تصحيح شحنة مكررة', undefined, 'correction'],
      ['agent', 2500, 'agent', 'deduct_in', 'تصحيح شحنة مكررة', undefined, 'correction'],
    ]);
  });

  it('lets the branch take back from any account below it', async () => {
    const { wallets, moves } = service();
    await wallets.deduct(actor('branch', 'branch'), 'pos', { amount: 100, reason: 'settlement', note: 'تسوية' });
    expect(moves.map((move) => move[0])).toEqual(['pos', 'branch']);
  });

  it('refuses a grandchild, a sibling, itself, a missing note and an unknown reason', async () => {
    const { wallets } = service();
    await expect(wallets.deduct(actor('main', 'main_agent'), 'pos', { amount: 100, reason: 'return', note: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(wallets.deduct(actor('agent', 'agent'), 'agent2', { amount: 100, reason: 'return', note: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(wallets.deduct(actor('agent', 'agent'), 'agent', { amount: 100, reason: 'return', note: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(wallets.deduct(actor('agent', 'agent'), 'pos', { amount: 100, reason: 'return', note: '  ' })).rejects.toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });
    await expect(wallets.deduct(actor('agent', 'agent'), 'pos', { amount: 100, reason: 'gift', note: 'x' })).rejects.toMatchObject({ status: 400, code: 'INVALID' });
  });
});
