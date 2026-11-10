import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeGraph } from '../testing/office-graph';
import { DeskRepository } from './desk.repository';
import { LineSnapshotsService } from './line-snapshots.service';

// branch → agent → pos1, pos2; a frozen point of sale, pos3, under the branch.
const account = (id: string, layer: string, parentId: string | null, disabledAt: Date | null = null) => ({ id, loginName: id, nickname: id, layer, parentId, deniedOps: '', disabledAt });
const accounts = [account('branch', 'branch', null), account('agent', 'agent', 'branch'), account('pos1', 'pos', 'agent'), account('pos2', 'pos', 'agent'), account('pos3', 'pos', 'branch', new Date())];

type Snapshot = { userId: string; day: string; active: number; expiring: number; frozen: number; disconnected: number; suspended: number };

function service() {
  const snapshots: Snapshot[] = [];
  const groups: unknown[] = [];
  const graph = new OfficeGraph(new MemoryAuthStore());
  // What each point of sale has under each filter, as `groupBy posId` answers it.
  const counted = (where: Record<string, unknown>) => {
    const text = JSON.stringify(where);
    if (text.includes('suspendAfterDays')) return [{ posId: 'pos1', _count: { _all: 1 } }];
    if (text.includes('endsAt')) return [{ posId: 'pos2', _count: { _all: 2 } }];
    if (where.status === 'active') return [{ posId: 'pos1', _count: { _all: 6 } }, { posId: 'pos2', _count: { _all: 4 } }, { posId: 'pos3', _count: { _all: 9 } }];
    if (where.status === 'frozen') return [{ posId: 'pos2', _count: { _all: 2 } }];
    return [{ posId: 'pos1', _count: { _all: 3 } }];
  };
  graph.prismaClient = {
    user: { findMany: async () => accounts },
    package: { findMany: async () => [{ suspendAfterDays: 90 }] },
    line: { groupBy: async ({ where }: { where: Record<string, unknown> }) => { groups.push(where); return counted(where); } },
    lineCountSnapshot: {
      upsert: async ({ where, create }: { where: { userId_day: { userId: string; day: string } }; create: Snapshot }) => {
        const index = snapshots.findIndex((row) => row.userId === where.userId_day.userId && row.day === where.userId_day.day);
        if (index >= 0) snapshots[index] = create;
        else snapshots.push(create);
      },
    },
  } as unknown as OfficeGraph['prismaClient'];
  return { snapshots, groups, service: new LineSnapshotsService(graph.tree, new DeskRepository(graph.uow)) };
}

describe('the daily line snapshot', () => {
  const now = new Date('2026-11-10T09:00:00.000Z');

  it('writes one row a day for every account that is not frozen, each summing the points of sale it sees', async () => {
    const { service: snapshotsService, snapshots, groups } = service();
    expect(await snapshotsService.writeToday(now)).toBe(4);
    // Five grouped queries for the whole office, however many accounts there are.
    expect(groups).toHaveLength(5);
    expect(snapshots.map((row) => row.userId).sort()).toEqual(['agent', 'branch', 'pos1', 'pos2']);
    expect(snapshots.every((row) => row.day === '2026-11-10')).toBe(true);
    // The agent sees pos1 and pos2: 10 stored active, less 2 expiring and 1 suspended.
    expect(snapshots.find((row) => row.userId === 'agent')).toMatchObject({ active: 7, expiring: 2, frozen: 2, disconnected: 3, suspended: 1 });
    expect(snapshots.find((row) => row.userId === 'pos2')).toMatchObject({ active: 2, expiring: 2, frozen: 2, disconnected: 0, suspended: 0 });
    // The branch sees every point of sale, the frozen one's numbers included.
    expect(snapshots.find((row) => row.userId === 'branch')).toMatchObject({ active: 16 });
  });

  it('writes over the day\'s row when it runs again', async () => {
    const { service: snapshotsService, snapshots } = service();
    await snapshotsService.writeToday(now);
    await snapshotsService.writeToday(new Date('2026-11-10T21:00:00.000Z'));
    expect(snapshots).toHaveLength(4);
    await snapshotsService.writeToday(new Date('2026-11-11T01:00:00.000Z'));
    expect(snapshots).toHaveLength(8);
  });
});
