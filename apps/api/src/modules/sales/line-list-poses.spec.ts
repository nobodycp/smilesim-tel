import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { hashOnce } from '../testing/test-hash';
import { ApiFacade } from '../testing/api-facade';
import { encodeCursor } from '../platform/paging';
import { visibleAccountIds } from '../access/account-visibility';
import type { Account, Actor } from '../access/types';
import type { Layer } from '../../doors';

// The numbers list's `poses` (plan 2026-11-17-speed, PF.2; performance audit F3): the points of sale the viewer may
// activate for, worked out with the tree walked once a request, and sent with the first page only. A synthetic tree of
// 5,000 accounts: the answer is the one the implementation before PF.2 gave (kept below as the oracle), well inside a
// time the old one could not meet (it walked the whole tree again for every point of sale).

/** `canActivateFor` and the `poses` filter as they were before PF.2: a tree walk per point of sale. */
function oldPoses(actor: Pick<Actor, 'id' | 'layer'>, accounts: Account[]) {
  const visible = visibleAccountIds(actor.id, actor.layer, accounts);
  const canActivateFor = (pos: Account) => {
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(pos.id)) return false;
    if (actor.layer === 'pos') return actor.id === pos.id;
    return true;
  };
  return accounts
    .filter((account) => account.layer === 'pos' && visible.has(account.id) && canActivateFor(account))
    .map((account) => ({ loginName: account.loginName, nickname: account.nickname }));
}

/** 1 branch, 20 main agents, 200 agents, the rest points of sale, spread over the agents; ordered by login. */
function tree(size: number): Account[] {
  const rows: Account[] = [{ id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null }];
  for (let i = 0; i < 20; i += 1) rows.push({ id: `m${i}`, loginName: `m${i}`, nickname: `m${i}`, layer: 'main_agent', parentId: 'admin', deniedOps: '', disabledAt: null });
  for (let i = 0; i < 200; i += 1) rows.push({ id: `a${i}`, loginName: `a${i}`, nickname: `a${i}`, layer: 'agent', parentId: `m${i % 20}`, deniedOps: '', disabledAt: null });
  for (let i = 0; rows.length < size; i += 1) rows.push({ id: `p${i}`, loginName: `p${i}`, nickname: `نقطة ${i}`, layer: 'pos', parentId: `a${i % 200}`, deniedOps: '', disabledAt: null });
  return rows.sort((x, y) => x.loginName.localeCompare(y.loginName));
}

const accounts = tree(5000);
const at = new Date(Date.UTC(2026, 9, 1));
const line = {
  id: 'ln-1', msisdn: '0550000001', iccid: null, esim: false, status: 'active', posId: 'p0', createdAt: at, endsAt: at,
  package: { code: 'pk', name: '400', posPrice: 30, suspendAfterDays: 90, company: { name: 'سلكوم' } }, pos: { loginName: 'p0' },
};

async function signedIn(account: Account) {
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: account.id, loginName: account.loginName, nickname: account.nickname, disabledAt: null, mustChangePassword: false, layer: account.layer as Layer,
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: account.layer === 'branch', passwordHash: await hashOnce('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: account.id, scope: 'full', userAgent: '', ip: '' });
  const service = new ApiFacade(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: account.layer === 'branch' }), findMany: async () => accounts },
    postpaidLine: { findMany: async () => [line], count: async () => 1 },
    postpaidPackage: { findMany: async () => [] },
    // The company marks the list reads by URL (speed plan PF.7): none.
    $queryRaw: async () => [],
  };
  return { service, gate: { sessionId } };
}

describe('the numbers list\'s points of sale (PF.2)', () => {
  const viewers = ['admin', 'm3', 'a7', 'p11'].map((id) => accounts.find((account) => account.id === id)!);

  it.each(viewers.map((viewer) => [viewer.layer, viewer] as const))('answers the same points of sale as before for a %s viewer', async (_layer, viewer) => {
    const { service, gate } = await signedIn(viewer);
    const listed = await service.lines(gate);
    expect(listed.poses).toEqual(oldPoses(viewer, accounts));
  });

  it('works them out in a fraction of what one tree walk a point of sale took', async () => {
    const { service, gate } = await signedIn(viewers[0]);
    await service.lines(gate);
    const started = performance.now();
    const listed = await service.lines(gate);
    const took = performance.now() - started;
    expect(listed.poses).toHaveLength(4779);
    // Before PF.2 this tree cost the branch viewer about a second of walks a page (audit F3: 1,424 ms at 5,000
    // accounts; 0.9 s on the developer's machine); now it is one walk. The bound is generous for a loaded machine and
    // still ten times under the old cost.
    expect(took).toBeLessThan(80);
  });

  it('sends the points of sale with the first page only', async () => {
    const { service, gate } = await signedIn(viewers[0]);
    const later = await service.lines(gate, { cursor: encodeCursor(at, 'ln-1') });
    expect(later).not.toHaveProperty('poses');
    expect(later.items).toHaveLength(1);
  });
});
