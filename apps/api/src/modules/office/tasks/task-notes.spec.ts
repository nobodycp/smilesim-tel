import { TasksRepository } from './tasks.repository';
import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { OfficeFailure } from '../../shared/office-failure';
import { TasksService } from './tasks.service';

// Task notes and statuses (spec 2026-11-09-offers-tasks-addons-wallet-esim, 2): an internal note is the branch's
// only; a task opens in progress, may be taken (named) and released, and any handler finishes it.
const accounts = [
  { id: 'owner', loginName: 'owner', nickname: 'المالك', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null },
  { id: 'agent', loginName: 'agent', nickname: 'وكيل', layer: 'agent', parentId: 'owner', deniedOps: '', disabledAt: null },
  { id: 'pos', loginName: 'pos', nickname: 'نقطة', layer: 'pos', parentId: 'agent', deniedOps: '', disabledAt: null },
];

function setup() {
  const kernel = new OfficeGraph(new MemoryAuthStore());
  const task = { id: 't1', action: 'switch', status: 'working', posId: 'pos', submitterId: 'pos', assigneeId: null as string | null, msisdn: '0550000001', log: '', packageId: 'p1', held: 0 };
  const notes: { body: string; internal: boolean }[] = [];
  const noticed: string[][] = [];
  kernel.prismaClient = {
    user: {
      findMany: async ({ where }: { where?: { layer?: string } } = {}) => (where?.layer === 'branch'
        ? [{ id: 'owner', isBranchOwner: true, liveGrants: '', role: null, extraRoles: [] }]
        : accounts),
    },
    officeTask: {
      findUnique: async () => ({ ...task }),
      updateMany: async ({ where, data }: { where: { status?: string; assigneeId?: string | null }; data: Record<string, unknown> }) => {
        if (where.status && task.status !== where.status) return { count: 0 };
        if ('assigneeId' in where && task.assigneeId !== where.assigneeId) return { count: 0 };
        Object.assign(task, data);
        return { count: 1 };
      },
    },
    officeTaskNote: { create: async ({ data }: { data: { body: string; internal: boolean } }) => { notes.push({ body: data.body, internal: data.internal }); return data; } },
    // No task here has a provider operation: the lock on it finds no row (the manual route).
    $queryRaw: async () => [],
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(kernel.prismaClient),
  } as unknown as OfficeGraph['prismaClient'];
  (kernel.uow as unknown as { notice: unknown }).notice = {
    write: async (_tx: unknown, ids: string[]) => { noticed.push(ids); return []; },
    publish: async () => undefined,
  };
  return { service: new TasksService(kernel.uow, kernel.tree, kernel.actors, kernel.ledger, new TasksRepository(kernel.uow)), task, notes, noticed };
}

const actor = (id: string, layer: string, owner = false): Actor => ({ id, loginName: id, nickname: id, layer, isBranchOwner: owner, grants: [], operatorId: id, impersonating: false });

describe('task notes and statuses', () => {
  it('lets the branch write an internal note and tells only branch accounts', async () => {
    const { service, notes, noticed } = setup();
    await service.addNote(actor('owner', 'branch', true), 't1', { text: 'تم الاتصال بالمزود', internal: true });
    expect(notes).toEqual([{ body: 'تم الاتصال بالمزود', internal: true }]);
    expect(noticed.at(-1)?.every((id) => id === 'owner')).toBe(true);
  });

  it('refuses an internal note from outside the branch, and keeps an ordinary note ordinary', async () => {
    const { service, notes } = setup();
    await expect(service.addNote(actor('pos', 'pos'), 't1', { text: 'سر', internal: true })).rejects.toBeInstanceOf(OfficeFailure);
    await service.addNote(actor('pos', 'pos'), 't1', { text: 'متى؟' });
    expect(notes).toEqual([{ body: 'متى؟', internal: false }]);
  });

  it('takes an open task by naming its handler, releases it, and keeps it in progress throughout', async () => {
    const { service, task } = setup();
    await service.take(actor('owner', 'branch', true), 't1');
    expect(task).toMatchObject({ status: 'working', assigneeId: 'owner' });
    await expect(service.take(actor('owner', 'branch', true), 't1')).rejects.toBeInstanceOf(OfficeFailure);
    await service.release(actor('owner', 'branch', true), 't1');
    expect(task).toMatchObject({ status: 'working', assigneeId: null });
  });

  it('lets any handler close an open task, untaken, once', async () => {
    const { service, task } = setup();
    (task as { held: number }).held = 0;
    const owner = actor('owner', 'branch', true);
    const releases: unknown[] = [];
    (service as unknown as { ledger: { release: unknown } }).ledger.release = async (...args: unknown[]) => { releases.push(args); };
    await service.reject(owner, 't1', { reason: 'رقم خاطئ' });
    expect(task).toMatchObject({ status: 'cancelled', assigneeId: 'owner', resultNote: 'رقم خاطئ' });
    await expect(service.reject(owner, 't1', { reason: 'مرة ثانية' })).rejects.toBeInstanceOf(OfficeFailure);
    expect(releases).toHaveLength(1);
  });
});
